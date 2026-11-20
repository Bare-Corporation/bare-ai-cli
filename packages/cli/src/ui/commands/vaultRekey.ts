/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

// Ticket 691 - Vault session-token lifetime.
//
// WHY THIS EXISTS
// The launcher mints ONE AppRole token, exports it to this process as
// VAULT_TOKEN, and scrubs VAULT_ROLE_ID / VAULT_SECRET_ID so the child cannot
// mint for itself. An AppRole token lives for its lease_duration (measured
// 3600s on this fleet) and nothing renewed or re-minted it, so any session
// older than the lease held a dead token: every Vault read then returned 403
// carrying BOTH "permission denied" AND "invalid token", and renew-self could
// not rescue it because the token was already past expiry.
//
// WHAT THIS DOES
// On exactly that signal - a 403 whose body also carries "invalid token" -
// re-mint once through the same CIDR-bound AppRole (role_id only; a secret_id
// is presented only when this node still has one) and retry the request once.
//
// WHY RE-MINTING IS SAFE HERE
// The role_id is read from the user's own Vault env file, which this process
// could already read, so no new privilege is granted. No token is written to
// disk. secret_id auth is NOT required and NOT reintroduced.
//
// WHAT IT DELIBERATELY DOES NOT DO
// A 403 that says only "permission denied" is a POLICY answer, not an expiry.
// Re-minting against a policy denial would hide a real authorisation failure,
// so that case is left exactly as it was.
//
// TLS: trust comes from code, mirroring sovereign.js. NODE_EXTRA_CA_CERTS only
// exists when it was exported before the process started - which is an
// interactive shell and nothing else - so under systemd or cron the CA is
// untrusted and every Vault call died as a bare "fetch failed". The trust
// anchor is attached per request through an undici Agent; verification stays
// STRICT (connect.ca ADDS a trust anchor, it does not disable verification).

import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { Agent, fetch as undiciFetch } from 'undici';

export interface VaultEnvCredentials {
  addr?: string;
  roleId?: string;
  secretId?: string;
}

export interface MintedSessionToken {
  token: string;
  leaseSeconds: number;
}

const DEFAULT_ENV_PATH = join(homedir(), '.bare-ai', 'config', 'vault.env');
const VAULT_CA_PATH = join(homedir(), '.bare-ai', 'ca', 'vault-ca.crt');
const NEWLINE = String.fromCharCode(10);

let cachedDispatcher: Agent | null | undefined;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// Build the CA dispatcher once. null means "use Node's own trust store".
function vaultDispatcher(): Agent | null {
  if (cachedDispatcher !== undefined) return cachedDispatcher;
  if (process.env['NODE_EXTRA_CA_CERTS']) {
    cachedDispatcher = null;
    return null;
  }
  try {
    const ca = readFileSync(VAULT_CA_PATH, 'utf8');
    cachedDispatcher = new Agent({ connect: { ca } });
  } catch (err) {
    cachedDispatcher = null;
    const code =
      isRecord(err) && err['code'] !== undefined
        ? String(err['code'])
        : String(err);
    process.stderr.write(
      '[vault] WARNING: CA file not found at ' +
        VAULT_CA_PATH +
        ' - continuing with the Node default trust store (TLS errors may follow) [' +
        code +
        ']' +
        NEWLINE,
    );
  }
  return cachedDispatcher;
}

// undici's own request shape: the DOM RequestInit does not carry the
// dispatcher option, and its BodyInit differs from undici's.
type UndiciRequestInit = NonNullable<Parameters<typeof undiciFetch>[1]>;

// Every Vault call in this package goes through here so the trust anchor and
// any future transport policy live in one place.
export async function vaultFetch(
  url: string,
  init: UndiciRequestInit,
): Promise<Awaited<ReturnType<typeof undiciFetch>>> {
  const dispatcher = vaultDispatcher();
  const options = dispatcher ? { ...init, dispatcher } : init;
  return undiciFetch(url, options);
}

// Parse the launcher's env file. Only the three Vault entries are read; every
// other line is ignored, and the file is never logged. Absent or unreadable
// means "no credentials", which the caller reports - never a silent default.
export function readVaultEnv(
  path: string = process.env['VAULT_ENV_FILE'] ?? DEFAULT_ENV_PATH,
): VaultEnvCredentials {
  const out: VaultEnvCredentials = {};
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch {
    return out;
  }
  for (const rawLine of text.split(NEWLINE)) {
    let line = rawLine.trim();
    if (line === '' || line.startsWith('#')) continue;
    if (line.startsWith('export ')) line = line.slice('export '.length).trim();
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const name = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    value = value.split(String.fromCharCode(34)).join('');
    value = value.split(String.fromCharCode(39)).join('');
    if (name === 'VAULT_ADDR') out.addr = value;
    else if (name === 'VAULT_ROLE_ID') out.roleId = value;
    else if (name === 'VAULT_SECRET_ID') out.secretId = value;
  }
  return out;
}

// "invalid token" is the distinguishing half of an expiry: Vault answers an
// expired or revoked token with 403 and BOTH "permission denied" and
// "invalid token", while a policy denial carries only "permission denied".
export function isExpiredTokenResponse(
  status: number,
  payload: unknown,
): boolean {
  if (status !== 403) return false;
  const text =
    payload === undefined ? '' : JSON.stringify(payload).toLowerCase();
  return text.includes('invalid token');
}

export async function mintSessionToken(
  addr: string,
  creds: VaultEnvCredentials,
): Promise<MintedSessionToken> {
  if (!creds.roleId) {
    throw new Error(
      'no VAULT_ROLE_ID available to re-mint a Vault token (looked in $VAULT_ENV_FILE and the default Vault env file)',
    );
  }
  // role_id alone is the CIDR-bound AppRole path. A secret_id is added only
  // when this node still has one, so a legacy non-CIDR-bound node keeps
  // working and a CIDR-bound node never sends an empty credential.
  const body: Record<string, string> = { role_id: creds.roleId };
  if (creds.secretId) body['secret_id'] = creds.secretId;

  const res = await vaultFetch(addr + '/v1/auth/approle/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const payload: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(
      'AppRole login failed: HTTP ' +
        String(res.status) +
        ' ' +
        JSON.stringify(payload),
    );
  }
  const auth = isRecord(payload) ? payload['auth'] : undefined;
  const tokenValue = isRecord(auth) ? auth['client_token'] : undefined;
  const leaseValue = isRecord(auth) ? auth['lease_duration'] : undefined;
  if (tokenValue === undefined || tokenValue === null) {
    throw new Error(
      'AppRole login returned no client_token: ' + JSON.stringify(payload),
    );
  }
  return {
    token: String(tokenValue),
    leaseSeconds: Number(leaseValue === undefined ? 0 : leaseValue),
  };
}
