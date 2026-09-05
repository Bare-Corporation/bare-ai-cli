#!/usr/bin/env node
/* eslint-disable no-undef, @typescript-eslint/no-unused-vars */
/**
############################################################
#    ____ _                 _ _       ____        #
#   / ___| | ___  _   _  ___| (_)_ __ | |_     / ___|___   #
#  | |   | |/ _ \| | | |/ __| | | '_ \| __|   | |   / _ \  #
#  | |___| | (_) | |_| | (__| | | | | | |_    | |__| (_) | #
#   \____|_|\___/ \__,_|\___|_|_|_| |_|\__|    \____\___/  #
#                                                          #
#   by Cloud Integration Corporation                        #
############################################################
 * sovereign.js — bare-ai-cli Vault credential injector
 * v2 (2026-08-31): provider-based routing.
 *   Cloud models: resolve model_id -> provider from the model catalog
 *   (Council API /v1/models, cached at ~/.bare-ai/model-catalog.json),
 *   fetch api_key from ONE per-provider Vault path
 *   (secret/data/gpt|gemini|claude|z|deepseek/config), take base_url
 *   and model_name from the catalog row.
 *   Fallback: local/Ollama models and legacy per-model paths keep the
 *   original behavior (VAULT_SECRET_PATH as provided by the launcher).
 *
 * REQUIRED Environment Variables (Set in your shell/profile):
 * export VAULT_ADDR="https://your-vault-ip:8200"
 * export VAULT_ROLE_ID="your-role-id"
 * export VAULT_SECRET_ID="your-secret-id"
 * export VAULT_SECRET_PATH="secret/data/models/gemini-flash"
 */
import { spawn } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

// Internal routing bypass for self-signed Vault/Tailscale certs
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

// Global Config from Environment
const {
  VAULT_ADDR,
  VAULT_ROLE_ID,
  VAULT_SECRET_ID,
  VAULT_SECRET_PATH
} = process.env;

// Halt if mandatory security variables are missing
if (!VAULT_ROLE_ID || !VAULT_SECRET_ID || !VAULT_ADDR || !VAULT_SECRET_PATH) {
  console.error('[sovereign] ERROR: Missing Vault environment variables.');
  console.error('[sovereign] Ensure ADDR, ROLE_ID, SECRET_ID, and PATH are exported.');
  process.exit(1);
}

// Provider -> per-provider Vault path key (one secret per provider).
const PROVIDER_VAULT_KEY = {
  openai: 'openai',
  google: 'gemini',
  anthropic: 'claude',
  deepseek: 'deepseek',
  'z.ai': 'z.ai',
  zai: 'zai',
  'Alibaba-cn-beijing': 'Alibaba-cn-beijing',
  'Alibaba-eu-central-1': 'Alibaba-eu-central-1',
  'Alibaba-ap-southeast-1': 'Alibaba-ap-southeast-1',
  'Alibaba-us-east-1': 'Alibaba-us-east-1',
  ollama: 'ollama',
};

// Council stores provider display casing (DeepSeek, Anthropic, Google,
// Alibaba-*), while the map above is keyed lowercase + exact Alibaba DC names.
// Look up case-insensitively so a casing change never breaks key resolution.
function vaultKeyForProvider(provider) {
  if (!provider) return null;
  const low = String(provider).toLowerCase();
  for (const key of Object.keys(PROVIDER_VAULT_KEY)) {
    if (String(key).toLowerCase() === low) return PROVIDER_VAULT_KEY[key];
  }
  return null;
}

// Offline fallback: if the catalog is unreachable/cached-miss, still route
// well-known cloud model prefixes to the correct per-provider Vault secret and
// a built-in endpoint. Provider secrets only carry api_key (since 2026-09-01).
const PREFIX_ROUTE = {
  'deepseek-': { key: 'deepseek', baseUrl: 'https://api.deepseek.com/v1/chat/completions' },
  'claude-': { key: 'claude', baseUrl: 'https://api.anthropic.com/v1/messages' },
  'gemini-': { key: 'gemini', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions' },
  'gpt-': { key: 'openai', baseUrl: 'https://api.openai.com/v1/chat/completions' },
};
function modelPrefixRoute(modelId) {
  const low = String(modelId || '').toLowerCase();
  for (const prefix of Object.keys(PREFIX_ROUTE)) {
    if (low.startsWith(prefix)) return PREFIX_ROUTE[prefix];
  }
  return null;
}

const CATALOG_CACHE = process.env.CATALOG_CACHE || join(homedir(), '.bare-ai/model-catalog.json');
const COUNCIL_API_BASE_URL = process.env.COUNCIL_API_BASE_URL || 'https://api.bare-ai.net';
const CATALOG_MAX_AGE_SEC = Number(process.env.CATALOG_MAX_AGE_SEC || 3600);

// Extract the model id from argv (--model <id> or first positional).
function modelFromArgs(argv) {
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--model' && argv[i + 1]) return argv[i + 1];
  }
  for (const a of argv) {
    if (!a.startsWith('-') && !a.startsWith('http') && !a.includes(' ') && !a.includes(':')) return a;
  }
  return null;
}

// Optional usage tracking: per-install AGENT_ID (written by
// setup_bare-ai-worker.sh). Resolution order: process.env.AGENT_ID, then
// ~/.bare-ai/config/agent.env. Absent/empty -> send no header; never throws.
function getAgentId() {
  const fromEnv = (process.env.AGENT_ID || '').trim();
  if (fromEnv) return fromEnv;
  try {
    const txt = readFileSync(join(homedir(), '.bare-ai/config/agent.env'), 'utf8');
    const m = txt.match(/^\s*export\s+AGENT_ID\s*=\s*["']?([^"'\s]+)/m);
    if (m && m[1]) return m[1].trim();
  } catch (_) { /* agent.env missing/unreadable -> send no header */ }
  return undefined;
}

// Read catalog cache if fresh; else fetch from Council API (in-memory only).
async function loadCatalog() {
  try {
    const st = statSync(CATALOG_CACHE);
    if (Date.now() - st.mtimeMs < CATALOG_MAX_AGE_SEC * 1000) {
      const parsed = JSON.parse(readFileSync(CATALOG_CACHE, 'utf8'));
      if (parsed && Array.isArray(parsed.models)) return parsed.models;
    }
  } catch (_) { /* cache missing or stale -> fetch */ }
  try {
    const headers = { Accept: 'application/json' };
    const agentId = getAgentId();
    if (agentId) headers['X-Agent-Id'] = agentId;
    const res = await fetch(`${COUNCIL_API_BASE_URL}/v1/models`, {
      headers,
      signal: AbortSignal.timeout(8000),
    });
    if (res.ok) {
      const parsed = await res.json();
      if (parsed && Array.isArray(parsed.models)) return parsed.models;
    }
  } catch (_) { /* network unavailable -> fallback to legacy */ }
  return null;
}

/**
 * Resolve routing target for a model id.
 * Returns { vaultPath, baseUrl, modelName, cloud } where cloud=true means
 * per-provider routing (baseUrl/modelName come from catalog) and cloud=false
 * means legacy VAULT_SECRET_PATH routing (config supplies everything).
 */
async function resolveTarget(modelId) {
  if (modelId) {
    const rows = await loadCatalog();
    if (rows) {
      const row = rows.find(r => r.model_id === modelId);
      const key = row ? vaultKeyForProvider(row.provider) : null;
      if (row && key && row.is_cloud) {
        return {
          vaultPath: `secret/data/${key}/config`,
          baseUrl: (row.base_url || '').trim(),
          modelName: (row.model_id || modelId).trim(),
          cloud: true,
        };
      }
    }
    // Catalog loaded but model not found as a cloud row -> no provider route.
  } else {
    return { vaultPath: VAULT_SECRET_PATH, baseUrl: null, modelName: null, cloud: false };
  }
  // Offline / prefix fallback for well-known cloud models.
  const pref = modelPrefixRoute(modelId);
  if (pref) {
    return {
      vaultPath: `secret/data/${pref.key}/config`,
      baseUrl: pref.baseUrl,
      modelName: modelId,
      cloud: true,
    };
  }
  return { vaultPath: VAULT_SECRET_PATH, baseUrl: null, modelName: null, cloud: false };
}

/**
 * Orchestrates Vault Auth and Config Retrieval
 * Returns both the configuration data and the temporary session token
 */
async function getVaultContext(vaultPath) {
  // 1. AppRole Login
  const loginRes = await fetch(`${VAULT_ADDR}/v1/auth/approle/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ role_id: VAULT_ROLE_ID, secret_id: VAULT_SECRET_ID }),
  });
  const loginData = await loginRes.json();
  if (!loginData.auth) throw new Error(`Vault login failed: ${JSON.stringify(loginData)}`);

  const token = loginData.auth.client_token;

  // 2. Fetch model config using the token
  const secretRes = await fetch(`${VAULT_ADDR}/v1/${vaultPath}`, {
    headers: { 'X-Vault-Token': token },
  });
  const secretData = await secretRes.json();
  if (!secretData?.data?.data) throw new Error(`Path ${vaultPath} returned no data.`);

  return {
    config: secretData.data.data,
    token: token
  };
}

async function main() {
  try {
    const modelId = modelFromArgs(process.argv.slice(2));
    const target = await resolveTarget(modelId);

    console.error(`[sovereign] Synchronizing with Vault... (route=${target.cloud ? 'provider:' + target.vaultPath : 'legacy:' + target.vaultPath})`);
    const { config, token } = await getVaultContext(target.vaultPath);
    console.error('[sovereign] Vault context secured. Launching Bare AI CLI...\n');

    const baseUrl = (target.cloud ? target.baseUrl : (config.base_url || '')).trim();
    const modelName = (target.cloud ? target.modelName : (config.model_name || '')).trim();

    if (!baseUrl) throw new Error(`base_url empty for ${modelId || target.vaultPath}`);

    const secureEnv = {
      ...process.env,
      // Dynamic endpoint logic
      BARE_AI_ENDPOINT: baseUrl.includes('completions') || baseUrl.includes('messages')
        ? baseUrl
        : `${baseUrl}/v1/chat/completions`,

      BARE_AI_API_KEY: (config.api_key || 'none').trim(),
      BARE_AI_MODEL:   modelName,

      // Temporary token for mid-session hot-swapping
      VAULT_TOKEN: token,

      // Mock key to satisfy internal Google SDK checks
      GEMINI_API_KEY: 'bare-ai-local',
    };

    // SECURITY: Scrub master keys before spawning the child process
    delete secureEnv.VAULT_ROLE_ID;
    delete secureEnv.VAULT_SECRET_ID;

    // Dynamically inject the system prompt if the bash script provided one
    const spawnArgs = ['bundle/bare-ai.js', '--yolo'];
    if (process.env.BARE_AI_SYSTEM_PROMPT) {
        spawnArgs.push('-i', process.env.BARE_AI_SYSTEM_PROMPT);
    }

    // Append any extra arguments the user passed (like --model)
    spawnArgs.push(...process.argv.slice(2));

    const cli = spawn('node', spawnArgs, {
      stdio: 'inherit',
      env: secureEnv,
    });

    cli.on('close', code => process.exit(code));
  } catch (err) {
    console.error('[sovereign] Security halt:', err.message);
    process.exit(1);
  }
}

main();
