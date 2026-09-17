/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import type { SlashCommand } from './types.js';
import { CommandKind } from './types.js';
import { MessageType } from '../types.js';

const execFileAsync = promisify(execFile);

const COUNCIL_BIN = process.env['BARE_COUNCIL_BIN'] || 'council.py';
const COUNCIL_TIMEOUT_MS = 15 * 60 * 1000;
const NL = String.fromCharCode(10);

// The Council API also serves the model catalog (/v1/models). It is the single
// source of truth for which models the Council can run, so the Composer and the
// council model pool are derived from it rather than hardcoded.
const COUNCIL_API_BASE_URL =
  process.env['COUNCIL_API_BASE_URL'] || 'https://api.bare-ai.net';
const CACHE_DIR = path.join(os.homedir(), '.gemini');
const CACHE_FILE = path.join(CACHE_DIR, 'models.cache.json');

// Where users top up credits or subscribe to a plan (Pro/Business).
const BILLING_URL = 'https://bare-ai.net/dashboard/workspaces/default/cost';

// The "Composer" is a single-model Council pass (one round) that reads the
// user's plain-text request and writes out the plan — which models, which roles,
// and how many debate rounds — for the real multi-model council. It runs through
// the same Council API (and therefore the same council API key) as the council
// itself. In future it will source roles from an API on bare-ai.net; for now it
// writes them each time.
const COMPOSER_ROLE = 'Bare-AI Council Composer';
const COMPOSER_ROUNDS = 1;

// A row from the Council API model catalog (/v1/models). Only the fields the
// Council needs are declared; the catalog may carry more.
interface CatalogEntry {
  shortcut: string;
  model_id: string;
  provider?: string;
  council_enabled?: boolean;
  model_tier?: string;
}

// Narrow an untyped value to a catalog entry. Both the /v1/models response and
// the on-disk cache are untrusted JSON, so we validate rather than assert.
function isCatalogEntry(value: unknown): value is CatalogEntry {
  if (!isRecord(value)) return false;
  const modelId = value['model_id'];
  const shortcut = value['shortcut'];
  return typeof modelId === 'string' && typeof shortcut === 'string';
}

// The /v1/models endpoint wraps entries in { models: [...] }; the cache stores
// the bare array. Accept either shape without asserting the payload type.
function extractCatalogEntries(value: unknown): CatalogEntry[] {
  const list = Array.isArray(value)
    ? value
    : isRecord(value) && Array.isArray(value['models'])
      ? value['models']
      : [];
  return list.filter(isCatalogEntry);
}

// Fetch the catalog fresh, cache it to disk, and fall back to the cache when the
// Council API is unreachable. Mirrors the loader in modelCommand.ts so a warm
// cache keeps /council usable offline.
async function loadCatalog(): Promise<CatalogEntry[]> {
  try {
    const res = await fetch(`${COUNCIL_API_BASE_URL}/v1/models`, {
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) throw new Error(`catalog HTTP ${res.status}`);
    const json: unknown = await res.json();
    const models = extractCatalogEntries(json);
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
    try {
      const cached: unknown = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
      return extractCatalogEntries(cached);
    } catch {
      return [];
    }
  }
}

// The Council model pool: every catalog model flagged council_enabled. This
// replaces the previously hardcoded COMPOSER_MODEL_POOL.
function councilPool(entries: CatalogEntry[]): string[] {
  return entries
    .filter((m) => m.council_enabled === true)
    .map((m) => m.model_id);
}

// Pick a single cheap-but-capable council-enabled model to run the Composer
// planning pass. Prefer Flash tier (the old deepseek-v4-flash choice), then Lite,
// then Frontier, then whatever council-enabled model is first. An operator can
// pin a specific model via BARE_COUNCIL_COMPOSER_MODEL.
function composerModel(entries: CatalogEntry[]): string | null {
  const pinned = (process.env['BARE_COUNCIL_COMPOSER_MODEL'] || '').trim();
  if (pinned) return pinned;
  const enabled = entries.filter((m) => m.council_enabled === true);
  if (enabled.length === 0) return null;
  for (const tier of ['Flash', 'Lite', 'Frontier']) {
    const hit = enabled.find((m) => m.model_tier === tier);
    if (hit) return hit.model_id;
  }
  return enabled[0].model_id;
}

// Fallback plan used if the Composer is unreachable or returns unparseable
// output. Models come from the catalog pool (first two council-enabled models);
// roles are generic because the Composer is what normally assigns them.
function defaultPlan(entries: CatalogEntry[]): CouncilPlan {
  const models = councilPool(entries).slice(0, 2);
  const roleNames = ['Senior Engineer', 'Critical Reviewer'];
  return {
    models,
    roles: models.map((_, i) => roleNames[i % roleNames.length]),
    rounds: 1,
  };
}

interface CouncilArgs {
  task: string;
  models?: string[];
  roles?: string[];
  rounds?: number;
}

interface CouncilPlan {
  models: string[];
  roles: string[];
  rounds: number;
}

interface CouncilStage {
  stage: string;
  agreed: boolean;
  rounds: number;
  final_output: string;
}

interface CouncilResult {
  job_id?: string;
  agreed?: boolean;
  duration_seconds?: number;
  cost_usd?: number;
  stages?: CouncilStage[];
}

interface ExecError extends Error {
  code?: number;
  stdout?: string;
  stderr?: string;
}

function isExecError(e: unknown): e is ExecError {
  return (
    typeof e === 'object' &&
    e !== null &&
    ('stderr' in e || 'code' in e || 'message' in e)
  );
}

// Split the free-form input into a task plus optional --models / --roles / --rounds flags.
function parseCouncilArgs(input: string): CouncilArgs {
  const tokens = input.trim().split(/\s+/).filter(Boolean);
  const task: string[] = [];
  const models: string[] = [];
  const roles: string[] = [];
  let rounds: number | undefined;
  let i = 0;
  while (i < tokens.length) {
    const tok = tokens[i];
    if (tok === '--models' || tok === '--roles') {
      const target = tok === '--models' ? models : roles;
      i += 1;
      while (i < tokens.length && !tokens[i].startsWith('--')) {
        target.push(tokens[i]);
        i += 1;
      }
    } else if (tok === '--rounds') {
      i += 1;
      const n = Number(tokens[i]);
      if (Number.isInteger(n) && n >= 1) {
        rounds = n;
      }
      i += 1;
    } else {
      task.push(tok);
      i += 1;
    }
  }
  return {
    task: task.join(' '),
    models: models.length > 0 ? models : undefined,
    roles: roles.length > 0 ? roles : undefined,
    rounds,
  };
}

// Run council.py once (submitting to the Council API) and return the parsed JSON.
async function runCouncil(argv: string[]): Promise<CouncilResult> {
  const { stdout } = await execFileAsync(COUNCIL_BIN, argv, {
    timeout: COUNCIL_TIMEOUT_MS,
    maxBuffer: 10 * 1024 * 1024,
  });
  const parsed = parseJsonObject(stdout);
  if (!parsed) {
    throw new Error('council.py returned unparseable output');
  }
  return parsed as CouncilResult;
}

// Extract the first JSON object from free-form output (tolerates markdown fences
// and surrounding prose, e.g. council.py's "[council] ..." progress lines).
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseJsonObject(text: string): Record<string, unknown> | undefined {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced ? fenced[1] : text;
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) {
    return undefined;
  }
  try {
    const parsed: unknown = JSON.parse(candidate.slice(start, end + 1));
    return isRecord(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

// Parse the Composer's plan, falling back to the catalog-driven default plan on
// any problem.
function parsePlan(
  raw: Record<string, unknown> | undefined,
  entries: CatalogEntry[],
): CouncilPlan {
  const rawModels = raw?.['models'];
  const rawRoles = raw?.['roles'];
  const rawRounds = raw?.['rounds'];

  const models = Array.isArray(rawModels)
    ? rawModels.filter((m): m is string => typeof m === 'string')
    : [];
  const roles = Array.isArray(rawRoles)
    ? rawRoles.filter((r): r is string => typeof r === 'string')
    : [];
  const rounds =
    typeof rawRounds === 'number' &&
    Number.isInteger(rawRounds) &&
    rawRounds >= 1
      ? rawRounds
      : defaultPlan(entries).rounds;

  if (
    models.length === 0 ||
    roles.length === 0 ||
    models.length !== roles.length
  ) {
    return defaultPlan(entries);
  }
  return { models, roles, rounds };
}

// Ask the Composer to choose the council plan for the user's request. Never
// throws — falls back to the catalog-driven default plan on any failure.
async function composerPlan(
  task: string,
  entries: CatalogEntry[],
): Promise<CouncilPlan> {
  const pool = councilPool(entries);
  const composer = composerModel(entries);
  if (!composer || pool.length === 0) {
    return defaultPlan(entries);
  }

  const prompt = [
    'You are the ' + COMPOSER_ROLE + '.',
    'Given the user request, choose the best multi-model council configuration.',
    'Reply with ONLY a JSON object (no markdown fences, no prose) in exactly this shape:',
    '{"models": ["<model-id>", "<model-id>"], "roles": ["<role>", "<role>"], "rounds": <int>}',
    '',
    'Available models: ' + pool.join(', ') + '.',
    'Use 2-3 models, with one role per model (same count). Choose 1-3 rounds.',
    '',
    'User request: ' + task,
  ].join(NL);

  try {
    const result = await runCouncil([
      prompt,
      '--models',
      composer,
      '--roles',
      COMPOSER_ROLE,
      '--rounds',
      String(COMPOSER_ROUNDS),
      '--json',
    ]);
    const finalOutput = result.stages?.[0]?.final_output ?? '';
    return parsePlan(parseJsonObject(finalOutput), entries);
  } catch {
    return defaultPlan(entries);
  }
}

// Render a Council result into the multi-line text shown to the user.
function formatCouncilResult(result: CouncilResult): string {
  const stages = result.stages ?? [];
  const lines: string[] = [
    `BARE-AI COUNCIL RESULT - job ${result.job_id}`,
    `Agreed: ${result.agreed ? 'yes' : 'no'} | duration ${result.duration_seconds ?? '?'}s | cost ${result.cost_usd ?? '?'} USD`,
  ];
  for (const stage of stages) {
    lines.push('');
    lines.push(
      `${stage.agreed ? 'AGREED' : 'DISAGREED'} - ${stage.stage} (rounds ${stage.rounds})`,
    );
    lines.push(String(stage.final_output ?? '(no output)'));
  }
  return lines.join(NL);
}

// Filter a composed plan down to the models an account is allowed to run.
// Keeps role<->model alignment. Returns null if nothing usable remains.
function filterPlanToAllowed(
  plan: { models: string[]; roles: string[]; rounds: number },
  allowed: string[],
): { models: string[]; roles: string[]; rounds: number } | null {
  const allowedSet = new Set(allowed);
  const models: string[] = [];
  const roles: string[] = [];
  plan.models.forEach((m, i) => {
    if (allowedSet.has(m)) {
      models.push(m);
      roles.push(plan.roles[i] ?? 'contributor');
    }
  });
  if (models.length === 0) {
    for (const m of allowed) {
      models.push(m);
      roles.push('contributor');
    }
  }
  if (models.length === 0) {
    return null;
  }
  return { models, roles, rounds: plan.rounds };
}

export const councilCommand: SlashCommand = {
  name: 'council',
  description:
    'Ask the multi-model Council (the Composer auto-selects models and roles for the task)',
  kind: CommandKind.BUILT_IN,
  autoExecute: false,
  action: async (context, args) => {
    const parsed = parseCouncilArgs(args);
    if (!parsed.task) {
      context.ui.addItem({
        type: MessageType.ERROR,
        text: 'Usage: /council <task> [--models M1 M2] [--roles R1 R2] [--rounds N]',
      });
      return;
    }

    // The Council model pool and the Composer model come from the catalog.
    const entries = await loadCatalog();

    // Advanced mode: the user supplied the council config directly. Otherwise
    // ask the Composer to choose it.
    let models: string[];
    let roles: string[];
    let rounds: number;
    if (parsed.models && parsed.roles) {
      models = parsed.models;
      roles = parsed.roles;
      rounds = parsed.rounds ?? 1;
    } else {
      context.ui.addItem({
        type: MessageType.INFO,
        text: '[council] The Composer is choosing the council...',
      });
      const plan = await composerPlan(parsed.task, entries);
      models = plan.models;
      roles = plan.roles;
      rounds = plan.rounds;
    }

    if (models.length === 0) {
      context.ui.addItem({
        type: MessageType.ERROR,
        text: '[council] No council-enabled models are available in the model catalog.',
      });
      return;
    }

    if (models.length !== roles.length) {
      context.ui.addItem({
        type: MessageType.ERROR,
        text: '[council] --models and --roles must have the same count',
      });
      return;
    }

    context.ui.addItem({
      type: MessageType.INFO,
      text: `[council] Asking the Council (${models.join(', ')})...`,
    });

    try {
      const result = await runCouncil([
        parsed.task,
        '--models',
        ...models,
        '--roles',
        ...roles,
        '--rounds',
        String(rounds),
        '--json',
      ]);

      context.ui.addItem({
        type: MessageType.INFO,
        text: formatCouncilResult(result),
      });
    } catch (err) {
      const e: ExecError = isExecError(err) ? err : new Error(String(err));
      // Credit gate: if the Council rejected premium models for a no-credit
      // account, re-run on the allowed (free-tier) models and tell the user.
      const stderrText = String(e.stderr || '');
      const gate = parseJsonObject(stderrText);
      const requiresTopup = gate?.['requires_topup'];
      const allowedModels = gate?.['allowed_models'];
      if (
        requiresTopup === true &&
        Array.isArray(allowedModels) &&
        allowedModels.length > 0
      ) {
        const filtered = filterPlanToAllowed(
          { models, roles, rounds },
          allowedModels.filter((x): x is string => typeof x === 'string'),
        );
        if (filtered) {
          const skipped = models.filter((m) => !filtered.models.includes(m));
          context.ui.addItem({
            type: MessageType.INFO,
            text: `Premium models unavailable on your plan${skipped.length ? ' (' + skipped.join(', ') + ')' : ''} — running the Council on your free-tier models now. To unlock premium models, add credits or subscribe at ${BILLING_URL}, then re-run your command.`,
          });
          try {
            const retryResult = await runCouncil([
              parsed.task,
              '--models',
              ...filtered.models,
              '--roles',
              ...filtered.roles,
              '--rounds',
              String(filtered.rounds),
              '--json',
            ]);
            context.ui.addItem({
              type: MessageType.INFO,
              text: formatCouncilResult(retryResult),
            });
            return;
          } catch (re) {
            const reErr: ExecError = isExecError(re)
              ? re
              : new Error(String(re));
            const rd = reErr.stderr || reErr.message;
            context.ui.addItem({
              type: MessageType.ERROR,
              text: `Council retry failed: ${rd}${String.fromCharCode(10)}If you're out of credit, add credits or subscribe at ${BILLING_URL}, then re-run.`,
            });
            return;
          }
        }
      }
      const detail = e.stderr || e.message;
      context.ui.addItem({
        type: MessageType.ERROR,
        text: `[council] failed: ${detail}`,
      });
    }
  },
};
