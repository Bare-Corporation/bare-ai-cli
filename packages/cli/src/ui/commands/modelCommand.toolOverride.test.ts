/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Regression test for ticket 164: the /model hot-swap must not re-enable tools
 * behind the caller's back.
 *
 * The swap resolves a model row from the live catalogue and used to write
 * BARE_AI_NO_TOOLS from that row's tool_capability alone. With a caller that
 * had asked for no tools (and an approval mode that auto-approves read-only
 * tools), a doer row re-enabled tool use mid-session.
 *
 * The catalogue here is a loopback stub so the test never contacts the fleet
 * ingress, and the control case proves the doer row still decides the policy
 * when no caller intent was recorded.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import * as http from 'node:http';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createMockCommandContext } from '../../test-utils/mockCommandContext.js';
import { MessageType } from '../types.js';
import {
  applyToolFlags,
  isToolModeLocked,
  NO_TOOLS_ENV,
  TOOL_OVERRIDE_ENV,
} from '../../config/toolPolicy.js';

const DOER_ROW = {
  shortcut: '999',
  model_id: 'doer-test-model',
  provider: 'ollama',
  is_cloud: false,
  base_url: 'http://127.0.0.1:9',
  tool_capability: 'doer',
};

describe('modelCommand tool-policy override', () => {
  let modelCommand: typeof import('./modelCommand.js').modelCommand;
  let server: http.Server;
  let tempHome: string;
  let previousHome: string | undefined;
  let catalogueHits = 0;
  let savedEnv: Record<string, string | undefined> = {};

  beforeAll(async () => {
    // CACHE_DIR / LOCAL_FILE are derived from os.homedir() at module load, so
    // HOME has to change before the import or the test reads the real cache.
    previousHome = process.env['HOME'];
    tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'bare-modelcmd-'));
    process.env['HOME'] = tempHome;
    // Force the catalogue fallback path: no Vault, so no credential lookup.
    delete process.env['VAULT_ADDR'];
    delete process.env['VAULT_TOKEN'];

    server = http.createServer((req, res) => {
      if (req.url === '/v1/models') {
        catalogueHits += 1;
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ models: [DOER_ROW], count: 1 }));
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
    if (!port) throw new Error('stub catalogue did not bind a port');

    process.env['COUNCIL_API_BASE_URL'] = 'http://127.0.0.1:' + port;
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
  });

  beforeEach(() => {
    catalogueHits = 0;
    savedEnv = {};
    for (const key of [NO_TOOLS_ENV, TOOL_OVERRIDE_ENV]) {
      savedEnv[key] = process.env[key];
      delete process.env[key];
    }
  });

  afterEach(() => {
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  });

  it('keeps the caller tool policy across a swap to a doer row', async () => {
    const context = createMockCommandContext();

    // The caller (e.g. the Council API) states, per execution, that tools are
    // off; the doer row must not overrule that.
    applyToolFlags({ 'disable-tools': true });

    await modelCommand.action!(context, '999');

    // The swap itself has to have run, otherwise this test would pass for the
    // wrong reason.
    expect(catalogueHits).toBeGreaterThan(0);
    expect(context.ui.addItem).toHaveBeenCalledWith(
      expect.objectContaining({
        type: MessageType.INFO,
        text: expect.stringContaining('Hot-swap successful'),
      }),
    );
    expect(process.env[NO_TOOLS_ENV]).toBe('true');
    expect(context.ui.addItem).toHaveBeenCalledWith(
      expect.objectContaining({
        type: MessageType.INFO,
        text: expect.stringContaining('locked by the caller'),
      }),
    );
  });

  it('still lets the catalogue capability decide when nothing is locked', async () => {
    const context = createMockCommandContext();

    await modelCommand.action!(context, '999');

    expect(catalogueHits).toBeGreaterThan(0);
    expect(context.ui.addItem).toHaveBeenCalledWith(
      expect.objectContaining({
        type: MessageType.INFO,
        text: expect.stringContaining('Hot-swap successful'),
      }),
    );
    expect(process.env[NO_TOOLS_ENV]).toBe('false');
    expect(isToolModeLocked()).toBe(false);
  });
});
