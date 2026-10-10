/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Ticket 208: the /model hot-swap must narrow its external payloads (the
 * /v1/models catalogue, the two on-disk caches and the Vault response) with
 * type guards rather than unchecked assertions, and it must survive a payload
 * that is not the shape it hoped for.
 *
 * Every case drives the real slash command against a loopback stub and a
 * throwaway HOME, so nothing here contacts the fleet ingress or the user's real
 * cache. Each positive case has a control: a malformed payload is only evidence
 * if a well-formed one still resolves through the same path.
 */

import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  beforeEach,
  afterEach,
  vi,
} from 'vitest';
import * as http from 'node:http';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createMockCommandContext } from '../../test-utils/mockCommandContext.js';
import { MessageType } from '../types.js';
import { NO_TOOLS_ENV, TOOL_OVERRIDE_ENV } from '../../config/toolPolicy.js';

// The control row: if a case that expects a successful swap stops resolving
// this row, the guard has gone too far.
const GOOD_ROW = {
  shortcut: '991',
  model_id: 'guard-good-row',
  provider: 'ollama',
  is_cloud: false,
  base_url: 'http://127.0.0.1:9',
  tool_capability: 'doer',
};

// Rows the resolver cannot match. Before ticket 208 these were kept as-is, so
// central.map() and the find() predicates read properties off a null row.
const UNMATCHABLE_ROWS = [
  null,
  'not-a-row',
  42,
  { model_id: 'no-shortcut' },
  { shortcut: 992, model_id: 'numeric-shortcut' },
];

const VAULT_PATH = '/v1/secret/data/ollama/config';

// Every variable these cases write; restored after each one so an assertion in
// one test cannot leak into the next.
const MANAGED_ENV = [
  NO_TOOLS_ENV,
  TOOL_OVERRIDE_ENV,
  'BARE_AI_ENDPOINT',
  'BARE_AI_MODEL',
  'VAULT_ADDR',
  'VAULT_TOKEN',
];

describe('modelCommand catalogue narrowing (ticket 208)', () => {
  let modelCommand: typeof import('./modelCommand.js').modelCommand;
  let server: http.Server;
  let tempHome: string;
  let previousHome: string | undefined;
  let catalogueBody: unknown = { models: [] };
  let catalogueStatus = 200;
  let catalogueHits = 0;
  let vaultBody: unknown = {};
  let vaultHits = 0;
  let savedEnv: Record<string, string | undefined> = {};

  const cacheFile = () => path.join(tempHome, '.gemini', 'models.cache.json');

  const writeCache = (value: unknown) => {
    fs.mkdirSync(path.dirname(cacheFile()), { recursive: true });
    fs.writeFileSync(cacheFile(), JSON.stringify(value));
  };

  beforeAll(async () => {
    // CACHE_DIR / LOCAL_FILE are derived from os.homedir() at module load, so
    // HOME has to change before the import or the test reads the real cache.
    previousHome = process.env['HOME'];
    tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'bare-modelcmd-guard-'));
    process.env['HOME'] = tempHome;
    // Force the catalogue fallback by default: no Vault, no credential lookup.
    delete process.env['VAULT_ADDR'];
    delete process.env['VAULT_TOKEN'];

    server = http.createServer((req, res) => {
      if (req.url === '/v1/models') {
        catalogueHits += 1;
        res.writeHead(catalogueStatus, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(catalogueBody));
        return;
      }
      if (req.url === VAULT_PATH) {
        vaultHits += 1;
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(vaultBody));
        return;
      }
      res.writeHead(404);
      res.end();
    });
    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => resolve());
    });
    const address = server.address();
    const port =
      address && typeof address === 'object' ? address.port : undefined;
    if (!port) throw new Error('stub server did not bind a port');

    process.env['COUNCIL_API_BASE_URL'] = 'http://127.0.0.1:' + port;
    process.env['STUB_BASE'] = 'http://127.0.0.1:' + port;
    modelCommand = (await import('./modelCommand.js')).modelCommand;
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
    fs.rmSync(tempHome, { recursive: true, force: true });
    if (previousHome === undefined) {
      delete process.env['HOME'];
    } else {
      process.env['HOME'] = previousHome;
    }
    delete process.env['STUB_BASE'];
  });

  beforeEach(() => {
    catalogueHits = 0;
    vaultHits = 0;
    catalogueStatus = 200;
    catalogueBody = { models: [GOOD_ROW] };
    vaultBody = {};
    fs.rmSync(cacheFile(), { force: true });
    savedEnv = {};
    for (const key of MANAGED_ENV) {
      savedEnv[key] = process.env[key];
      delete process.env[key];
    }
  });

  afterEach(() => {
    vi.restoreAllMocks();
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  });

  it('skips unmatchable catalogue rows and still resolves the good row beside them', async () => {
    catalogueBody = { models: [...UNMATCHABLE_ROWS, GOOD_ROW] };
    const context = createMockCommandContext();

    await modelCommand.action!(context, '991');

    // The swap has to have happened, or this would pass for the wrong reason.
    expect(catalogueHits).toBeGreaterThan(0);
    expect(context.ui.addItem).toHaveBeenCalledWith(
      expect.objectContaining({
        type: MessageType.INFO,
        text: expect.stringContaining('Hot-swap successful'),
      }),
    );

    // The dropped rows must not be reachable either: a numeric shortcut and a
    // shortcut-less row are exactly what an unchecked assertion left behind.
    const control = createMockCommandContext();
    await modelCommand.action!(control, '992');
    expect(control.ui.addItem).toHaveBeenCalledWith(
      expect.objectContaining({
        type: MessageType.ERROR,
        text: expect.stringContaining('Unknown model or shortcut: 992'),
      }),
    );
  });

  it('treats a non-string base_url as a missing host instead of trusting it', async () => {
    catalogueBody = {
      models: [
        {
          shortcut: '993',
          model_id: 'guard-bad-base',
          provider: 'ollama',
          is_cloud: false,
          base_url: 42,
          tool_capability: 'doer',
        },
      ],
    };
    const context = createMockCommandContext();

    await modelCommand.action!(context, '993');

    expect(context.ui.addItem).toHaveBeenCalledWith(
      expect.objectContaining({
        type: MessageType.ERROR,
        text: expect.stringContaining('missing base_url'),
      }),
    );
    // Negative control: the unchecked version could only fail here with a
    // TypeError from calling .trim() on a number, which is a different failure
    // mode and tells the user nothing.
    expect(context.ui.addItem).not.toHaveBeenCalledWith(
      expect.objectContaining({
        text: expect.stringContaining('trim'),
      }),
    );
  });

  it('reads a cache in the wrong shape as an empty catalogue instead of throwing', async () => {
    // An older CLI could have cached the whole response object, while today the
    // cache holds the bare array. Neither shape may be trusted blindly.
    catalogueStatus = 500;
    writeCache({ count: 2 });
    const context = createMockCommandContext();

    await modelCommand.action!(context, '991');

    expect(catalogueHits).toBeGreaterThan(0);
    expect(context.ui.addItem).toHaveBeenCalledWith(
      expect.objectContaining({
        type: MessageType.ERROR,
        text: expect.stringContaining('Unknown model or shortcut: 991'),
      }),
    );
  });

  it('still resolves from a cache holding the bare array the loader writes', async () => {
    // Control for the case above: the cache fallback itself works, so that
    // result is about the payload shape and not about a dead fallback.
    catalogueStatus = 500;
    writeCache([GOOD_ROW]);
    const context = createMockCommandContext();

    await modelCommand.action!(context, '991');

    expect(context.ui.addItem).toHaveBeenCalledWith(
      expect.objectContaining({
        type: MessageType.INFO,
        text: expect.stringContaining('Hot-swap successful'),
      }),
    );
    expect(process.env['BARE_AI_ENDPOINT']).toBe(
      'http://127.0.0.1:9/v1/chat/completions',
    );
  });

  it('takes the endpoint and model name from a Vault KV v2 envelope', async () => {
    const stubBase = process.env['STUB_BASE'];
    if (!stubBase) throw new Error('stub base missing');
    process.env['VAULT_ADDR'] = stubBase;
    process.env['VAULT_TOKEN'] = 'test-token';
    vaultBody = {
      data: {
        data: {
          api_key: 'test-api-key',
          model_name: 'vault-named-model',
          base_url: 'http://127.0.0.1:1234/api',
        },
        metadata: { version: 1 },
      },
    };
    const context = createMockCommandContext();

    await modelCommand.action!(context, '991');

    expect(vaultHits).toBe(1);
    expect(process.env['BARE_AI_ENDPOINT']).toBe(
      'http://127.0.0.1:1234/api/v1/chat/completions',
    );
    expect(process.env['BARE_AI_MODEL']).toBe('vault-named-model');
  });

  it('falls back to the catalogue when the Vault body is not a config envelope', async () => {
    const stubBase = process.env['STUB_BASE'];
    if (!stubBase) throw new Error('stub base missing');
    process.env['VAULT_ADDR'] = stubBase;
    process.env['VAULT_TOKEN'] = 'test-token';
    vaultBody = { errors: ['permission denied'] };
    // The diagnostic is written to stderr, as console.error wrote it before the
    // suppression was lifted. Spying keeps it out of the test output and proves
    // it still fires.
    const stderrSpy = vi
      .spyOn(process.stderr, 'write')
      .mockImplementation(() => true);
    const context = createMockCommandContext();

    await modelCommand.action!(context, '991');

    // The diagnostic still fires, with the payload that could not be read...
    expect(stderrSpy).toHaveBeenCalled();
    const written = stderrSpy.mock.calls
      .map((call) => String(call[0]))
      .join('');
    expect(written).toContain('[Vault Debug]');
    expect(written).toContain('permission denied');
    // ...and the swap still lands on the catalogue row.
    expect(vaultHits).toBe(1);
    expect(process.env['BARE_AI_ENDPOINT']).toBe(
      'http://127.0.0.1:9/v1/chat/completions',
    );
    expect(process.env['BARE_AI_MODEL']).toBe('guard-good-row');
  });
});
