/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * toolPolicy.ts — single source of truth for whether a model may use tools.
 *
 * Two layers of intent exist, and they are NOT equal:
 *
 *   1. CALLER intent — stated per execution by whoever launched this process
 *      (the Council API, a bare-machine pod, a cron job, a human). Expressed as
 *      the --disable-tools / --tools flags, or as BARE_AI_NO_TOOLS in the
 *      environment.
 *   2. CATALOGUE default — the per-model tool_capability column ('thinker'
 *      means reasoning-only, 'doer' means the model may call tools).
 *
 * Precedence, highest first:
 *   --disable-tools / --tools  >  BARE_AI_NO_TOOLS  >  catalogue capability
 *
 * Whichever of the top two applies is recorded in BARE_AI_TOOLS_OVERRIDE, which
 * makes it a HARD override: a model hot-swap updates BARE_AI_NO_TOOLS to match
 * the override but may never flip it, because a hot-swap is a routing decision,
 * not a fresh statement of caller intent.
 *
 * Why this exists (Ticket 164): the /model swap used to write
 * BARE_AI_NO_TOOLS from the catalogue alone, so a doer row re-enabled tools
 * mid-session no matter what the caller had asked for. Under
 * --approval-mode plan (which auto-approves read-only tools) that let a model
 * run list_directory and leak container paths to Council API customers.
 *
 * The override is deliberately per-execution, never a global default: the
 * bare-machine product needs some pods allowed tools and others denied.
 */

/** Consumed by the model client (isNoToolModel in @bare-ai/core). */
export const NO_TOOLS_ENV = 'BARE_AI_NO_TOOLS';

/** Records caller intent, locking the policy for the whole execution. */
export const TOOL_OVERRIDE_ENV = 'BARE_AI_TOOLS_OVERRIDE';

export type ToolMode = 'tools' | 'no-tools';

function toToolMode(raw: string | undefined): ToolMode | undefined {
  const value = (raw ?? '').trim().toLowerCase();
  if (value === 'no-tools' || value === 'true') return 'no-tools';
  if (value === 'tools' || value === 'false') return 'tools';
  return undefined;
}

/** The recorded caller override, or undefined when the catalogue decides. */
export function getToolOverride(): ToolMode | undefined {
  return toToolMode(process.env[TOOL_OVERRIDE_ENV]);
}

/** True when the caller pinned the tool policy for this execution. */
export function isToolModeLocked(): boolean {
  return getToolOverride() !== undefined;
}

/** Record a caller override and make BARE_AI_NO_TOOLS reflect it. */
export function lockToolMode(mode: ToolMode): void {
  process.env[TOOL_OVERRIDE_ENV] = mode;
  process.env[NO_TOOLS_ENV] = mode === 'no-tools' ? 'true' : 'false';
}

/**
 * Promote an explicit BARE_AI_NO_TOOLS value supplied by the caller at startup
 * into a lock. Only meaningful BEFORE the first hot-swap, since a swap writes
 * that same variable; called from parseArguments, which always runs first.
 */
export function promoteCallerEnvToOverride(): ToolMode | undefined {
  const locked = getToolOverride();
  if (locked) return locked;
  const fromEnv = toToolMode(process.env[NO_TOOLS_ENV]);
  if (fromEnv) lockToolMode(fromEnv);
  return fromEnv;
}

// yargs populates both the kebab-case and the camelCase spelling of a flag, so
// read both and the override cannot be missed. argv is the raw yargs parse
// result, hence narrowing from unknown rather than casting to a named shape.
function readFlag(argv: unknown, key: string): boolean {
  if (typeof argv !== 'object' || argv === null) return false;
  // The guard above proves this is an object; TypeScript has no way to index an
  // `unknown` object, so the narrowing assertion is the only spelling available.
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
  return (argv as Record<string, unknown>)[key] === true;
}

/**
 * Apply the per-execution tool flags, then fall back to a caller-supplied
 * BARE_AI_NO_TOOLS. Leaves the catalogue in charge when neither is present.
 */
export function applyToolFlags(argv: unknown): ToolMode | undefined {
  if (readFlag(argv, 'disable-tools') || readFlag(argv, 'disableTools')) {
    lockToolMode('no-tools');
    return 'no-tools';
  }
  if (readFlag(argv, 'tools')) {
    lockToolMode('tools');
    return 'tools';
  }
  return promoteCallerEnvToOverride();
}

/**
 * Resolve the effective tool policy for a model and write it to
 * BARE_AI_NO_TOOLS. Returns true when tools must be withheld from the model.
 * A caller override wins outright; only an unlocked execution consults the
 * catalogue's tool_capability.
 */
export function applyToolModeFromCapability(
  capability: string | undefined,
): boolean {
  const locked = getToolOverride();
  if (locked) {
    process.env[NO_TOOLS_ENV] = locked === 'no-tools' ? 'true' : 'false';
    return locked === 'no-tools';
  }
  const noTools = capability === 'thinker';
  process.env[NO_TOOLS_ENV] = noTools ? 'true' : 'false';
  return noTools;
}
