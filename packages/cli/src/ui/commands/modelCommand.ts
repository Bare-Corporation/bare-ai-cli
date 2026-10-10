/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/*
 * modelCommand.ts - bare-ai-cli Vault credential injector: a Sovereign
 * Switchboard for hot-swapping models. Forked from the upstream CLI and
 * heavily customised by Cloud Integration Corporation (Copyright 2026).
 */
import {
  ModelSlashCommandEvent,
  logModelSlashCommand,
  coreEvents,
} from '@bare-ai/core';
import {
  type CommandContext,
  CommandKind,
  type SlashCommand,
} from './types.js';
import { MessageType } from '../types.js';
import {
  applyToolModeFromCapability,
  getToolOverride,
  isToolModeLocked,
} from '../../config/toolPolicy.js';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

// ── Catalog config ──────────────────────────────────────
const COUNCIL_API_BASE_URL =
  process.env['COUNCIL_API_BASE_URL'] || 'https://api.bare-ai.net';
const CACHE_DIR = path.join(os.homedir(), '.gemini');
const CACHE_FILE = path.join(CACHE_DIR, 'models.cache.json');
const LOCAL_FILE = path.join(CACHE_DIR, 'model.local.json');

interface VaultConfig {
  api_key?: string;
  model_name?: string;
  base_url?: string;
}

// A row from the /v1/models catalogue (or from model.local.json). Only the two
// fields resolveShortcut matches on are required: these rows are external JSON,
// and a row can legitimately arrive without a base_url (normalizeEndpoint
// reports that case) or without an is_cloud flag. The guards below keep
// "absent" absent instead of fabricating a default for it.
interface CatalogEntry {
  shortcut: string;
  model_id: string;
  display_name?: string;
  provider?: string;
  is_cloud?: boolean;
  base_url?: string;
  tool_capability?: string; // 'thinker' | 'doer'
  is_free_tier?: boolean;
}

// ── Untrusted-payload narrowing ─────────────────────────────────────────────
// The catalogue, both on-disk caches and the Vault response are external JSON,
// and res.json() / JSON.parse() are typed any. Their payloads are narrowed here
// rather than asserted, which is what the no-unsafe-type-assertion rule asks
// for. Mirrors the isRecord / isCatalogEntry / extractCatalogEntries trio in
// councilCommand.ts.
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function optionalBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

// Narrow one catalogue row. A row without a string shortcut or model_id can
// never be matched by resolveShortcut, so it is dropped rather than kept as a
// half-populated entry that later fails somewhere less obvious.
function toCatalogEntry(value: unknown): CatalogEntry | undefined {
  if (!isRecord(value)) return undefined;
  const shortcut = optionalString(value['shortcut']);
  const modelId = optionalString(value['model_id']);
  if (shortcut === undefined || modelId === undefined) return undefined;
  return {
    shortcut,
    model_id: modelId,
    display_name: optionalString(value['display_name']),
    provider: optionalString(value['provider']),
    is_cloud: optionalBoolean(value['is_cloud']),
    base_url: optionalString(value['base_url']),
    tool_capability: optionalString(value['tool_capability']),
    is_free_tier: optionalBoolean(value['is_free_tier']),
  };
}

// Accept both shapes the two sources use: /v1/models wraps its rows in
// { models: [...] } while models.cache.json holds the bare array. Anything else
// yields no rows, so a corrupt or stale cache degrades to "unknown model"
// instead of throwing out of the slash command.
function extractCatalogEntries(value: unknown): CatalogEntry[] {
  const list = Array.isArray(value)
    ? value
    : isRecord(value) && Array.isArray(value['models'])
      ? value['models']
      : [];
  const out: CatalogEntry[] = [];
  for (const item of list) {
    const entry = toCatalogEntry(item);
    if (entry) out.push(entry);
  }
  return out;
}

// Vault KV v2 answers with { data: { data: {...}, metadata: {...} } }; the
// legacy v1 path serves the fields directly under { data: {...} }. Anything
// else returns undefined, which is the "not found" case the caller reports.
function extractVaultConfig(value: unknown): VaultConfig | undefined {
  if (!isRecord(value)) return undefined;
  const raw = value['data'];
  if (!isRecord(raw)) return undefined;
  const inner = isRecord(raw['data']) ? raw['data'] : raw;
  return {
    api_key: optionalString(inner['api_key']),
    model_name: optionalString(inner['model_name']),
    base_url: optionalString(inner['base_url']),
  };
}

// Baked fallback: minimal local sovereign entries used when the central
// catalog is unreachable OR has not yet published the model. Central and
// model.local.json entries always win; this only fills resolution gaps so
// `/model qwen-flash` / `/model Qwen3.8-Flash-Next` still hot-swap to the
// .13 sovereign engine (OpenAI-compatible llama.cpp server).
const BAKED_LOCAL_MODELS: CatalogEntry[] = [
  {
    shortcut: 'qwen-flash',
    model_id: 'Qwen3.8-Flash-Next',
    display_name: 'Qwen3.8-Flash-Next (sovereign .13)',
    provider: 'ollama',
    is_cloud: false,
    base_url: 'http://[INTERNAL_NODE]:8081',
    tool_capability: 'thinker',
    is_free_tier: true,
  },
];

// Optional usage tracking: per-install AGENT_ID (written by
// setup_bare-ai-worker.sh). Resolution order: process.env.AGENT_ID, then
// ~/.bare-ai/config/agent.env. Absent/empty -> send no header; never throws.
function getAgentId(): string | undefined {
  const fromEnv = (process.env['AGENT_ID'] || '').trim();
  if (fromEnv) return fromEnv;
  try {
    const txt = fs.readFileSync(
      path.join(os.homedir(), '.bare-ai/config/agent.env'),
      'utf8',
    );
    const m = txt.match(/^\s*export\s+AGENT_ID\s*=\s*["']?([^"'\s]+)/m);
    if (m && m[1]) return m[1].trim();
  } catch {
    // agent.env missing/unreadable -> send no header
  }
  return undefined;
}

// Fetch /v1/models fresh, cache to disk, fall back to cache offline.
async function loadCatalog(): Promise<CatalogEntry[]> {
  try {
    const headers: Record<string, string> = {};
    const agentId = getAgentId();
    if (agentId) headers['X-Agent-Id'] = agentId;
    const res = await fetch(`${COUNCIL_API_BASE_URL}/v1/models`, {
      headers,
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) throw new Error(`catalog HTTP ${res.status}`);
    // Untrusted JSON: narrowed, never asserted (ticket 208).
    const models = extractCatalogEntries(await res.json());
    // atomic cache write: temp + rename
    try {
      if (!fs.existsSync(CACHE_DIR))
        fs.mkdirSync(CACHE_DIR, { recursive: true });
      const tmp = CACHE_FILE + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(models));
      fs.renameSync(tmp, CACHE_FILE);
    } catch {
      // caching is best-effort; ignore write errors
    }
    return models;
  } catch {
    // offline / endpoint down: fall back to the cached snapshot. The cache is
    // untrusted as well: JSON.parse is any, and an older CLI could have written
    // the whole response instead of the bare array, so narrow it rather than
    // assert it. A payload in neither shape reads as "no catalogue".
    try {
      const cached: unknown = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
      return extractCatalogEntries(cached);
    } catch {
      return [];
    }
  }
}

// Load user's local Ollama models (optional). Only provider=ollama
// entries are honored; collisions with the central catalog are dropped
// (central always wins).
function loadLocalModels(
  centralShortcuts: Set<string>,
  centralIds: Set<string>,
): CatalogEntry[] {
  try {
    if (!fs.existsSync(LOCAL_FILE)) return [];
    // Untrusted JSON too: each row goes through the same guard the catalogue
    // uses (so a row without a string shortcut or model_id is dropped instead
    // of being stringified), then the Ollama-only rules are applied.
    const parsed: unknown = JSON.parse(fs.readFileSync(LOCAL_FILE, 'utf8'));
    const list =
      isRecord(parsed) && Array.isArray(parsed['models'])
        ? parsed['models']
        : [];
    const out: CatalogEntry[] = [];
    for (const item of list) {
      const entry = toCatalogEntry(item);
      if (!entry) continue;
      if ((entry.provider || 'ollama') !== 'ollama') continue; // local file is Ollama-only
      if (
        centralShortcuts.has(entry.shortcut) ||
        centralIds.has(entry.model_id)
      )
        continue; // central wins
      out.push({
        shortcut: entry.shortcut,
        model_id: entry.model_id,
        provider: 'ollama',
        is_cloud: false,
        base_url: entry.base_url || 'http://127.0.0.1:11434',
        tool_capability:
          entry.tool_capability === 'thinker' ? 'thinker' : 'doer',
      });
    }
    return out;
  } catch {
    return [];
  }
}

// Resolve a shortcut (or exact model_id) against merged catalog+local,
// then the baked fallback (last resort, so central/local always win).
async function resolveShortcut(id: string): Promise<CatalogEntry | null> {
  const central = await loadCatalog();
  const centralShortcuts = new Set(central.map((m) => m.shortcut));
  const centralIds = new Set(central.map((m) => m.model_id));
  const local = loadLocalModels(centralShortcuts, centralIds);
  const all = [...central, ...local];
  return (
    all.find((m) => m.shortcut === id) ||
    all.find((m) => m.model_id === id) ||
    BAKED_LOCAL_MODELS.find((m) => m.shortcut === id) ||
    BAKED_LOCAL_MODELS.find((m) => m.model_id === id) ||
    null
  );
}

// Normalize a catalog base_url into a ready-to-POST completions URL.
// The catalog is NOT guaranteed to ship fully-formed endpoints: Ollama
// entries carry a bare host:port with no scheme, and some cloud entries
// (google, bare-ai council) omit the /chat/completions suffix.
function normalizeEndpoint(entry: CatalogEntry): string {
  let base = (entry.base_url ?? '').trim();
  if (!base) {
    throw new Error(
      'Catalog entry "' + entry.model_id + '" is missing base_url',
    );
  }
  if (!base.startsWith('http://') && !base.startsWith('https://')) {
    base = 'http://' + base;
  }
  while (base.endsWith('/')) {
    base = base.slice(0, -1);
  }
  if (base.endsWith('/chat/completions')) {
    return base;
  }
  // WHY the /v1 branch: the catalogue carries versioned roots as well as bare
  // hosts. A local engine publishes "http://100.64.0.20:8002/v1", so appending
  // "/v1/chat/completions" unconditionally produced
  // ".../v1/v1/chat/completions" and the in-session /model hot-swap refused to
  // connect. Mirrors toCompletionsUrl() in sovereign.js, which needed the same
  // normalisation for the launch-time route.
  if (base.endsWith('/v1')) {
    return base + '/chat/completions';
  }
  if (entry.provider === 'ollama' || entry.is_cloud === false) {
    return base + '/v1/chat/completions';
  }
  return base + '/chat/completions';
}

// Fetch per-model runtime config (api_key + model_name) from the USER's
// own Vault. Only used for cloud/council models. KV v2 with v1 fallback.
// Provider -> per-provider Vault path key (mirrors sovereign.js / council
// python PROVIDER_VAULT_ROUTES; case-insensitive because the catalog stores
// display casing like DeepSeek/Anthropic/Google).
const VAULT_PROVIDER_KEY: Record<string, string> = {
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

function vaultKeyForProvider(provider?: string): string | null {
  if (!provider) return null;
  const low = provider.toLowerCase();
  for (const key of Object.keys(VAULT_PROVIDER_KEY)) {
    if (key.toLowerCase() === low) return VAULT_PROVIDER_KEY[key];
  }
  return null;
}

// Fetch runtime config (api_key + model_name) from the USER's own Vault.
// Cloud/council models use the per-PROVIDER path (one secret per provider,
// since 2026-09-01). Legacy per-model paths remain only as a last resort.
async function fetchVaultUpdate(modelName: string, provider?: string) {
  const addr = process.env['VAULT_ADDR'];
  const vaultToken = process.env['VAULT_TOKEN'];
  if (!addr || !vaultToken)
    throw new Error('Sovereign environment not initialized.');

  const routeKey = vaultKeyForProvider(provider);
  let path = routeKey
    ? `secret/data/${routeKey}/config`
    : `secret/data/${modelName}/config`;
  let res = await fetch(`${addr}/v1/${path}`, {
    headers: { 'X-Vault-Token': vaultToken },
  });
  // res.json() is any: keep it unknown for the diagnostic below and narrow it
  // with extractVaultConfig instead of asserting the response shape.
  let payload: unknown = await res.json();

  if (res.status === 404 || res.status === 403) {
    path = `secret/${modelName}/config`;
    res = await fetch(`${addr}/v1/${path}`, {
      headers: { 'X-Vault-Token': vaultToken },
    });
    payload = await res.json();
  }

  const configData = extractVaultConfig(payload);
  if (!configData) {
    // Preserved verbatim: the Vault misconfiguration diagnostic is user-visible
    // on stdout today, so swapping it for the logger would be a behaviour change
    // beyond this fix. Silenced instead. (Pre-existing.)
    // eslint-disable-next-line no-console
    console.error(
      `\n[Vault Debug] Failed Response from Vault:`,
      JSON.stringify(payload),
    );
    throw new Error(`Model configuration not found at Vault path: ${path}`);
  }
  return configData;
}

const setModelCommand: SlashCommand = {
  name: 'set',
  description:
    'Set the model to use. Usage: /model set <model-name> [--persist]',
  kind: CommandKind.BUILT_IN,
  autoExecute: false,
  action: async (context: CommandContext, args: string) => {
    const parts = args.trim().split(/\s+/).filter(Boolean);
    if (parts.length === 0) {
      context.ui.addItem({
        type: MessageType.ERROR,
        text: 'Usage: /model set <model-name> [--persist]',
      });
      return;
    }
    const modelName = parts[0];
    const persist = parts.includes('--persist');
    if (context.services.config) {
      context.services.config.setModel(modelName, !persist);
      const event = new ModelSlashCommandEvent(modelName);
      logModelSlashCommand(context.services.config, event);
      context.ui.addItem({
        type: MessageType.INFO,
        text: `Model set to ${modelName}${persist ? ' (persisted)' : ''}`,
      });
    }
  },
};

const manageModelCommand: SlashCommand = {
  name: 'manage',
  description: 'Opens a dialog to configure the model',
  kind: CommandKind.BUILT_IN,
  autoExecute: true,
  action: async (context: CommandContext) => {
    if (context.services.config) {
      await context.services.config.refreshUserQuota();
    }
    return { type: 'dialog', dialog: 'model' };
  },
};

export const modelCommand: SlashCommand = {
  name: 'model',
  description:
    'Manage model configuration or switch via Sovereign ID (e.g., /model 101)',
  kind: CommandKind.BUILT_IN,
  autoExecute: false,
  subCommands: [manageModelCommand, setModelCommand],
  action: async (context: CommandContext, args: string) => {
    const id = args.trim();

    // 3-digit Sovereign ID OR exact model name
    if (/^\d{3}$/.test(id) || id.includes(':') || id.includes('-')) {
      context.ui.addItem({
        type: MessageType.INFO,
        text: `[sovereign] Translating ID ${id}...`,
      });

      const entry = await resolveShortcut(id);
      if (!entry) {
        context.ui.addItem({
          type: MessageType.ERROR,
          text: `[sovereign] Unknown model or shortcut: ${id}`,
        });
        return;
      }

      context.ui.addItem({
        type: MessageType.INFO,
        text: `[sovereign] Swapping to model ${entry.model_id}...`,
      });

      try {
        // Resolve the tool policy AFTER the swap targets are known but never
        // from the catalogue alone: a caller override outranks tool_capability,
        // so a doer row can no longer re-enable tools behind the caller's back
        // (Ticket 164). See config/toolPolicy.ts for the precedence rules.
        const toolLocked = isToolModeLocked();

        // Prefer the user's own Vault runtime config when available (mirrors
        // sovereign.js): a Vault base_url wins for the endpoint, otherwise the
        // catalog entry is used. Vault unavailability (no VAULT_ADDR/VAULT_TOKEN,
        // fetch error, or missing base_url) is not fatal — fall back to catalog.
        let config: VaultConfig | undefined;
        try {
          config = await fetchVaultUpdate(entry.model_id, entry.provider);
        } catch {
          config = undefined; // Vault unavailable -> catalog fallback
        }

        if (config?.base_url) {
          const vaultBase = config.base_url.trim();
          // Same rule sovereign.js uses: keep fully-formed endpoints, else
          // append the OpenAI-compatible completions path.
          process.env['BARE_AI_ENDPOINT'] =
            vaultBase.includes('completions') || vaultBase.includes('messages')
              ? vaultBase
              : `${vaultBase}/v1/chat/completions`;
        } else {
          process.env['BARE_AI_ENDPOINT'] = normalizeEndpoint(entry);
        }

        process.env['BARE_AI_API_KEY'] = (config?.api_key || 'none').trim();
        process.env['BARE_AI_MODEL'] = (
          config?.model_name || entry.model_id
        ).trim();
        // The helper writes BARE_AI_NO_TOOLS: it honours a caller override and
        // only consults tool_capability when nothing was locked for this run.
        const noTools = applyToolModeFromCapability(entry.tool_capability);
        if (noTools) {
          context.ui.addItem({
            type: MessageType.INFO,
            text: `[sovereign] Pure Reasoning mode engaged (Tools disabled).`,
          });
        }
        if (toolLocked) {
          context.ui.addItem({
            type: MessageType.INFO,
            text: `[sovereign] Tool policy '${getToolOverride()}' locked by the caller; this model's tool_capability '${entry.tool_capability}' was not applied.`,
          });
        }

        const finalModel = (config?.model_name || entry.model_id).trim();
        context.services.config?.setModel(finalModel, false);
        coreEvents.emitModelChanged(finalModel);
        context.ui.addItem({
          type: MessageType.INFO,
          text: `[sovereign] Hot-swap successful${entry.is_cloud ? '' : ' (local)'}.`,
        });
      } catch (err: unknown) {
        const reason = err instanceof Error ? err.message : String(err);
        context.ui.addItem({
          type: MessageType.ERROR,
          text: `[sovereign] Swap failed: ${reason}`,
        });
      }
      return;
    }
    return manageModelCommand.action!(context, args);
  },
};
