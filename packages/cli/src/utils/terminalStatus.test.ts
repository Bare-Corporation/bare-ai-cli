/**
 * @license
 * Copyright 2025 Google LLC
 * Copyright 2026 Bare-AI, a trading name of Consulting Hailing Services LTD
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  AGENT_STATUS_GLYPHS,
  buildTitleSequences,
  isInsideTmux,
  isWindowTitleSupported,
  reduceAgentStatus,
  statusGlyph,
  writeTerminalTitle,
  type AgentStatus,
} from './terminalStatus.js';

// Control characters are built from codes rather than written as escapes: a
// two-character escape in source is easy to turn into the real byte by accident,
// and then these assertions would be comparing something else entirely.
const ESC = String.fromCharCode(27);
const BEL = String.fromCharCode(7);
const BACKSLASH = String.fromCharCode(92);

function plainTitle(title: string): string {
  return ESC + ']0;' + title + BEL;
}

function fakeStream(isTTY: boolean) {
  const writes: string[] = [];
  return {
    isTTY,
    writes,
    write(chunk: string) {
      writes.push(chunk);
      return true;
    },
  };
}

describe('reduceAgentStatus', () => {
  it('starts working when a prompt is submitted', () => {
    expect(reduceAgentStatus('idle', 'prompt-submitted')).toBe('working');
    expect(reduceAgentStatus('error', 'prompt-submitted')).toBe('working');
  });

  it('returns to idle when a turn completes normally', () => {
    expect(reduceAgentStatus('working', 'turn-completed')).toBe('idle');
    expect(reduceAgentStatus('idle', 'turn-completed')).toBe('idle');
  });

  it('enters error when a turn fails', () => {
    expect(reduceAgentStatus('working', 'turn-failed')).toBe('error');
    expect(reduceAgentStatus('idle', 'turn-failed')).toBe('error');
    expect(reduceAgentStatus('error', 'turn-failed')).toBe('error');
  });

  it('KEEPS the error after the failed turn ends', () => {
    // The regression this feature exists to prevent: a failed turn still ends, and
    // the cleanup path calls 'turn-completed'. Clearing 🔴 there would erase the
    // only sign the run failed.
    expect(reduceAgentStatus('error', 'turn-completed')).toBe('error');
  });

  it('clears the error latch only when the next prompt starts', () => {
    const afterFailure = reduceAgentStatus('working', 'turn-failed');
    const stillFailed = reduceAgentStatus(afterFailure, 'turn-completed');
    const retried = reduceAgentStatus(stillFailed, 'prompt-submitted');
    expect(stillFailed).toBe('error');
    expect(retried).toBe('working');
  });

  it('walks the full idle -> working -> finished cycle', () => {
    let status: AgentStatus = 'idle';
    status = reduceAgentStatus(status, 'prompt-submitted');
    expect(status).toBe('working');
    status = reduceAgentStatus(status, 'turn-completed');
    expect(status).toBe('idle');
  });

  it('walks the working -> error -> preserved -> working cycle', () => {
    let status: AgentStatus = 'idle';
    status = reduceAgentStatus(status, 'prompt-submitted');
    status = reduceAgentStatus(status, 'turn-failed');
    expect(status).toBe('error');
    status = reduceAgentStatus(status, 'turn-completed');
    expect(status).toBe('error');
    status = reduceAgentStatus(status, 'prompt-submitted');
    expect(status).toBe('working');
  });

  it('ignores an unknown event instead of resetting the status', () => {
    const unknown = 'something-else' as unknown as Parameters<
      typeof reduceAgentStatus
    >[1];
    expect(reduceAgentStatus('error', unknown)).toBe('error');
  });
});

describe('statusGlyph', () => {
  it('maps each status to its circle', () => {
    expect(statusGlyph('idle')).toBe('🟢');
    expect(statusGlyph('working')).toBe('🟠');
    expect(statusGlyph('error')).toBe('🔴');
    expect(AGENT_STATUS_GLYPHS.idle).toBe('🟢');
  });

  it('falls back to the idle circle for an unknown status', () => {
    expect(statusGlyph('nonsense' as AgentStatus)).toBe('🟢');
  });
});

describe('isWindowTitleSupported', () => {
  it('accepts a TTY stream', () => {
    expect(isWindowTitleSupported({ isTTY: true })).toBe(true);
  });

  it('refuses a stream that is not a TTY', () => {
    // Piped or captured stdout: writing ESC ] 0 ; ... BEL would inject escape
    // bytes into the captured text.
    expect(isWindowTitleSupported({ isTTY: false })).toBe(false);
  });

  it('refuses a stream with no isTTY flag or no stream at all', () => {
    expect(isWindowTitleSupported({})).toBe(false);
    expect(isWindowTitleSupported(null)).toBe(false);
    expect(isWindowTitleSupported(undefined)).toBe(false);
  });
});


describe('buildTitleSequences', () => {
  it('emits plain OSC 0 outside tmux', () => {
    expect(buildTitleSequences('🟢  Ready (proj)', false)).toBe(
      plainTitle('🟢  Ready (proj)'),
    );
  });

  it('emits the plain sequence AND a DCS passthrough inside tmux', () => {
    const title = '🟠  Working…';
    const osc = plainTitle(title);
    const doubled = osc.split(ESC).join(ESC + ESC);
    expect(buildTitleSequences(title, true)).toBe(
      osc + ESC + 'Ptmux;' + doubled + ESC + BACKSLASH,
    );
  });

  it('doubles every ESC inside the passthrough payload', () => {
    // tmux ends the passthrough at the first unescaped ESC-backslash, so a single
    // ESC left inside the payload would truncate the forwarded title.
    const title = 'x';
    const osc = plainTitle(title);
    const out = buildTitleSequences(title, true);
    const prefix = osc + ESC + 'Ptmux;';
    const suffix = ESC + BACKSLASH;
    expect(out.startsWith(prefix)).toBe(true);
    expect(out.endsWith(suffix)).toBe(true);
    const payload = out.slice(prefix.length, out.length - suffix.length);
    expect(payload).toBe(osc.split(ESC).join(ESC + ESC));
    expect(payload.startsWith(ESC + ESC + ']0;')).toBe(true);
  });

  it('uses the same DCS form the notification helper uses for tmux', () => {
    // terminalNotifications.wrapWithPassthrough produces ESC P tmux ; ... ESC backslash
    // with the payload's ESCs doubled; the title writer must agree with it.
    const out = buildTitleSequences('t', true);
    expect(out).toContain(ESC + 'Ptmux;');
    expect(out.endsWith(ESC + BACKSLASH)).toBe(true);
  });

  it('strips control characters so a title cannot break out of the sequence', () => {
    const hostile = 'a' + BEL + 'b' + ESC + 'c' + String.fromCharCode(127) + 'd';
    expect(buildTitleSequences(hostile, false)).toBe(plainTitle('abcd'));
  });

  it('keeps the same sanitised title inside the tmux payload', () => {
    expect(buildTitleSequences('a' + BEL + 'b', true)).toContain(']0;ab');
  });
});

describe('isInsideTmux', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('is false when TMUX is unset or empty', () => {
    vi.stubEnv('TMUX', '');
    expect(isInsideTmux()).toBe(false);
  });

  it('is true when TMUX is set', () => {
    vi.stubEnv('TMUX', '/tmp/tmux-1000/default,4242,0');
    expect(isInsideTmux()).toBe(true);
  });
});

describe('writeTerminalTitle', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('writes one plain sequence to a TTY stream outside tmux', () => {
    vi.stubEnv('TMUX', '');
    const stream = fakeStream(true);
    writeTerminalTitle(stream, '🟢  Ready');
    expect(stream.writes).toEqual([plainTitle('🟢  Ready')]);
  });

  it('writes the passthrough form when inside tmux', () => {
    vi.stubEnv('TMUX', '/tmp/tmux-1000/default,4242,0');
    const stream = fakeStream(true);
    writeTerminalTitle(stream, '🟠  Working');
    expect(stream.writes).toHaveLength(1);
    expect(stream.writes[0].startsWith(plainTitle('🟠  Working'))).toBe(true);
    expect(stream.writes[0]).toContain(ESC + 'Ptmux;');
  });

  it('is still ONE write per title inside tmux', () => {
    // The plain and passthrough forms travel together so a consumer that counts
    // writes (the AppContainer dedupe, the tests) sees one update per title change.
    vi.stubEnv('TMUX', '/tmp/tmux-1000/default,4242,0');
    const stream = fakeStream(true);
    writeTerminalTitle(stream, 'a');
    writeTerminalTitle(stream, 'b');
    expect(stream.writes).toHaveLength(2);
  });

  it('writes nothing when the stream is not a TTY', () => {
    const stream = fakeStream(false);
    writeTerminalTitle(stream, '🟢  Ready');
    expect(stream.writes).toEqual([]);
  });

  it('writes nothing for a missing stream and does not throw', () => {
    expect(() => writeTerminalTitle(undefined, 'x')).not.toThrow();
    expect(() => writeTerminalTitle(null, 'x')).not.toThrow();
  });

  it('clears the title with an empty payload', () => {
    vi.stubEnv('TMUX', '');
    const stream = fakeStream(true);
    writeTerminalTitle(stream, '');
    expect(stream.writes).toEqual([plainTitle('')]);
  });
});
