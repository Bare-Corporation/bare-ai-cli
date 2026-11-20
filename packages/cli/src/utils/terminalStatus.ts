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
 * Why the status is a separate reducer rather than a derivation from StreamingState:
 * StreamingState has only Idle / Responding / WaitingForConfirmation, so it
 * cannot express "the turn failed and the error is still worth showing". The
 * failure state has to be LATCHED - it outlives the turn that produced it and is
 * cleared only when the user submits the next prompt. Encoding that as a small
 * event-driven transition keeps the rule testable on its own, away from React.
 *
 * This module also owns the ONE writer for the title sequence, so the tmux
 * passthrough rule lives in a single place instead of being re-derived at each
 * call site.
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

/** A stream we are allowed to write a title sequence to. */
export interface TitleWritable extends TitleStream {
  write(chunk: string): unknown;
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

// Built from character codes on purpose: a control character written as a
// two-character escape inside this file is fragile (an editor, a formatter or a
// paste can turn it into the real byte), and then the sequence silently changes
// meaning. fromCharCode cannot rot.
const ESC = String.fromCharCode(27);
const BEL = String.fromCharCode(7);
const BACKSLASH = String.fromCharCode(92);

/**
 * Whether this process is running inside tmux, which decides whether the title
 * needs a DCS passthrough wrapper. Same test the repo uses elsewhere:
 * TerminalCapabilityManager.isTmux() is exactly `Boolean(process.env['TMUX'])`.
 */
export function isInsideTmux(): boolean {
  return Boolean(process.env['TMUX']);
}

/**
 * Strip everything that could terminate or corrupt the OSC sequence early.
 *
 * A title reaching this function can come from the environment (CLI_TITLE) or
 * from a model-written thought subject, so a stray BEL or ESC in it would let
 * the rest of the string escape the sequence.
 */
function sanitizeTitle(title: string): string {
  let out = '';
  for (const char of title) {
    const code = char.codePointAt(0) ?? 0;
    if (code >= 32 && code !== 127) {
      out += char;
    }
  }
  return out;
}

/**
 * The bytes to write for one title.
 *
 * Outside tmux this is a plain OSC 0 sequence, byte-identical to what the CLI
 * has always written.
 *
 * Inside tmux a bare OSC 0 is captured as the PANE title and never reaches the
 * outer terminal tab - tmux only forwards an escape sequence to the terminal it
 * is attached to if it arrives inside a DCS passthrough, and it requires tmux's
 * `allow-passthrough on` for that. So the sequence is emitted twice:
 *
 *   1. plain OSC 0, which sets tmux's own pane title (and therefore the outer
 *      title when the user has `set-titles on` with a `#T`-style string), and
 *   2. the same OSC 0 wrapped in a DCS passthrough (ESC, then Ptmux;, the OSC with
 *      every inner ESC doubled, then ESC and a backslash to close), which tmux
 *      forwards verbatim to the outer terminal.
 *
 * Emitting both is what makes the circle appear regardless of which of the two
 * tmux settings a node has. Both are one `write` call, so a consumer counting
 * writes still sees one update per title change.
 */
export function buildTitleSequences(title: string, inTmux: boolean): string {
  const osc = `${ESC}]0;${sanitizeTitle(title)}${BEL}`;
  if (!inTmux) {
    return osc;
  }
  const doubled = osc.split(ESC).join(ESC + ESC);
  return osc + `${ESC}Ptmux;${doubled}${ESC}${BACKSLASH}`;
}

/**
 * Write the terminal title, honouring the TTY guard and the tmux wrapper.
 *
 * The single entry point for OSC 0 in this package. Callers pass the stream they
 * normally write to; nothing is written when that stream is not a TTY.
 */
export function writeTerminalTitle(
  stream: TitleWritable | null | undefined,
  title: string,
): void {
  if (!isWindowTitleSupported(stream) || !stream) {
    return;
  }
  stream.write(buildTitleSequences(title, isInsideTmux()));
}
