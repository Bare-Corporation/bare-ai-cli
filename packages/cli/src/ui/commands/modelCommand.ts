/**
############################################################
#    ____ _                 _ _       ___      ____        #
#   / ___| | ___  _   _  ___| (_)_ __ | |_     / ___|___   #
#  | |   | |/ _ \| | | |/ __| | | '_ \| __|   | |   / _ \  #
#  | |___| | (_) | |_| | (__| | | | | | |_    | |__| (_) | #
#   \____|_|\___/ \__,_|\___|_|_|_| |_|\__|    \____\___/  #
#                                                          #
#                                                          #
#   by Cloud Integration Corporation                       #
############################################################
 * modelCommand.ts — bare-ai-cli Vault credential injector
 * implements a Sovereign Switchboard for hot-swapping ai models.
 * @license
 * Copyright 2026 Cloud Integration Corporation
 * Copyright 2025 Google LLC (The orignal creator of this file but heavily Customised by CIC)
 * SPDX-License-Identifier: Apache-2.0
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
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

// ── Catalog config ──────────────────────────────────────
const COUNCIL_API_BASE_URL =
  process.env['COUNCIL_API_BASE_URL'] || 'https://api.bare-ai.net';
const CACHE_DIR = path.join(os.homedir(), '.gemini');
const CACHE_FILE = path.join(CACHE_DIR, 'models.cache.json');
const LOCAL_FILE = path.join(CACHE_DIR, 'model.local.json');

interface ModelsResponse {
  models?: CatalogEntry[];
  count?: number;
}

interface VaultConfig {
  api_key?: string;
  model_name?: string;
  base_url?: string;
}

interface VaultResponse {
  data?: { data: VaultConfig } | VaultConfig;
}

interface LocalModelsFile {
  models?: Array<{
    shortcut?: string;
    model_id?: string;
    provider?: string;
    base_url?: string;
    tool_capability?: string;
  }>;
}

interface CatalogEntry {
  shortcut: string;
  model_id: string;
  display_name?: string;
  provider: string;
  is_cloud: boolean;
  base_url: string;
  tool_capability: string; // 'thinker' | 'doer'
  is_free_tier?: boolean;
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
    base_url: 'http://100.64.0.13:8081',
    tool_capability: 'thinker',
    is_free_tier: true,
  },
];

// Fetch /v1/models fresh, cache to disk, fall back to cache offline.
async function loadCatalog(): Promise<CatalogEntry[]> {
  try {
    const res = await fetch(`${COUNCIL_API_BASE_URL}/v1/models`, {
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) throw new Error(`catalog HTTP ${res.status}`);
    const json = (await res.json()) as ModelsResponse;
    const models: CatalogEntry[] = json.models ?? [];
    // atomic cache write: temp + rename
    try {
      if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });
      const tmp = CACHE_FILE + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(models));
      fs.renameSync(tmp, CACHE_FILE);
    } catch {
      // caching is best-effort; ignore write errors
    }
    return models;
  } catch {
    // offline / endpoint down: fall back to cached snapshot
    try {
      return JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8')) as CatalogEntry[];
    } catch {
      return [];
    }
  }
}

// Load user's local Ollama models (optional). Only provider=ollama
// entries are honored; collisions with the central catalog are dropped
// (central always wins).
function loadLocalModels(centralShortcuts: Set<string>, centralIds: Set<string>): CatalogEntry[] {
  try {
    if (!fs.existsSync(LOCAL_FILE)) return [];
    const parsed = JSON.parse(fs.readFileSync(LOCAL_FILE, 'utf8')) as LocalModelsFile;
    const list = parsed.models ?? [];
    const out: CatalogEntry[] = [];
    for (const m of list) {
      if ((m?.provider || 'ollama') !== 'ollama') continue; // local file is Ollama-only
      if (!m?.shortcut || !m?.model_id) continue;
      if (centralShortcuts.has(m.shortcut) || centralIds.has(m.model_id)) continue; // central wins
      out.push({
        shortcut: String(m.shortcut),
        model_id: String(m.model_id),
        provider: 'ollama',
        is_cloud: false,
        base_url: String(m.base_url || 'http://127.0.0.1:11434'),
        tool_capability: (m.tool_capability === 'thinker') ? 'thinker' : 'doer',
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
    throw new Error('Catalog entry "' + entry.model_id + '" is missing base_url');
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
  if (entry.provider === 'ollama' || entry.is_cloud === false) {
    return base + '/v1/chat/completions';
  }
  return base + '/chat/completions';
}

// Fetch per-model runtime config (api_key + model_name) from the USER's
// own Vault. Only used for cloud/council models. KV v2 with v1 fallback.
async function fetchVaultUpdate(modelName: string) {
  const addr = process.env['VAULT_ADDR'];
  const vaultToken = process.env['VAULT_TOKEN'];
  if (!addr || !vaultToken) throw new Error('Sovereign environment not initialized.');

  let path = `secret/data/${modelName}/config`;
  let res = await fetch(`${addr}/v1/${path}`, {
    headers: { 'X-Vault-Token': vaultToken },
  });
  let json = (await res.json()) as VaultResponse;

  if (res.status === 404 || res.status === 403) {
    path = `secret/${modelName}/config`;
    res = await fetch(`${addr}/v1/${path}`, {
      headers: { 'X-Vault-Token': vaultToken },
    });
    json = (await res.json()) as VaultResponse;
  }

  const raw = json?.data;
  const configData: VaultConfig | undefined =
    raw && 'data' in raw ? raw.data : raw;
  if (!configData) {
    console.error(`\n[Vault Debug] Failed Response from Vault:`, JSON.stringify(json));
    throw new Error(`Model configuration not found at Vault path: ${path}`);
  }
  return configData;
}

const setModelCommand: SlashCommand = {
  name: 'set',
  description: 'Set the model to use. Usage: /model set <model-name> [--persist]',
  kind: CommandKind.BUILT_IN,
  autoExecute: false,
  action: async (context: CommandContext, args: string) => {
    const parts = args.trim().split(/\s+/).filter(Boolean);
    if (parts.length === 0) {
      context.ui.addItem({ type: MessageType.ERROR, text: 'Usage: /model set <model-name> [--persist]' });
      return;
    }
    const modelName = parts[0];
    const persist = parts.includes('--persist');
    if (context.services.config) {
      context.services.config.setModel(modelName, !persist);
      const event = new ModelSlashCommandEvent(modelName);
      logModelSlashCommand(context.services.config, event);
      context.ui.addItem({ type: MessageType.INFO, text: `Model set to ${modelName}${persist ? ' (persisted)' : ''}` });
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
  description: 'Manage model configuration or switch via Sovereign ID (e.g., /model 101)',
  kind: CommandKind.BUILT_IN,
  autoExecute: false,
  subCommands: [manageModelCommand, setModelCommand],
  action: async (context: CommandContext, args: string) => {
    const id = args.trim();

    // 3-digit Sovereign ID OR exact model name
    if (/^\d{3}$/.test(id) || id.includes(':') || id.includes('-')) {
      context.ui.addItem({ type: MessageType.INFO, text: `[sovereign] Translating ID ${id}...` });

      const entry = await resolveShortcut(id);
      if (!entry) {
        context.ui.addItem({ type: MessageType.ERROR, text: `[sovereign] Unknown model or shortcut: ${id}` });
        return;
      }

      context.ui.addItem({ type: MessageType.INFO, text: `[sovereign] Swapping to model ${entry.model_id}...` });

      try {
        const noTools = entry.tool_capability === 'thinker';

        if (!entry.is_cloud) {
          // LOCAL OLLAMA: zero network, keyless, normalized endpoint.
          process.env['BARE_AI_ENDPOINT'] = normalizeEndpoint(entry);
          process.env['BARE_AI_API_KEY'] = 'none';
          process.env['BARE_AI_MODEL'] = entry.model_id.trim();
          process.env['BARE_AI_NO_TOOLS'] = noTools ? 'true' : 'false';
          if (noTools) {
            context.ui.addItem({ type: MessageType.INFO, text: `[sovereign] Pure Reasoning mode engaged (Tools disabled).` });
          }
          context.services.config?.setModel(entry.model_id.trim(), false);
          coreEvents.emitModelChanged(entry.model_id.trim());
          context.ui.addItem({ type: MessageType.INFO, text: `[sovereign] Hot-swap successful (local).` });
          return;
        }

        // CLOUD / COUNCIL: key from the user's own Vault; normalized endpoint.
        const config = await fetchVaultUpdate(entry.model_id);
        process.env['BARE_AI_ENDPOINT'] = normalizeEndpoint(entry);
        process.env['BARE_AI_API_KEY'] = (config.api_key || 'none').trim();
        process.env['BARE_AI_MODEL'] = (config.model_name || entry.model_id).trim();
        process.env['BARE_AI_NO_TOOLS'] = noTools ? 'true' : 'false';
        if (noTools) {
          context.ui.addItem({ type: MessageType.INFO, text: `[sovereign] Pure Reasoning mode engaged (Tools disabled).` });
        }

        const finalModel = (config.model_name || entry.model_id).trim();
        context.services.config?.setModel(finalModel, false);
        coreEvents.emitModelChanged(finalModel);
        context.ui.addItem({ type: MessageType.INFO, text: `[sovereign] Hot-swap successful.` });
      } catch (err: any) {
        context.ui.addItem({ type: MessageType.ERROR, text: `[sovereign] Swap failed: ${err.message}` });
      }
      return;
    }
    return manageModelCommand.action!(context, args);
  },
};
