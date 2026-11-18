/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

// Ticket 691 - regression coverage for Vault session-token re-minting.
//
// The real defect (a 403 carrying BOTH "permission denied" and "invalid token"
// after the AppRole lease expired) is reproduced against a loopback stub rather
// than a live Vault, so this suite is hermetic and needs no credentials. The
// live before/after evidence is recorded on the ticket.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fetchVaultUpdate } from './modelCommand.js';
import { isExpiredTokenResponse, readVaultEnv } from './vaultRekey.js';

const DEAD_BODY = {
  errors: [
    '2 errors occurred:' +
      String.fromCharCode(10) +
      '* permission denied' +
      String.fromCharCode(10) +
      '* invalid token' +
      String.fromCharCode(10),
  ],
};
const POLICY_BODY = { errors: ['1 error occurred: permission denied'] };
const SECRET_BODY = { data: { data: { api_key: 'rekey-test-key' } } };

interface StubState {
  secretStatus: number;
  secretBody: unknown;
  logins: number;
  secretTokens: string[];
}

let server: ReturnType<typeof createServer> | undefined;
let tempDir: string;
let savedEnv: Record<string, string | undefined>;
let state: StubState;

function handle(req: IncomingMessage, res: ServerResponse): void {
  const token = String(req.headers['x-vault-token'] ?? '');
  if (req.method === 'POST' && req.url === '/v1/auth/approle/login') {
    state.logins += 1;
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        auth: { client_token: 'fresh-token', lease_duration: 3600 },
      }),
    );
    return;
  }
  state.secretTokens.push(token);
  const ok = token === 'fresh-token';
  res.writeHead(ok ? 200 : state.secretStatus, {
    'Content-Type': 'application/json',
  });
  res.end(JSON.stringify(ok ? SECRET_BODY : state.secretBody));
}

describe('vault session token re-mint (ticket 691)', () => {
  beforeEach(async () => {
    state = {
      secretStatus: 403,
      secretBody: DEAD_BODY,
      logins: 0,
      secretTokens: [],
    };
    server = createServer(handle);
    await new Promise<void>((resolve) =>
      server?.listen(0, '127.0.0.1', resolve),
    );
    const address = server.address();
    const port = typeof address === 'object' && address ? address.port : 0;

    tempDir = mkdtempSync(join(tmpdir(), 'vaultrekey-'));
    const envPath = join(tempDir, 'vault.env');
    writeFileSync(
      envPath,
      '# comment line' +
        String.fromCharCode(10) +
        'export VAULT_ROLE_ID="test-role-id"' +
        String.fromCharCode(10),
      'utf8',
    );

    savedEnv = {
      VAULT_ADDR: process.env['VAULT_ADDR'],
      VAULT_TOKEN: process.env['VAULT_TOKEN'],
      VAULT_ENV_FILE: process.env['VAULT_ENV_FILE'],
    };
    process.env['VAULT_ADDR'] = 'http://127.0.0.1:' + String(port);
    process.env['VAULT_TOKEN'] = 'dead-token';
    process.env['VAULT_ENV_FILE'] = envPath;
  });

  afterEach(async () => {
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    if (server) {
      await new Promise<void>((resolve) => server?.close(() => resolve()));
      server = undefined;
    }
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('re-mints once and retries once when the token has expired', async () => {
    const config = await fetchVaultUpdate('any-model', 'deepseek');
    expect(config.api_key).toBe('rekey-test-key');
    expect(state.logins).toBe(1);
    expect(state.secretTokens).toEqual(['dead-token', 'fresh-token']);
    // The adopted token is kept for the rest of the session.
    expect(process.env['VAULT_TOKEN']).toBe('fresh-token');
  });

  it('does NOT re-mint a plain policy denial (no "invalid token")', async () => {
    state.secretBody = POLICY_BODY;
    await expect(fetchVaultUpdate('any-model', 'deepseek')).rejects.toThrow(
      /Model configuration not found/,
    );
    expect(state.logins).toBe(0);
  });

  it('surfaces the original Vault response when the re-mint itself fails', async () => {
    process.env['VAULT_ENV_FILE'] = join(tempDir, 'missing.env');
    await expect(fetchVaultUpdate('any-model', 'deepseek')).rejects.toThrow(
      /could not be re-minted[\s\S]*invalid token/,
    );
    expect(state.logins).toBe(0);
  });
});

describe('isExpiredTokenResponse', () => {
  it('is true only for a 403 that also says invalid token', () => {
    expect(isExpiredTokenResponse(403, DEAD_BODY)).toBe(true);
    expect(isExpiredTokenResponse(403, POLICY_BODY)).toBe(false);
    expect(isExpiredTokenResponse(200, DEAD_BODY)).toBe(false);
    expect(isExpiredTokenResponse(404, DEAD_BODY)).toBe(false);
    expect(isExpiredTokenResponse(403, undefined)).toBe(false);
  });
});

describe('readVaultEnv', () => {
  it('reads exported Vault entries and ignores everything else', () => {
    const dir = mkdtempSync(join(tmpdir(), 'vaultenv-'));
    const file = join(dir, 'vault.env');
    writeFileSync(
      file,
      [
        '# a comment',
        'export VAULT_ADDR="https://vault.example:8200"',
        'export VAULT_ROLE_ID=' +
          String.fromCharCode(39) +
          'role-abc' +
          String.fromCharCode(39),
        'VAULT_SECRET_ID=legacy-secret',
        'export SOMETHING_ELSE=ignored',
      ].join(String.fromCharCode(10)),
      'utf8',
    );
    const parsed = readVaultEnv(file);
    expect(parsed.addr).toBe('https://vault.example:8200');
    expect(parsed.roleId).toBe('role-abc');
    expect(parsed.secretId).toBe('legacy-secret');
    rmSync(dir, { recursive: true, force: true });
  });

  it('returns no credentials for a missing file rather than inventing them', () => {
    const parsed = readVaultEnv(join(tmpdir(), 'definitely-absent-vault.env'));
    expect(parsed.roleId).toBeUndefined();
    expect(parsed.addr).toBeUndefined();
  });
});
