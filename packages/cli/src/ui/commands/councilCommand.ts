/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { SlashCommand } from './types.js';
import { CommandKind } from './types.js';
import { MessageType } from '../types.js';

const execFileAsync = promisify(execFile);

const COUNCIL_BIN = process.env['BARE_COUNCIL_BIN'] || 'council.py';
const COUNCIL_TIMEOUT_MS = 15 * 60 * 1000;
const NL = String.fromCharCode(10);

type TaskKind = 'code' | 'review' | 'reasoning' | 'writing' | 'general';

interface CouncilPreset {
  models: string[];
  roles: string[];
}

// Curated multi-model "council roster" by task kind. The Council orchestrates
// cloud models via the user's Vault keys, so these are the well-rounded default
// pairs. A user can always override with explicit --models/--roles.
const COUNCIL_PRESETS: Record<TaskKind, CouncilPreset> = {
  code: {
    models: ['claude-sonnet-4-6', 'deepseek-v4-pro'],
    roles: ['Senior Software Engineer', 'Security-focused Code Reviewer'],
  },
  review: {
    models: ['claude-sonnet-4-6', 'gemini-2.5-pro'],
    roles: ['Principal Reviewer', 'Critical Sceptic'],
  },
  reasoning: {
    models: ['deepseek-reasoner', 'claude-sonnet-4-6'],
    roles: ['Analytical Reasoner', 'Evidence-checking Reviewer'],
  },
  writing: {
    models: ['claude-sonnet-4-6', 'gemini-2.5-pro'],
    roles: ['Lead Writer', 'Critical Editor'],
  },
  general: {
    models: ['claude-sonnet-4-6', 'deepseek-v4-pro'],
    roles: ['Senior Engineer', 'Critical Reviewer'],
  },
};

// Local "director" model that interprets the request before a council roster is
// picked. Granite is tiny and keyless (local Ollama), so this is cheap and
// offline-capable. Falls back to the keyword heuristic if the director is down
// or returns an unrecognised label.
const DIRECTOR_BASE_URL =
  process.env['BARE_COUNCIL_DIRECTOR_URL'] || 'http://127.0.0.1:11434';
const DIRECTOR_MODEL =
  process.env['BARE_COUNCIL_DIRECTOR_MODEL'] || 'granite4:tiny-h';
const DIRECTOR_TIMEOUT_MS = 30 * 1000;
const DIRECTOR_KINDS: TaskKind[] = [
  'code',
  'review',
  'reasoning',
  'writing',
  'general',
];

// The director is opt-in. Live testing (granite4:tiny-h vs the keyword heuristic,
// 10/12 vs 12/12) showed the tiny director misclassifies "reasoning" tasks, so the
// keyword heuristic remains the default. Set BARE_COUNCIL_DIRECTOR_ENABLED=1 to
// use the director as the primary classifier.
const directorEnabled = process.env['BARE_COUNCIL_DIRECTOR_ENABLED'] === '1';

interface CouncilArgs {
  task: string;
  models?: string[];
  roles?: string[];
}

interface ExecError extends Error {
  code?: number;
  stdout?: string;
  stderr?: string;
}

interface OllamaGenerateResponse {
  response?: string;
}

// Split the free-form input into a task plus optional --models / --roles flags.
function parseCouncilArgs(input: string): CouncilArgs {
  const tokens = input.trim().split(/\s+/).filter(Boolean);
  const task: string[] = [];
  const models: string[] = [];
  const roles: string[] = [];
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
    } else {
      task.push(tok);
      i += 1;
    }
  }
  return {
    task: task.join(' '),
    models: models.length > 0 ? models : undefined,
    roles: roles.length > 0 ? roles : undefined,
  };
}

// Keyword heuristic fallback: map a free-form task to a task kind.
function classifyTask(task: string): TaskKind {
  const t = task.toLowerCase();
  const has = (words: string[]) => words.some((w) => t.includes(w));
  if (has(['review', 'audit', 'critique', 'refactor', 'debug', 'bug', 'security'])) {
    return 'review';
  }
  if (has(['code', 'implement', 'function', 'api', 'program', 'script', 'fix', 'build'])) {
    return 'code';
  }
  if (has(['analy', 'reason', 'evaluate', 'research', 'compare', 'why', 'explain', 'prove'])) {
    return 'reasoning';
  }
  if (has(['write', 'document', 'summarize', 'article', 'report', 'email', 'blog'])) {
    return 'writing';
  }
  return 'general';
}

// Ask the local director model to classify the request. Returns undefined on
// any failure so the caller can fall back to the keyword heuristic.
async function directorClassify(task: string): Promise<TaskKind | undefined> {
  const prompt = [
    'Classify the request into exactly one category: code, review, reasoning, writing, or general.',
    'Reply with only that single word.',
    '',
    'Request: ' + task,
  ].join(NL);

  try {
    const res = await fetch(`${DIRECTOR_BASE_URL}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: DIRECTOR_MODEL,
        prompt,
        stream: false,
      }),
      signal: AbortSignal.timeout(DIRECTOR_TIMEOUT_MS),
    });
    if (!res.ok) {
      return undefined;
    }
    const data = (await res.json()) as OllamaGenerateResponse;
    const raw = String(data.response ?? '').trim().toLowerCase();
    const word = raw.split(/\s+/)[0];
    for (const kind of DIRECTOR_KINDS) {
      if (kind === word) {
        return kind;
      }
    }
    return undefined;
  } catch {
    return undefined;
  }
}

export const councilCommand: SlashCommand = {
  name: 'council',
  description: 'Ask the multi-model Council (auto-selects models for the task)',
  kind: CommandKind.BUILT_IN,
  autoExecute: false,
  action: async (context, args) => {
    const parsed = parseCouncilArgs(args);
    if (!parsed.task) {
      context.ui.addItem({
        type: MessageType.ERROR,
        text: 'Usage: /council <task> [--models M1 M2] [--roles R1 R2]',
      });
      return;
    }

    const kind = directorEnabled
      ? ((await directorClassify(parsed.task)) ?? classifyTask(parsed.task))
      : classifyTask(parsed.task);
    const preset = COUNCIL_PRESETS[kind];
    const models = parsed.models ?? preset.models;
    const roles = parsed.roles ?? preset.roles;
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

    const argv = [
      parsed.task,
      '--models',
      ...models,
      '--roles',
      ...roles,
      '--json',
    ];

    try {
      const { stdout } = await execFileAsync(COUNCIL_BIN, argv, {
        timeout: COUNCIL_TIMEOUT_MS,
        maxBuffer: 10 * 1024 * 1024,
      });
      const result = JSON.parse(stdout);
      const stages = Array.isArray(result.stages) ? result.stages : [];
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
      context.ui.addItem({ type: MessageType.INFO, text: lines.join(NL) });
    } catch (err) {
      const e = err as ExecError;
      const detail = e.stderr || e.message;
      context.ui.addItem({ type: MessageType.ERROR, text: `[council] failed: ${detail}` });
    }
  },
};
