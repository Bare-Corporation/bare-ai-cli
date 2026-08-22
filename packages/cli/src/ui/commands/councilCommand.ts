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
const DEFAULT_MODELS = ['claude-sonnet-4-6', 'deepseek-v4-pro'];
const DEFAULT_ROLES = ['Senior Engineer', 'Critical Reviewer'];
const COUNCIL_TIMEOUT_MS = 15 * 60 * 1000;
const NL = String.fromCharCode(10);

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

export const councilCommand: SlashCommand = {
  name: 'council',
  description: 'Ask the multi-model Council to deliberate on a task',
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

    const models = parsed.models ?? DEFAULT_MODELS;
    const roles = parsed.roles ?? DEFAULT_ROLES;
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
