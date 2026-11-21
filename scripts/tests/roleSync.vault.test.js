/**
 * @license
 * Copyright 2025 Google LLC
 * Copyright 2026 Bare-AI, a trading name of Consulting Hailing Services LTD
 * SPDX-License-Identifier: Apache-2.0
 */

import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  fetchVaultKey,
  nodeSuffix,
  parseVaultEnv,
  runRoleSync,
} from '../../roleSync.js';

const LF = String.fromCharCode(10);

const VAULT_ENV = [
  'export VAULT_ADDR="https://vault.test:8200"',
  'export VAULT_ROLE_ID="role-abc"',
].join(LF);

function depsWith(overrides) {
  return {
    readFile: (p) => {
      if (p.endsWith('vault.env')) {
        if (overrides && overrides.vaultEnv === null) throw new Error('ENOENT');
        return overrides && overrides.vaultEnv ? overrides.vaultEnv : VAULT_ENV;
      }
      if (p.endsWith('node_id')) {
        if (overrides && overrides.nodeId === null) throw new Error('ENOENT');
        return overrides && overrides.nodeId ? overrides.nodeId : '11';
      }
      return readFileSync(p, 'utf8');
    },
    execCapture: () => {
      if (overrides && overrides.tailnet === null)
        throw new Error('no tailscale');
      return (overrides && overrides.tailnet) || '';
    },
  };
}

const ok = (body) =>
  Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) });

function vaultFetch(handlers) {
  return (url, init) => {
    if (url.endsWith('/v1/auth/approle/login')) {
      return handlers.login
        ? handlers.login(url, init)
        : ok({ auth: { client_token: 'tok' } });
    }
    if (url.indexOf('/v1/secret/data/') !== -1) {
      return handlers.secret
        ? handlers.secret(url, init)
        : ok({ data: { data: { taskbus_api_key: 'vault-key' } } });
    }
    return handlers.other ? handlers.other(url, init) : ok({});
  };
}

describe('parseVaultEnv', () => {
  it('reads export, bare and quoted assignments', () => {
    const parsed = parseVaultEnv(
      [
        'export VAULT_ADDR="https://v.test:8200"',
        'VAULT_ROLE_ID=abc',
        '# note',
      ].join(LF),
    );
    expect(parsed.VAULT_ADDR).toBe('https://v.test:8200');
    expect(parsed.VAULT_ROLE_ID).toBe('abc');
    expect(Object.keys(parsed).length).toBe(2);
  });
});

describe('nodeSuffix', () => {
  it('reads node_id and pads to two digits', () => {
    expect(nodeSuffix('/h', {}, depsWith({ nodeId: '11' }))).toBe('11');
    expect(nodeSuffix('/h', {}, depsWith({ nodeId: '7' }))).toBe('07');
  });

  it('prefers an explicit override', () => {
    expect(
      nodeSuffix('/h', { BARE_NODE_SUFFIX: '13' }, depsWith({ nodeId: '11' })),
    ).toBe('13');
  });

  it('falls back to the tailnet address', () => {
    expect(
      nodeSuffix(
        '/h',
        {},
        // Synthetic CGNAT address, deliberately NOT this fleet's: the parser only
        // needs a 100.x.y.z shape, and a real node address must not be committed
        // to a public repository.
        depsWith({ nodeId: null, tailnet: '100.72.99.13' + LF }),
      ),
    ).toBe('13');
  });

  it('returns empty when nothing can be determined', () => {
    expect(
      nodeSuffix('/h', {}, depsWith({ nodeId: null, tailnet: null })),
    ).toBe('');
  });
});

describe('fetchVaultKey', () => {
  const base = { env: {}, home: '/h', timeoutMs: 500 };

  it('logs in and returns the machine-secret key', async () => {
    const result = await fetchVaultKey({
      ...base,
      deps: depsWith(),
      fetchImpl: vaultFetch({}),
    });
    expect(result).toEqual({ key: 'vault-key', reason: 'vault' });
  });

  it('reads the node-specific machines path', async () => {
    const seen = [];
    const fetchImpl = (url, init) => {
      seen.push(url);
      return vaultFetch({})(url, init);
    };
    await fetchVaultKey({ ...base, deps: depsWith(), fetchImpl });
    expect(
      seen.some((u) => u.endsWith('/v1/secret/data/machines/bare-ai-11')),
    ).toBe(true);
  });

  it('falls back to api_key when taskbus_api_key is absent', async () => {
    const fetchImpl = vaultFetch({
      secret: () => ok({ data: { data: { api_key: 'plain-key' } } }),
    });
    const result = await fetchVaultKey({
      ...base,
      deps: depsWith(),
      fetchImpl,
    });
    expect(result.key).toBe('plain-key');
  });

  it('retries role_id-only when a secret_id is present and Vault answers 400', async () => {
    const bodies = [];
    let calls = 0;
    const fetchImpl = vaultFetch({
      login: (url, init) => {
        bodies.push(JSON.parse(init.body));
        calls += 1;
        if (calls === 1)
          return Promise.resolve({
            ok: false,
            status: 400,
            json: () => Promise.resolve({}),
          });
        return ok({ auth: { client_token: 'tok' } });
      },
    });
    const deps = depsWith({
      vaultEnv: VAULT_ENV + LF + 'export VAULT_SECRET_ID="stale"',
    });
    const result = await fetchVaultKey({ ...base, deps, fetchImpl });
    expect(bodies.length).toBe(2);
    expect(bodies[0].secret_id).toBe('stale');
    expect(bodies[1].secret_id).toBeUndefined();
    expect(result.key).toBe('vault-key');
  });

  it('declines without a vault.env', async () => {
    const result = await fetchVaultKey({
      ...base,
      deps: depsWith({ vaultEnv: null }),
      fetchImpl: vaultFetch({}),
    });
    expect(result).toEqual({ key: '', reason: 'no-vault-env' });
  });

  it('declines when Vault is unreachable', async () => {
    const fetchImpl = () => Promise.reject(new Error('ECONNREFUSED'));
    const result = await fetchVaultKey({
      ...base,
      deps: depsWith(),
      fetchImpl,
    });
    expect(result).toEqual({ key: '', reason: 'vault-unreachable' });
  });
});

describe('runRoleSync with Vault', () => {
  it('uses the Vault key when BARE_COUNCIL_API_KEY is unset', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'rolesync-vault-'));
    const rolePath = join(dir, 'role.md');
    writeFileSync(rolePath, 'LOCAL-ROLE', 'utf8');
    const fetchImpl = vaultFetch({
      other: () =>
        ok({ constitution_markdown: 'REGISTRY-ROLE', version: '1.103' }),
    });
    const result = await runRoleSync({
      env: { BARE_ROLE_SYNC_ALIAS: 'my_role' },
      home: dir,
      baseUrl: 'https://api.example',
      rolePath,
      fetchImpl,
      deps: depsWith(),
    });
    expect(result.source).toBe('api');
    expect(result.line).toContain('role: api (v1.103)');
    expect(readFileSync(rolePath, 'utf8')).toBe('REGISTRY-ROLE');
  });

  it('keeps the local role when the registry body is smaller', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'rolesync-keep-'));
    const rolePath = join(dir, 'role.md');
    const local = 'L'.repeat(500);
    writeFileSync(rolePath, local, 'utf8');
    const fetchImpl = vaultFetch({
      other: () => ok({ constitution_markdown: 'SHORT', version: '1.103' }),
    });
    const result = await runRoleSync({
      env: { BARE_COUNCIL_API_KEY: 'k', BARE_ROLE_SYNC_ALIAS: 'my_role' },
      home: dir,
      baseUrl: 'https://api.example',
      rolePath,
      fetchImpl,
      deps: depsWith(),
    });
    expect(result.source).toBe('local-kept');
    expect(result.line).toBe(
      '[sovereign] role: local-kept (registry smaller than local)',
    );
    expect(readFileSync(rolePath, 'utf8')).toBe(local);
  });
});
