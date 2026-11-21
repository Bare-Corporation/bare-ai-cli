/**
 * @license
 * Copyright 2025 Google LLC
 * Copyright 2026 Bare-AI, a trading name of Consulting Hailing Services LTD
 * SPDX-License-Identifier: Apache-2.0
 */

import { mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  fetchRole,
  normaliseText,
  resolveConfig,
  rolePrefixCandidates,
  runRoleSync,
  sha256,
  shouldReplace,
  swapRoleInPrompt,
} from '../../roleSync.js';

const LF = String.fromCharCode(10);
const CRLF = String.fromCharCode(13) + LF;

function tempHome() {
  const dir = mkdtempSync(join(tmpdir(), 'rolesync-'));
  return {
    dir,
    rolePath: join(dir, 'role.md'),
    promptFile: join(dir, 'bare_prompt.md'),
    writeRole: (text) => writeFileSync(join(dir, 'role.md'), text, 'utf8'),
    writePrompt: (text) =>
      writeFileSync(join(dir, 'bare_prompt.md'), text, 'utf8'),
    readRole: () => readFileSync(join(dir, 'role.md'), 'utf8'),
    readPrompt: () => readFileSync(join(dir, 'bare_prompt.md'), 'utf8'),
  };
}

function okFetch(body) {
  return () =>
    Promise.resolve({
      ok: true,
      status: 200,
      json: () => Promise.resolve(body),
    });
}

describe('line endings and hashing', () => {
  it('treats a CRLF copy as identical to an LF copy', () => {
    const lf = 'a' + LF + 'b';
    const crlf = 'a' + CRLF + 'b';
    expect(normaliseText(crlf)).toBe(lf);
    expect(sha256(crlf)).toBe(sha256(lf));
  });

  it('reports a different hash for different content', () => {
    expect(sha256('one')).not.toBe(sha256('two'));
  });
});

describe('shouldReplace', () => {
  it('declines when nothing changed', () => {
    expect(shouldReplace('same', 'same', false)).toEqual({
      replace: false,
      reason: 'unchanged',
    });
  });

  it('declines an empty body', () => {
    expect(shouldReplace('local', '   ', false)).toEqual({
      replace: false,
      reason: 'empty-body',
    });
  });

  it('declines a body an order of magnitude smaller', () => {
    const existing = 'x'.repeat(1000);
    expect(shouldReplace(existing, 'small', false)).toEqual({
      replace: false,
      reason: 'shrink-guard',
    });
  });

  it('allows the shrink when the operator opts out', () => {
    const existing = 'x'.repeat(1000);
    expect(shouldReplace(existing, 'small', true)).toEqual({
      replace: true,
      reason: 'changed',
    });
  });

  it('replaces a comparable body', () => {
    expect(shouldReplace('a'.repeat(100), 'b'.repeat(90), false)).toEqual({
      replace: true,
      reason: 'changed',
    });
  });
});

describe('swapRoleInPrompt', () => {
  it('replaces only the role prefix and keeps the rest of the chain', () => {
    const prompt = 'OLD-ROLE' + LF + LF + 'ARCHETYPE' + LF + LF + 'ENVIRONMENT';
    const result = swapRoleInPrompt(prompt, 'OLD-ROLE', 'NEW-ROLE');
    expect(result.applied).toBe(true);
    expect(result.text).toBe(
      'NEW-ROLE' + LF + LF + 'ARCHETYPE' + LF + LF + 'ENVIRONMENT',
    );
  });

  it('refuses when the prefix does not match', () => {
    const result = swapRoleInPrompt('SOMETHING ELSE', 'OLD-ROLE', 'NEW-ROLE');
    expect(result.applied).toBe(false);
    expect(result.text).toBe('SOMETHING ELSE');
  });

  it('refuses an empty prompt or an empty body', () => {
    expect(swapRoleInPrompt('', 'OLD', 'NEW').applied).toBe(false);
    expect(swapRoleInPrompt('OLD', 'OLD', '').applied).toBe(false);
  });
});

describe('rolePrefixCandidates', () => {
  it('offers both the raw and the date-substituted form', () => {
    const now = new Date(2026, 10, 21);
    const candidates = rolePrefixCandidates('built {{DATE}}', now);
    expect(candidates).toContain('built {{DATE}}');
    expect(candidates).toContain('built 2026-11-21');
  });

  it('dedupes when there is no placeholder', () => {
    expect(rolePrefixCandidates('plain role', new Date(2026, 10, 21))).toEqual([
      'plain role',
    ]);
  });
});

describe('resolveConfig', () => {
  const readAliasFile = () => 'alias-from-file';

  it('is disabled when the source is forced local', () => {
    const cfg = resolveConfig(
      { BARE_ROLE_SOURCE: 'local' },
      '/home/x',
      readAliasFile,
    );
    expect(cfg.enabled).toBe(false);
    expect(cfg.reason).toBe('source=local');
  });

  it('is disabled with no alias anywhere', () => {
    const cfg = resolveConfig({}, '/home/x', () => {
      throw new Error('ENOENT');
    });
    expect(cfg.enabled).toBe(false);
    expect(cfg.reason).toBe('no-role-alias');
  });

  it('is disabled with an alias but no key', () => {
    const cfg = resolveConfig({}, '/home/x', readAliasFile);
    expect(cfg.enabled).toBe(false);
    expect(cfg.reason).toBe('no-api-key');
  });

  it('is enabled with an aliased role and a key', () => {
    const cfg = resolveConfig(
      { BARE_COUNCIL_API_KEY: 'k' },
      '/home/x',
      readAliasFile,
    );
    expect(cfg.enabled).toBe(true);
    expect(cfg.alias).toBe('alias-from-file');
    expect(cfg.timeoutMs).toBe(4000);
  });
});

describe('fetchRole', () => {
  const cfg = { alias: 'my_role', apiKey: 'k', timeoutMs: 50 };

  it('uses constitution_markdown, never the truncated effective_markdown', async () => {
    const full = 'F'.repeat(5000);
    const fetched = await fetchRole(
      cfg,
      'https://api.example',
      okFetch({
        constitution_markdown: full,
        effective_markdown: 'preview',
        version: '1.102',
      }),
    );
    expect(fetched.ok).toBe(true);
    expect(fetched.text).toBe(full);
    expect(fetched.text).not.toBe('preview');
    expect(fetched.version).toBe('1.102');
  });

  it('turns a non-200 into a reason', async () => {
    const fetched = await fetchRole(cfg, 'https://api.example', () =>
      Promise.resolve({
        ok: false,
        status: 503,
        json: () => Promise.resolve({}),
      }),
    );
    expect(fetched).toEqual({ ok: false, reason: 'http-503' });
  });

  it('turns a transport failure into unreachable', async () => {
    const fetched = await fetchRole(cfg, 'https://api.example', () =>
      Promise.reject(new Error('boom')),
    );
    expect(fetched).toEqual({ ok: false, reason: 'unreachable' });
  });

  it('turns an abort into timeout', async () => {
    const abort = new Error('aborted');
    abort.name = 'AbortError';
    const fetched = await fetchRole(cfg, 'https://api.example', () =>
      Promise.reject(abort),
    );
    expect(fetched).toEqual({ ok: false, reason: 'timeout' });
  });

  it('rejects a body that carries no constitution_markdown', async () => {
    const fetched = await fetchRole(
      cfg,
      'https://api.example',
      okFetch({ effective_markdown: 'x' }),
    );
    expect(fetched).toEqual({ ok: false, reason: 'no-constitution-markdown' });
  });
});

describe('runRoleSync', () => {
  const env = { BARE_COUNCIL_API_KEY: 'k', BARE_ROLE_SYNC_ALIAS: 'my_role' };
  const body = 'ROLE-V2' + LF + 'body';

  it('writes the role, injects it once, and reports the version', async () => {
    const t = tempHome();
    t.writeRole('ROLE-V1' + LF + 'old');
    t.writePrompt('ROLE-V1' + LF + 'old' + LF + LF + 'ARCHETYPE');

    const result = await runRoleSync({
      env,
      baseUrl: 'https://api.example',
      rolePath: t.rolePath,
      promptFile: t.promptFile,
      fetchImpl: okFetch({
        constitution_markdown: body,
        version: '1.102',
        alias: 'my_role',
      }),
    });

    expect(result.source).toBe('api');
    expect(result.line).toContain('role: api (v1.102)');
    expect(result.injected).toBe(true);
    expect(t.readRole()).toBe(body);
    // Exactly once: the archetype tail survives and the old role is gone.
    expect(t.readPrompt()).toBe(body + LF + LF + 'ARCHETYPE');
    expect(t.readPrompt().split('ROLE-V2').length - 1).toBe(1);
    expect(statSync(t.rolePath).mode & 0o777).toBe(0o600);
  });

  it('falls back to local when the API is unreachable, leaving role.md alone', async () => {
    const t = tempHome();
    t.writeRole('ROLE-V1');
    t.writePrompt('ROLE-V1' + LF + LF + 'ARCHETYPE');

    const result = await runRoleSync({
      env,
      baseUrl: 'http://127.0.0.1:1',
      rolePath: t.rolePath,
      promptFile: t.promptFile,
      fetchImpl: () => Promise.reject(new Error('ECONNREFUSED')),
    });

    expect(result.source).toBe('local-fallback');
    expect(result.line).toBe('[sovereign] role: local-fallback (unreachable)');
    expect(result.injected).toBe(false);
    expect(t.readRole()).toBe('ROLE-V1');
    expect(t.readPrompt()).toBe('ROLE-V1' + LF + LF + 'ARCHETYPE');
  });

  it('declines a shrunken body and says so', async () => {
    const t = tempHome();
    t.writeRole('R'.repeat(1000));

    const result = await runRoleSync({
      env,
      baseUrl: 'https://api.example',
      rolePath: t.rolePath,
      fetchImpl: okFetch({ constitution_markdown: 'tiny', version: '1.103' }),
    });

    expect(result.wrote).toBe(false);
    expect(result.line).toContain('cache=shrink-guard');
    expect(t.readRole()).toBe('R'.repeat(1000));
  });

  it('reports local-fallback when no key is configured', async () => {
    const t = tempHome();
    t.writeRole('ROLE-V1');
    const result = await runRoleSync({
      env: { BARE_ROLE_SYNC_ALIAS: 'my_role' },
      baseUrl: 'https://api.example',
      rolePath: t.rolePath,
      fetchImpl: () => Promise.reject(new Error('must not be called')),
    });
    expect(result.line).toBe('[sovereign] role: local-fallback (no-api-key)');
  });
});
