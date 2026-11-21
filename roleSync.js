/**
 * @license
 * Copyright 2025 Google LLC
 * Copyright 2026 Bare-AI, a trading name of Consulting Hailing Services LTD
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Role resolution for the launcher: API first, local fallback.
 *
 * WHY THIS EXISTS
 * The role a node runs with is whatever ~/.bare-ai/role.md held when the shell
 * launcher built the prompt handoff file. Nothing refreshed it, so a role edited
 * in the registry could go unnoticed on a node for weeks. This module asks the
 * registry for the body named by a small alias file, keeps role.md in step with
 * it, and falls back to the local file when the API is unavailable.
 *
 * THE BODY FIELD MATTERS. The detail response carries BOTH constitution_markdown
 * (the whole body) and effective_markdown (the same body TRUNCATED to a display
 * limit, with a truncated flag). Only constitution_markdown is ever written:
 * effective_markdown would silently replace a large role with a preview of it.
 *
 * INJECTION HAPPENS ONCE. By the time this runs the launcher has already put the
 * role into the prompt handoff file, so the fresh body is swapped in by
 * replacing the OLD role text as a PREFIX of that file - the identity chain
 * writes the role first. If the prefix does not match exactly the file is left
 * alone, and the new role applies from the next session, rather than guessed at.
 */

import { Buffer } from 'node:buffer';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  chmodSync,
  copyFileSync,
  existsSync,
  readFileSync,
  renameSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { clearTimeout, setTimeout } from 'node:timers';

export const LF = String.fromCharCode(10);
const CRLF = String.fromCharCode(13) + LF;
const SLASHES = /[/]+$/;

/** Normalise line endings so a CRLF copy is not mistaken for a changed body. */
export function normaliseText(value) {
  return String(value == null ? '' : value)
    .split(CRLF)
    .join(LF);
}

/** Hex sha256 of the normalised text. */
export function sha256(text) {
  return createHash('sha256').update(normaliseText(text), 'utf8').digest('hex');
}

/**
 * Decide whether to overwrite the local role with the fetched body.
 * Returns a reason rather than a bare boolean so the log line can say WHY it
 * declined, which is the difference between a guard and a silent no-op.
 */
export function trimTrailingNewlines(value) {
  return normaliseText(value).replace(/[\n]+$/, '');
}

export function shouldReplace(existing, incoming, allowShrink) {
  const next = normaliseText(incoming);
  if (!next.trim()) return { replace: false, reason: 'empty-body' };
  // Compare with trailing newlines trimmed on BOTH sides. The registry stores the
  // body without a trailing newline, so a local file that ends in one is always
  // exactly one byte "bigger" - which would otherwise trip the shrink guard on
  // every single sync and make the API path unreachable.
  const current = normaliseText(existing);
  const nextTrim = trimTrailingNewlines(next);
  const currentTrim = trimTrailingNewlines(current);
  if (currentTrim === nextTrim) return { replace: false, reason: 'unchanged' };
  // STRICT: ANY smaller registry body is refused, not just an order-of-magnitude
  // one. role.md is also where this node keeps lessons that have not been
  // published yet, so losing a few kilobytes is losing work that exists nowhere
  // else. BARE_ROLE_ALLOW_SHRINK=1 is the deliberate opt-out.
  // NOTE: deliberately stricter than bare-role-sync.py, which tolerates a 50%
  // drop; a pull path must not be the only thing standing between the node and
  // unpublished local content.
  if (
    !allowShrink &&
    currentTrim.length > 0 &&
    nextTrim.length < currentTrim.length
  ) {
    return { replace: false, reason: 'shrink' };
  }
  return { replace: true, reason: 'changed' };
}

/**
 * Replace the role prefix of the prompt handoff file.
 * oldRoleText is what the launcher read from role.md, which may have had its
 * date placeholder substituted, so callers pass every candidate form. A prefix
 * that does not match returns applied:false and leaves the text untouched.
 */
export function swapRoleInPrompt(promptText, oldRoleText, newRoleText) {
  const prompt = String(promptText == null ? '' : promptText);
  if (!prompt || !newRoleText) return { text: prompt, applied: false };
  if (oldRoleText && prompt.startsWith(oldRoleText)) {
    return {
      text: newRoleText + prompt.slice(oldRoleText.length),
      applied: true,
    };
  }
  return { text: prompt, applied: false };
}

/** Read the role alias, if one is configured. */
export function readAlias(env, home, readFile) {
  const fromEnv = String(env.BARE_ROLE_SYNC_ALIAS || '').trim();
  if (fromEnv) return { alias: fromEnv, reason: 'env' };
  const aliasPath = join(home, '.bare-ai', 'role-sync.alias');
  try {
    const alias = String(readFile(aliasPath, 'utf8')).trim();
    if (alias) return { alias, reason: 'file' };
    return { alias: '', reason: 'no-alias' };
  } catch {
    return { alias: '', reason: 'no-alias' };
  }
}

/**
 * Build the effective configuration.
 * Credentials and endpoints come from the environment only: this file ships in a
 * public repository, so it must contain no host, port or secret of any kind.
 */
export function resolveConfig(env, home, readFile) {
  const source = String(env.BARE_ROLE_SOURCE || '')
    .trim()
    .toLowerCase();
  const allowShrink = String(env.BARE_ROLE_ALLOW_SHRINK || '0') === '1';
  const timeoutMs = Number(env.BARE_ROLE_API_TIMEOUT_MS || 4000);
  const apiKey = String(env.BARE_COUNCIL_API_KEY || '').trim();
  const found = readAlias(env, home, readFile);
  const alias = found.alias;

  if (source === 'local') {
    return {
      enabled: false,
      reason: 'source=local',
      alias,
      apiKey,
      allowShrink,
      timeoutMs,
    };
  }
  if (!alias) {
    return {
      enabled: false,
      reason: 'no-role-alias',
      alias,
      apiKey,
      allowShrink,
      timeoutMs,
    };
  }
  if (!apiKey) {
    return {
      enabled: false,
      reason: 'no-api-key',
      alias,
      apiKey,
      allowShrink,
      timeoutMs,
    };
  }
  return {
    enabled: true,
    reason: 'api',
    alias,
    apiKey,
    allowShrink,
    timeoutMs,
  };
}

/**
 * Fetch the role detail. Never throws: a timeout, a non-200 or a malformed body
 * all come back as ok:false with a reason, so the caller degrades to local.
 */
export async function fetchRole(config, baseUrl, fetchImpl, fetchOptions) {
  const url =
    String(baseUrl || '').replace(SLASHES, '') +
    '/v1/council/knowledge/bare-roles/' +
    encodeURIComponent(config.alias);
  const Controller = globalThis.AbortController;
  const controller = new Controller();
  const timer = setTimeout(() => controller.abort(), config.timeoutMs);
  try {
    const res = await fetchImpl(url, {
      method: 'GET',
      headers: {
        'X-API-Key': config.apiKey,
        'User-Agent': 'bare-ai-sovereign/1.0',
        Accept: 'application/json',
      },
      signal: controller.signal,
      ...(fetchOptions || {}),
    });
    if (!res.ok) return { ok: false, reason: 'http-' + res.status };
    const body = await res.json().catch(() => null);
    if (!body || typeof body !== 'object')
      return { ok: false, reason: 'bad-body' };
    const text =
      typeof body.constitution_markdown === 'string'
        ? body.constitution_markdown
        : '';
    if (!text.trim()) return { ok: false, reason: 'no-constitution-markdown' };
    return {
      ok: true,
      text,
      version: String(body.version || '').trim(),
      alias: String(body.alias || config.alias),
    };
  } catch (err) {
    const name = err && err.name === 'AbortError' ? 'timeout' : 'unreachable';
    return { ok: false, reason: name };
  } finally {
    clearTimeout(timer);
  }
}

/** Today's local date as YYYY-MM-DD, matching the launcher's date command. */
export function todayLocal(now) {
  const d = now || new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
}

/** Every plausible form of the role text the launcher could have written. */
export function rolePrefixCandidates(roleText, now) {
  const raw = String(roleText || '');
  const substituted = raw.split('{{DATE}}').join(todayLocal(now));
  const out = [];
  for (const candidate of [raw, substituted]) {
    if (candidate && out.indexOf(candidate) === -1) out.push(candidate);
  }
  return out;
}

/** Write role.md atomically, keeping one backup and 0600 permissions. */
export function writeRoleAtomically(rolePath, text, deps) {
  const tmp = rolePath + '.rolesync-tmp';
  writeFileSync(tmp, text, { encoding: 'utf8', mode: 0o600 });
  chmodSync(tmp, 0o600);
  if (deps.copyFile && existsSync(rolePath)) {
    deps.copyFile(rolePath, rolePath + '.bak-rolesync');
  }
  renameSync(tmp, rolePath);
  return true;
}

/**
 * Replace the role prefix inside the prompt handoff file.
 * A prompt file that does not start with any candidate is LEFT ALONE: guessing
 * where the role ends inside a concatenated identity chain could duplicate or
 * truncate text, which is exactly what this change exists to avoid.
 */
export function applyPromptSwap(promptFile, candidates, newRoleText, deps) {
  if (!promptFile || !existsSync(promptFile))
    return { applied: false, reason: 'no-prompt-file' };
  const info = statSync(promptFile);
  if (!info.isFile() || info.size === 0)
    return { applied: false, reason: 'no-prompt-file' };
  const prompt = deps.readFile(promptFile, 'utf8');
  for (const candidate of candidates) {
    const result = swapRoleInPrompt(prompt, candidate, newRoleText);
    if (result.applied) {
      const tmp = promptFile + '.rolesync-tmp';
      writeFileSync(tmp, result.text, { encoding: 'utf8', mode: 0o600 });
      chmodSync(tmp, 0o600);
      renameSync(tmp, promptFile);
      return { applied: true, reason: 'swapped' };
    }
  }
  return { applied: false, reason: 'prefix-mismatch' };
}

/**
 * Run the whole sync and return ONE status line plus the resolved role text.
 * deps carries the filesystem so tests never touch the real node.
 */
/**
 * Parse a shell env file into a plain object.
 * Accepts both "export K=V" and bare "K=V", and strips one layer of quotes.
 */
export function parseVaultEnv(text) {
  const out = {};
  for (const raw of String(text || '').split(LF)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    let key = line.slice(0, eq).trim();
    if (key.startsWith('export ')) key = key.slice(7).trim();
    let value = line.slice(eq + 1).trim();
    const quoted =
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"));
    if (quoted && value.length >= 2) value = value.slice(1, -1);
    out[key] = value;
  }
  return out;
}

/**
 * This node's fleet suffix ("11" for machine bare-ai-11).
 * Order matches bare-role-sync.py: explicit override, then the node_id files,
 * then the tailnet address. Returns '' when none can be determined, and the
 * caller then declines the Vault path rather than guessing which node it is.
 */
export function nodeSuffix(home, env, deps) {
  const candidates = [];
  const override = String(env.BARE_NODE_SUFFIX || '').trim();
  if (override) candidates.push(override);
  for (const rel of ['.bare-ai/node_id', '.bare-ai/config/node_id']) {
    try {
      candidates.push(String(deps.readFile(join(home, rel), 'utf8')).trim());
    } catch {
      // Not present on this node; try the next source.
    }
  }
  for (const value of candidates) {
    const digits = value.replace(/[^0-9]/g, '');
    if (digits) return String(Number(digits)).padStart(2, '0');
  }
  try {
    const out = String(deps.execCapture('tailscale', ['ip', '-4']) || '');
    for (const line of out.split(LF)) {
      const parts = line.trim().split('.');
      if (
        parts.length === 4 &&
        parts[0] === '100' &&
        /^[0-9]+$/.test(parts[3])
      ) {
        return String(Number(parts[3])).padStart(2, '0');
      }
    }
  } catch {
    // tailscale absent or offline; the caller falls back to local.
  }
  return '';
}

/**
 * Obtain this node's own API key from Vault.
 *
 * WHY: the launcher does not export a council key, so without this the node would
 * always take the local-fallback path. The node already holds an AppRole and a
 * machine secret, so the key can be fetched at use time rather than configured
 * twice in two places.
 *
 * Both AppRole classes are supported, as measured on this fleet: a CIDR-bound role
 * with a stale VAULT_SECRET_ID still present makes Vault answer HTTP 400, so a 400
 * with a secret_id is retried role_id-only. Never throws: every failure comes back
 * as a reason, so the caller degrades to local instead of dying at launch.
 */
export async function fetchVaultKey(options) {
  const env = options.env || {};
  const home = options.home;
  const deps = options.deps;
  const timeoutMs = options.timeoutMs || 3000;

  let text = '';
  try {
    text = String(
      deps.readFile(join(home, '.bare-ai', 'config', 'vault.env'), 'utf8'),
    );
  } catch {
    return { key: '', reason: 'no-vault-env' };
  }
  const vault = parseVaultEnv(text);
  const addr = String(vault.VAULT_ADDR || '').replace(SLASHES, '');
  const roleId = String(vault.VAULT_ROLE_ID || '').trim();
  if (!addr || !roleId) return { key: '', reason: 'incomplete-vault-env' };

  const suffix = nodeSuffix(home, env, deps);
  if (!suffix) return { key: '', reason: 'no-node-suffix' };

  const Controller = globalThis.AbortController;
  const controller = new Controller();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const call = (url, init) =>
    options.fetchImpl(url, {
      ...init,
      signal: controller.signal,
      ...(options.fetchOptions || {}),
    });

  try {
    const ident = { role_id: roleId };
    if (vault.VAULT_SECRET_ID) ident.secret_id = vault.VAULT_SECRET_ID;
    const login = (payload) =>
      call(addr + '/v1/auth/approle/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

    let res = await login(ident);
    if (!res.ok && res.status === 400 && ident.secret_id) {
      delete ident.secret_id;
      res = await login(ident);
    }
    if (!res.ok) return { key: '', reason: 'vault-login-' + res.status };
    const body = await res.json().catch(() => null);
    const token = body && body.auth && body.auth.client_token;
    if (!token) return { key: '', reason: 'vault-login-no-token' };

    const secretPath = 'secret/data/machines/bare-ai-' + suffix;
    const secretRes = await call(addr + '/v1/' + secretPath, {
      method: 'GET',
      headers: { 'X-Vault-Token': token },
    });
    if (!secretRes.ok)
      return { key: '', reason: 'vault-read-' + secretRes.status };
    const secretBody = await secretRes.json().catch(() => null);
    const data = (secretBody && secretBody.data && secretBody.data.data) || {};
    const key = String(data.taskbus_api_key || data.api_key || '').trim();
    if (!key) return { key: '', reason: 'no-key-in-machine-secret' };
    return { key, reason: 'vault' };
  } catch (err) {
    const timedOut = err && err.name === 'AbortError';
    return {
      key: '',
      reason: timedOut ? 'vault-timeout' : 'vault-unreachable',
    };
  } finally {
    clearTimeout(timer);
  }
}

export async function runRoleSync(options) {
  const env = options.env || {};
  const home = options.home || homedir();
  const deps = {
    readFile: readFileSync,
    copyFile: copyFileSync,
    execCapture: (cmd, args) =>
      execFileSync(cmd, args, { encoding: 'utf8', timeout: 4000 }),
    ...(options.deps || {}),
  };
  const rolePath = options.rolePath || join(home, '.bare-ai', 'role.md');
  const localRoleText = () => {
    try {
      return deps.readFile(rolePath, 'utf8');
    } catch {
      return '';
    }
  };

  const config = resolveConfig(env, home, deps.readFile);

  // No BARE_COUNCIL_API_KEY exported? Try this node's own Vault credential before
  // giving up: the node already holds an AppRole and a machine secret, so the key
  // does not have to be configured a second time in the launcher.
  if (!config.enabled && config.reason === 'no-api-key') {
    const vault = await fetchVaultKey({
      env,
      home,
      fetchImpl: options.fetchImpl,
      fetchOptions: options.fetchOptions,
      deps,
      timeoutMs: Number(env.BARE_VAULT_TIMEOUT_MS || 3000),
    });
    if (vault.key) {
      config.enabled = true;
      config.apiKey = vault.key;
      config.reason = 'api-key-from-vault';
    } else {
      config.reason = 'no-api-key: ' + vault.reason;
    }
  }
  if (!config.enabled) {
    return {
      source: 'local-fallback',
      line: '[sovereign] role: local-fallback (' + config.reason + ')',
      roleText: localRoleText(),
      injected: false,
      wrote: false,
    };
  }

  const fetched = await fetchRole(
    config,
    options.baseUrl,
    options.fetchImpl,
    options.fetchOptions,
  );
  if (!fetched.ok) {
    return {
      source: 'local-fallback',
      line: '[sovereign] role: local-fallback (' + fetched.reason + ')',
      roleText: localRoleText(),
      injected: false,
      wrote: false,
    };
  }

  const before = localRoleText();
  const decision = shouldReplace(before, fetched.text, config.allowShrink);
  const resolved = normaliseText(fetched.text);

  // A registry body smaller than the local copy means local holds work the
  // registry does not. Keep local, inject nothing, and say so: silently
  // swapping in the shorter body is the failure this guard exists to prevent.
  if (decision.reason === 'shrink') {
    return {
      source: 'local-kept',
      line: '[sovereign] role: local-kept (registry smaller than local)',
      roleText: before,
      injected: false,
      wrote: false,
      version: fetched.version,
      bytes: Buffer.byteLength(normaliseText(before), 'utf8'),
    };
  }
  let wrote = false;
  if (decision.replace) {
    try {
      writeRoleAtomically(rolePath, resolved, deps);
      wrote = true;
    } catch {
      return {
        source: 'local-fallback',
        line: '[sovereign] role: local-fallback (write-failed)',
        roleText: before,
        injected: false,
        wrote: false,
      };
    }
  }

  // Inject the resolved body once, by swapping the OLD role text out of the
  // prompt handoff file the launcher already built.
  let swapped = {
    applied: false,
    reason: options.promptFile ? 'no-prompt-file' : 'not-requested',
  };
  if (options.promptFile) {
    swapped = applyPromptSwap(
      options.promptFile,
      rolePrefixCandidates(before),
      resolved,
      deps,
    );
  }

  const version = fetched.version ? 'v' + fetched.version : 'unknown';
  const bytes = Buffer.byteLength(resolved, 'utf8');
  let line =
    '[sovereign] role: api (' +
    version +
    ') ' +
    fetched.alias +
    ' ' +
    bytes +
    'B';
  if (!decision.replace) line += ' cache=' + decision.reason;
  if (!swapped.applied)
    line += ' injection=' + swapped.reason + ' (applies next session)';

  return {
    source: 'api',
    line,
    roleText: resolved,
    injected: swapped.applied,
    wrote,
    version: fetched.version,
    bytes,
  };
}
