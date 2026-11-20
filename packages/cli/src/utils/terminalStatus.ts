/**
 * @license
 * Copyright 2025 Google LLC
 * Copyright 2026 Bare-AI, a trading name of Consulting Hailing Services LTD
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The agent loop's live status, surfaced as a coloured circle in the terminal
 * tab/window title so a glance at the tab answers "is it working?".
 *
 * Why this is a separate reducer rather than a derivation from StreamingState:
 * StreamingState has only Idle / Responding / WaitingForConfirmation, so it
 * cannot express "the turn failed and the error is still worth showing". The
 * failure state has to be LATCHED - it outlives the turn that produced it and is
 * cleared only when the user submits the next prompt. Encoding that as a small
 * event-driven transition keeps the rule testable on its own, away from React.
 *
 * Note the glyphs are two UTF-16 code units each, so every consumer that pads or
 * truncates a title must do the arithmetic on `.length` (code units) exactly as
 * the existing windowTitle code already does.
 */

export type AgentStatus = 'idle' | 'working' | 'error';

export type AgentStatusEvent =
  /** A prompt was submitted, or the model/tool loop began. */
  | 'prompt-submitted'
  /** The turn finished normally and control returned to the user. */
  | 'turn-completed'
  /** The turn aborted: API error, context-window overflow, unhandled failure. */
  | 'turn-failed';

/** 🟢 idle, 🟠 working, 🔴 error. */
export const AGENT_STATUS_GLYPHS: Record<AgentStatus, string> = {
  idle: '🟢',
  working: '🟠',
  error: '🔴',
};

/**
 * The glyph for a status. Falls back to the idle glyph rather than throwing: a
 * terminal title is decoration, and a bad value must never take down a turn.
 */
export function statusGlyph(status: AgentStatus): string {
  return AGENT_STATUS_GLYPHS[status] ?? AGENT_STATUS_GLYPHS.idle;
}

/**
 * The status state machine.
 *
 * The one rule worth stating out loud: 'turn-completed' does NOT clear an error.
 * The loop finishes after a failure too - the turn that errored still ends - and
 * overwriting 🔴 with 🟢 there is exactly the bug this feature exists to avoid.
 * Only a new prompt ('prompt-submitted') clears the latch.
 */
export function reduceAgentStatus(
  current: AgentStatus,
  event: AgentStatusEvent,
): AgentStatus {
  switch (event) {
    case 'prompt-submitted':
      return 'working';
    case 'turn-failed':
      return 'error';
    case 'turn-completed':
      return current === 'error' ? 'error' : 'idle';
    default:
      return current;
  }
}

/** Minimal shape of a stream we can reason about; keeps this module DOM/Node free. */
export interface TitleStream {
  isTTY?: boolean;
}

/**
 * Whether an OSC window-title sequence may be written to this stream.
 *
 * A non-TTY stdout means the output is being piped or captured (headless
 * `--prompt` runs, `| tee`, CI logs). Emitting `ESC ] 0 ; ... BEL` there would
 * inject raw escape bytes into the captured text, so the title is skipped
 * entirely rather than written and hoped about.
 */
export function isWindowTitleSupported(
  stream: TitleStream | null | undefined,
): boolean {
  return stream?.isTTY === true;
}
