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
  fallback?: TitleWritable | null,
): void {
  const target = resolveTerminalStream(stream, fallback);
  if (!target) {
    return;
  }
  target.write(buildTitleSequences(title, isInsideTmux()));
}

/**
 * Audible status cues.
 *
 * The circles in the title answer "is it working?" to anyone looking at the
 * terminal. The same question asked from another room is answered by ear, and
 * the reason a failed turn needs its OWN cue is that a completion chime and a
 * failure chime which sound alike are worse than no cue at all - the operator
 * walks back expecting output that does not exist.
 *
 * A terminal gives us exactly one portable audio primitive: BEL (byte 7).
 * There is no tone, pitch or volume to vary, so the cues are distinguished by
 * CADENCE:
 *
 *   working (orange)      one short pulse           "I have your prompt"
 *   idle    (green)       two pulses, 120 ms apart  "finished, output is ready"
 *   error   (red)         three pulses              "finished, and it failed"
 *
 * Counting beats is unambiguous and needs no capability negotiation, which is
 * what makes it work over SSH, in tmux, and in any terminal emulator.
 */
export type StatusAudioPing = 'all' | 'completion' | 'off';

/** Selectable values for the ui.statusAudioPing setting, in menu order. */
export const STATUS_AUDIO_PING_VALUES: readonly StatusAudioPing[] = [
  'all',
  'completion',
  'off',
];

/**
 * Rings when a turn ends (either way) but stays quiet when one starts.
 *
 * The default is deliberately not 'all': a pulse on every submitted prompt is
 * the cue most operators find intrusive, and the two that carry information are
 * the one saying the work finished and the one saying it failed.
 */
export const DEFAULT_STATUS_AUDIO_PING: StatusAudioPing = 'completion';

/**
 * Coerce an arbitrary setting value into a known mode.
 *
 * Settings files are hand-edited and hand-migrated, so this takes `unknown` and
 * falls back rather than throwing: an unrecognised value must not stop a turn,
 * and the fallback is the quiet-but-useful mode rather than silence.
 *
 * Written as a switch instead of a lookup plus a cast so that the narrowing is
 * done by the compiler - there is no assertion to get wrong.
 */
export function parseStatusAudioPing(value: unknown): StatusAudioPing {
  switch (value) {
    case 'all':
    case 'completion':
    case 'off':
      return value;
    default:
      return DEFAULT_STATUS_AUDIO_PING;
  }
}

/**
 * Whether the given status should make a sound under the given mode.
 *
 * 'completion' means "the end of a turn", not "the green circle": an error is
 * the ending that matters most, so it rings in both modes that are not 'off'.
 * Only the start-of-work pulse is treated as the optional one.
 */
export function isStatusAudioEnabled(
  mode: StatusAudioPing,
  status: AgentStatus,
): boolean {
  if (mode === 'off') {
    return false;
  }
  if (mode === 'completion') {
    return status !== 'working';
  }
  return true;
}

/** One beat of a cue: the bytes to write, then how long to wait before the next. */
export interface StatusAudioStep {
  bytes: string;
  gapMs: number;
}

/**
 * The beats for a status, as data rather than a timer loop.
 *
 * Returning the schedule keeps the cue table assertable without waiting on real
 * time, and lets the player decide how to wait. The last beat always has a zero
 * gap so a caller that ignores gapMs still produces a usable (if compressed)
 * cue instead of a silent one.
 */
export function buildStatusAudioCue(status: AgentStatus): StatusAudioStep[] {
  switch (status) {
    case 'idle':
      return [
        { bytes: BEL, gapMs: 120 },
        { bytes: BEL, gapMs: 0 },
      ];
    case 'working':
      return [{ bytes: BEL, gapMs: 0 }];
    case 'error':
      return [
        { bytes: BEL, gapMs: 120 },
        { bytes: BEL, gapMs: 120 },
        { bytes: BEL, gapMs: 0 },
      ];
    default:
      return [];
  }
}

export interface StatusAudioOptions {
  mode?: StatusAudioPing;
  /**
   * Stream to try when the caller stream is not a TTY. Defaults to the process
   * stderr; see resolveTerminalStream.
   */
  fallback?: TitleWritable | null;
  /**
   * Timer seam. Injected so tests can observe the gaps without sleeping, and so
   * a host without a timer can supply its own.
   */
  schedule?: (fn: () => void, ms: number) => void;
}

function defaultSchedule(fn: () => void, ms: number): void {
  setTimeout(fn, ms);
}

/**
 * Write the audible cue for a status transition.
 *
 * Gated exactly like the title, and for the same reason: a piped or captured
 * stdout (a headless prompt run, a tee, a CI log) must not receive control
 * bytes, and BEL is a control byte. Non-TTY means silence.
 *
 * tmux deliberately makes NO difference here. BEL is not an escape sequence
 * with a payload - it is a single byte tmux itself consumes and acts on
 * (`bell-action`, which the installer sets to `any`). Wrapping it in a DCS
 * passthrough would send the byte to the outer terminal AND let tmux act on
 * it, ringing twice and bypassing the user's own bell settings. So the bytes
 * below are identical with and without TMUX set, and the test asserts that
 * rather than a wrapper.
 */
export function playStatusAudioPing(
  stream: TitleWritable | null | undefined,
  status: AgentStatus,
  options: StatusAudioOptions = {},
): void {
  const target = resolveTerminalStream(stream, options.fallback);
  if (!target) {
    return;
  }
  const mode = options.mode ?? DEFAULT_STATUS_AUDIO_PING;
  if (!isStatusAudioEnabled(mode, status)) {
    return;
  }
  const schedule = options.schedule ?? defaultSchedule;
  const steps = buildStatusAudioCue(status);
  if (steps.length === 0) {
    return;
  }

  let index = 0;
  // At most three beats, so plain recursion is cheaper than a queue and cannot
  // run away. Each beat is written before the gap that follows it, so a cue
  // cannot be scheduled and then lost if the process exits in between.
  const writeNext = (): void => {
    const step = steps[index];
    if (!step) {
      return;
    }
    index += 1;
    target.write(step.bytes);
    if (step.gapMs > 0) {
      schedule(writeNext, step.gapMs);
    } else {
      writeNext();
    }
  };
  writeNext();
}

/**
 * Pick the stream terminal-control bytes should go to.
 *
 * The caller's stream wins whenever it is a TTY. When it is NOT, the process's
 * stderr is tried instead: a launcher that wires the CLI stdout to a pipe while
 * the session stays attached to a real terminal leaves the title and the bell
 * with nowhere to land, and the terminal is still reachable on fd 2.
 *
 * The non-interactive guarantee is unchanged, and it is the property that
 * matters: a headless run has no TTY on EITHER stream, so this returns undefined
 * and not a single byte is written. Writing OSC 0 or BEL into a captured
 * --prompt run is the failure this guard exists to prevent.
 *
 * Both candidates are examined at CALL time rather than captured at module load,
 * so a stream that gains or loses isTTY during startup is judged on what it is
 * now.
 */
export function resolveTerminalStream(
  primary?: TitleWritable | null,
  fallback?: TitleWritable | null,
): TitleWritable | undefined {
  if (primary && isWindowTitleSupported(primary)) {
    return primary;
  }
  const secondary = fallback ?? processStderr();
  if (secondary && isWindowTitleSupported(secondary)) {
    return secondary;
  }
  return undefined;
}

/**
 * The process's stderr, read lazily.
 *
 * Deliberately a function rather than a module constant: the bundle ships more
 * than one copy of some modules, and a stream captured at load time can belong
 * to a different instance of the runtime than the one now writing.
 */
function processStderr(): TitleWritable | undefined {
  const stderr = process.stderr;
  if (!stderr) {
    return undefined;
  }
  // An adapter, not a cast: the node stream is wider than the shape this module
  // needs, and narrowing it with an assertion is exactly the unsafe pattern the
  // linter rejects. Wrapping says what is used instead of asserting what it is.
  return {
    isTTY: stderr.isTTY,
    write: (chunk: string) => stderr.write(chunk),
  };
}
