/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { tokenLimit, debugLogger } from '@bare-ai/core';

/**
 * Where an AUTHORITATIVE context window came from.
 *
 * `env` is the operator override (BARE_AI_CONTEXT_WINDOW). A per-model catalog
 * value is meant to take precedence over it, but no catalog available to this
 * process carries a context-window field - not `packages/core/src/config/models.ts`,
 * not `~/.gemini/models.cache.json`, not `~/.gemini/model.local.json`. That tier
 * is therefore deliberately NOT implemented rather than guessed at.
 */
export type ContextWindowSource = 'env' | 'none';

/**
 * A context-window assessment, kept honest about what is known and what is
 * merely assumed.
 *
 * WHY THIS SHAPE: the footer used to render promptTokenCount / tokenLimit(model)
 * as a percentage with no cap and with no notion of whether the denominator was
 * real. That produced "462% used" for a model whose true window is several times
 * the hardcoded table entry. Two separate facts are needed and they are NOT the
 * same number's business: whether an authoritative window is known at all (for
 * display), and what the resolved limit is (for behaviour and self-reporting).
 */
export interface ContextUsage {
  promptTokenCount: number;
  /**
   * The authoritative window the ratio is computed against. 0 when none is
   * known - in which case no percentage may be rendered at all.
   */
  windowLimit: number;
  /** True only when an authoritative window is known. */
  windowKnown: boolean;
  /** Which authoritative source supplied windowLimit. */
  windowSource: ContextWindowSource;
  /** promptTokenCount / windowLimit. Always 0 when windowKnown is false. */
  ratio: number;
  /** True when the observed prompt exceeds an AUTHORITATIVE window. */
  exceedsKnownWindow: boolean;
  /**
   * The limit resolved by tokenLimit(): operator override, else the in-repo
   * name-prefix table, else the 1M default. NEVER authoritative on its own -
   * the table is a guess - so it must not be rendered as a denominator.
   * It is kept here because it still drives behaviour (see isContextUsageHigh)
   * and because comparing against it is what produces the evidence that a
   * table entry is wrong.
   */
  resolvedLimit: number;
  /** True when the observed prompt exceeds resolvedLimit. Drives the warning. */
  exceedsResolvedLimit: boolean;
}

/**
 * Read the operator override using exactly the rule tokenLimit() applies
 * (finite and > 0), so the two can never disagree about whether a value was
 * operator-supplied. Duplicated deliberately: tokenLimit() is not to be touched
 * by this change, and it does not report WHERE its value came from.
 */
function readContextWindowOverride(): number {
  const raw = Number(process.env['BARE_AI_CONTEXT_WINDOW']);
  if (!Number.isFinite(raw) || raw <= 0) {
    return 0;
  }
  return raw;
}

export function getContextUsage(
  promptTokenCount: number,
  model: string | undefined,
): ContextUsage {
  const override = readContextWindowOverride();
  const hasOverride = override > 0;

  // Mirrors tokenLimit()'s precedence without passing it a possibly-undefined
  // model: the override wins regardless of model id, otherwise the value comes
  // from the name-prefix table for a usable model id, otherwise there is none.
  const resolvedLimit = hasOverride
    ? override
    : model && typeof model === 'string' && model.length > 0
      ? tokenLimit(model)
      : 0;

  // ONLY an explicit operator override confers authority. The name-prefix
  // table resolving to a number does NOT: that is exactly the guess that
  // produced "462% used".
  const windowKnown = hasOverride;
  const windowLimit = windowKnown ? resolvedLimit : 0;

  return {
    promptTokenCount,
    windowLimit,
    windowKnown,
    windowSource: windowKnown ? 'env' : 'none',
    ratio: windowKnown && windowLimit > 0 ? promptTokenCount / windowLimit : 0,
    exceedsKnownWindow:
      windowKnown && windowLimit > 0 && promptTokenCount > windowLimit,
    resolvedLimit,
    exceedsResolvedLimit: resolvedLimit > 0 && promptTokenCount > resolvedLimit,
  };
}

/**
 * The authoritative ratio, or 0 when no window is authoritatively known.
 *
 * NOTE: this is the DISPLAY ratio. It is intentionally not what
 * isContextUsageHigh() uses - see that function for why the behavioural
 * threshold keeps the resolved-limit path.
 */
export function getContextUsagePercentage(
  promptTokenCount: number,
  model: string | undefined,
): number {
  return getContextUsage(promptTokenCount, model).ratio;
}

/**
 * Behavioural threshold, used by the composer status UI and by compression
 * callers. Deliberately unchanged from its pre-D2 behaviour: it resolves the
 * limit through tokenLimit() (override, then table), so nothing moves unless an
 * operator sets an override on purpose. Decoupled from
 * getContextUsagePercentage() precisely so that the display's new
 * "window unknown" state can never silently disable this.
 */
export function isContextUsageHigh(
  promptTokenCount: number,
  model: string | undefined,
  threshold = 0.6,
): boolean {
  if (!model || typeof model !== 'string' || model.length === 0) {
    return false;
  }
  const limit = tokenLimit(model);
  if (limit <= 0) {
    return false;
  }
  return promptTokenCount / limit > threshold;
}

/**
 * Models already warned about during this process. The gauge is asserted on
 * every render, so without this guard a single stale constant would flood the
 * debug log.
 */
const warnedModels = new Set<string>();

/**
 * Emit exactly ONE warning per model per session when the observed prompt
 * exceeds the RESOLVED limit - even though that limit is not authoritative and
 * is no longer rendered. This is the data-collection path: the observed ceiling
 * a real session reaches is what will eventually justify a catalog value, so
 * the warning must not be gated on an override being present.
 */
export function warnIfContextWindowExceeded(
  promptTokenCount: number,
  model: string | undefined,
  resolvedLimit: number,
): void {
  if (!model || typeof model !== 'string' || model.length === 0) {
    return;
  }
  if (!(promptTokenCount > resolvedLimit)) {
    return;
  }
  if (warnedModels.has(model)) {
    return;
  }
  warnedModels.add(model);
  debugLogger.warn(
    `Context window exceeded for model "${model}": observed ${promptTokenCount} prompt tokens against a resolved limit of ${resolvedLimit}, which is a name-prefix estimate rather than a verified window (set BARE_AI_CONTEXT_WINDOW to declare it). The real ceiling is at least ${promptTokenCount}.`,
  );
}

/**
 * Test-only: clear the once-per-model warning guard so emission can be
 * re-observed within a single process.
 */
export function resetContextWindowWarningState(): void {
  warnedModels.clear();
}
