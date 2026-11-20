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
  DEFAULT_STATUS_AUDIO_PING,
  STATUS_AUDIO_PING_VALUES,
  buildStatusAudioCue,
  isStatusAudioEnabled,
  parseStatusAudioPing,
  playStatusAudioPing,
  resolveTerminalStream,
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
    const hostile =
      'a' + BEL + 'b' + ESC + 'c' + String.fromCharCode(127) + 'd';
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

describe('parseStatusAudioPing', () => {
  it('accepts every documented value', () => {
    expect(parseStatusAudioPing('all')).toBe('all');
    expect(parseStatusAudioPing('completion')).toBe('completion');
    expect(parseStatusAudioPing('off')).toBe('off');
  });

  it('falls back to the default for anything else', () => {
    // A settings file is hand-edited, so a typo has to degrade rather than
    // throw or silence the cue entirely.
    expect(parseStatusAudioPing('Completion')).toBe(DEFAULT_STATUS_AUDIO_PING);
    expect(parseStatusAudioPing('')).toBe(DEFAULT_STATUS_AUDIO_PING);
    expect(parseStatusAudioPing(undefined)).toBe(DEFAULT_STATUS_AUDIO_PING);
    expect(parseStatusAudioPing(null)).toBe(DEFAULT_STATUS_AUDIO_PING);
    expect(parseStatusAudioPing(1)).toBe(DEFAULT_STATUS_AUDIO_PING);
    expect(parseStatusAudioPing({ mode: 'all' })).toBe(
      DEFAULT_STATUS_AUDIO_PING,
    );
  });

  it('defaults to completion, not all', () => {
    // Starting a turn must be opt-in: it is the cue operators mute first.
    expect(DEFAULT_STATUS_AUDIO_PING).toBe('completion');
  });

  it('lists the modes in menu order', () => {
    expect(STATUS_AUDIO_PING_VALUES).toEqual(['all', 'completion', 'off']);
  });
});

describe('buildStatusAudioCue', () => {
  it('distinguishes the three statuses by BEAT COUNT', () => {
    // A terminal has one audio primitive, so count is the only channel left.
    // If these three ever collapse to the same length the cues become useless.
    expect(buildStatusAudioCue('working')).toHaveLength(1);
    expect(buildStatusAudioCue('idle')).toHaveLength(2);
    expect(buildStatusAudioCue('error')).toHaveLength(3);
  });

  it('emits only BEL bytes, never an escape sequence', () => {
    for (const status of ['idle', 'working', 'error'] as AgentStatus[]) {
      for (const step of buildStatusAudioCue(status)) {
        expect(step.bytes).toBe(BEL);
        expect(step.bytes).not.toContain(ESC);
      }
    }
  });

  it('leaves a zero gap on the final beat', () => {
    // A trailing gap would schedule a beat that does not exist, and a caller
    // that ignores gapMs would still emit the whole cue.
    for (const status of ['idle', 'working', 'error'] as AgentStatus[]) {
      const steps = buildStatusAudioCue(status);
      expect(steps[steps.length - 1].gapMs).toBe(0);
    }
  });

  it('separates beats by 120 ms and no more', () => {
    for (const status of ['idle', 'working', 'error'] as AgentStatus[]) {
      for (const step of buildStatusAudioCue(status)) {
        expect([0, 120]).toContain(step.gapMs);
      }
    }
  });

  it('returns nothing for an unknown status', () => {
    expect(buildStatusAudioCue('nonsense' as AgentStatus)).toEqual([]);
  });
});

describe('isStatusAudioEnabled', () => {
  it('silences everything when the mode is off', () => {
    expect(isStatusAudioEnabled('off', 'idle')).toBe(false);
    expect(isStatusAudioEnabled('off', 'working')).toBe(false);
    expect(isStatusAudioEnabled('off', 'error')).toBe(false);
  });

  it('rings only at the end of a turn in completion mode', () => {
    expect(isStatusAudioEnabled('completion', 'working')).toBe(false);
    expect(isStatusAudioEnabled('completion', 'idle')).toBe(true);
    // The failure is the ending that matters most - it must not be the one the
    // default mode mutes.
    expect(isStatusAudioEnabled('completion', 'error')).toBe(true);
  });

  it('rings for every status in all mode', () => {
    expect(isStatusAudioEnabled('all', 'working')).toBe(true);
    expect(isStatusAudioEnabled('all', 'idle')).toBe(true);
    expect(isStatusAudioEnabled('all', 'error')).toBe(true);
  });
});

describe('playStatusAudioPing', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  /** Records the beats in the order they are actually written. */
  function recordingStream(isTTY: boolean) {
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

  /** Runs every scheduled callback immediately, recording the requested delays. */
  function immediateScheduler() {
    const delays: number[] = [];
    return {
      delays,
      schedule(fn: () => void, ms: number) {
        delays.push(ms);
        fn();
      },
    };
  }

  it('rings twice for a completed turn (green)', () => {
    const stream = recordingStream(true);
    const scheduler = immediateScheduler();
    playStatusAudioPing(stream, 'idle', {
      mode: 'all',
      schedule: scheduler.schedule,
    });
    expect(stream.writes).toEqual([BEL, BEL]);
    expect(scheduler.delays).toEqual([120]);
  });

  it('rings once when a turn starts (orange)', () => {
    const stream = recordingStream(true);
    const scheduler = immediateScheduler();
    playStatusAudioPing(stream, 'working', {
      mode: 'all',
      schedule: scheduler.schedule,
    });
    expect(stream.writes).toEqual([BEL]);
    expect(scheduler.delays).toEqual([]);
  });

  it('rings three times for a failed turn (red)', () => {
    const stream = recordingStream(true);
    const scheduler = immediateScheduler();
    playStatusAudioPing(stream, 'error', {
      mode: 'all',
      schedule: scheduler.schedule,
    });
    expect(stream.writes).toEqual([BEL, BEL, BEL]);
    expect(scheduler.delays).toEqual([120, 120]);
  });

  it('gives a failure a different cadence from a completion', () => {
    // The whole point of the feature: distinguishable by ear without looking.
    // The scheduler is injected because the real one is a timer: without it the
    // second and third beats have not been written when the assertion runs, and
    // the comparison would be measuring this test's own timing.
    const completion = recordingStream(true);
    const failure = recordingStream(true);
    playStatusAudioPing(completion, 'idle', {
      mode: 'all',
      schedule: immediateScheduler().schedule,
    });
    playStatusAudioPing(failure, 'error', {
      mode: 'all',
      schedule: immediateScheduler().schedule,
    });
    expect(failure.writes.length).toBeGreaterThan(completion.writes.length);
  });

  it('stays silent for the working status under the default mode', () => {
    const stream = recordingStream(true);
    playStatusAudioPing(stream, 'working');
    expect(stream.writes).toEqual([]);
  });

  it('rings for an error under the default mode', () => {
    const stream = recordingStream(true);
    const scheduler = immediateScheduler();
    playStatusAudioPing(stream, 'error', { schedule: scheduler.schedule });
    expect(stream.writes).toEqual([BEL, BEL, BEL]);
  });

  it('writes NOTHING to a non-TTY stream', () => {
    // A headless --prompt run, a tee, or a CI log must never receive BEL.
    const stream = recordingStream(false);
    const scheduler = immediateScheduler();
    for (const status of ['idle', 'working', 'error'] as AgentStatus[]) {
      playStatusAudioPing(stream, status, {
        mode: 'all',
        schedule: scheduler.schedule,
      });
    }
    expect(stream.writes).toEqual([]);
    expect(scheduler.delays).toEqual([]);
  });

  it('writes nothing when the mode is off', () => {
    const stream = recordingStream(true);
    const scheduler = immediateScheduler();
    playStatusAudioPing(stream, 'error', {
      mode: 'off',
      schedule: scheduler.schedule,
    });
    expect(stream.writes).toEqual([]);
    expect(scheduler.delays).toEqual([]);
  });

  it('writes nothing for a missing stream and does not throw', () => {
    expect(() => playStatusAudioPing(undefined, 'error')).not.toThrow();
    expect(() => playStatusAudioPing(null, 'error')).not.toThrow();
  });

  it('is byte-identical inside and outside tmux', () => {
    // BEL is a single byte tmux acts on itself (bell-action), not an escape
    // sequence carrying a payload. Wrapping it in a DCS passthrough would ring
    // the outer terminal AND let tmux ring, defeating the user's bell settings.
    const outside = recordingStream(true);
    vi.stubEnv('TMUX', '');
    playStatusAudioPing(outside, 'error', { mode: 'all' });

    const inside = recordingStream(true);
    vi.stubEnv('TMUX', '/tmp/tmux-1000/default,4242,0');
    playStatusAudioPing(inside, 'error', { mode: 'all' });

    expect(inside.writes).toEqual(outside.writes);
    for (const chunk of inside.writes) {
      expect(chunk).toBe(BEL);
      expect(chunk).not.toContain('Ptmux;');
      expect(chunk).not.toContain(ESC);
    }
  });

  it('does not write a title sequence when ringing', () => {
    // Audio and title are separate writers: a ping must never smuggle OSC bytes
    // into the stream, or a pipe that missed the TTY guard would be corrupted.
    const stream = recordingStream(true);
    playStatusAudioPing(stream, 'idle', { mode: 'all' });
    for (const chunk of stream.writes) {
      expect(chunk).not.toContain(']0;');
    }
  });
});

describe('audio cues follow the status reducer', () => {
  // Local copies: the helpers in the player block are scoped to that block,
  // and a test that leans on them would be reading another describe's state.
  function recordingStream(isTTY: boolean) {
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

  function immediateScheduler() {
    const delays: number[] = [];
    return {
      delays,
      schedule(fn: () => void, ms: number) {
        delays.push(ms);
        fn();
      },
    };
  }
  it('rings once per real transition, not once per event', () => {
    // Walking the same state machine the title uses: a settled reducer emits no
    // further beats, which is what stops a render loop from ringing repeatedly.
    const stream = recordingStream(true);
    const scheduler = immediateScheduler();
    let status: AgentStatus = 'idle';
    let previous = status;

    const drive = (event: Parameters<typeof reduceAgentStatus>[1]) => {
      status = reduceAgentStatus(status, event);
      if (status !== previous) {
        previous = status;
        playStatusAudioPing(stream, status, {
          mode: 'all',
          schedule: scheduler.schedule,
        });
      }
    };

    drive('prompt-submitted');
    drive('turn-completed');
    drive('turn-completed');
    drive('turn-completed');

    // one beat for working, two for the completion - and nothing after.
    expect(stream.writes).toEqual([BEL, BEL, BEL]);
  });

  it('keeps the failure cue and never adds a completion cue after it', () => {
    // reduceAgentStatus latches error across turn-completed, so the transition
    // into error happens exactly once and the green chime never fires after it.
    const stream = recordingStream(true);
    const scheduler = immediateScheduler();
    let status: AgentStatus = 'idle';
    let previous = status;

    const drive = (event: Parameters<typeof reduceAgentStatus>[1]) => {
      status = reduceAgentStatus(status, event);
      if (status !== previous) {
        previous = status;
        playStatusAudioPing(stream, status, {
          mode: 'all',
          schedule: scheduler.schedule,
        });
      }
    };

    drive('prompt-submitted');
    drive('turn-failed');
    drive('turn-completed');

    expect(stream.writes).toEqual([BEL, BEL, BEL, BEL]);
    expect(scheduler.delays).toEqual([120, 120]);
  });
});

describe('resolveTerminalStream', () => {
  it('prefers the caller stream when it is a TTY', () => {
    const primary = { isTTY: true, write: vi.fn() };
    const secondary = { isTTY: true, write: vi.fn() };
    expect(resolveTerminalStream(primary, secondary)).toBe(primary);
  });

  it('falls back to a TTY stderr when the caller stream is piped', () => {
    const primary = { isTTY: false, write: vi.fn() };
    const secondary = { isTTY: true, write: vi.fn() };
    expect(resolveTerminalStream(primary, secondary)).toBe(secondary);
  });

  it('returns nothing when NEITHER stream is a TTY', () => {
    // The guarantee the guard exists for: a captured --prompt run must receive
    // zero control bytes, so an unusable primary must not become a licence to
    // write somewhere else that is also a pipe.
    expect(
      resolveTerminalStream({ isTTY: false }, { isTTY: false }),
    ).toBeUndefined();
    expect(resolveTerminalStream(undefined, undefined)).toBeUndefined();
    expect(resolveTerminalStream(null, {})).toBeUndefined();
  });

  it('falls back to the process stderr when no fallback is supplied', () => {
    // Not asserted for identity: this only has to prove the default is consulted
    // rather than the answer being a hard-coded undefined.
    const primary = { isTTY: false, write: vi.fn() };
    const resolved = resolveTerminalStream(primary);
    expect(resolved === undefined).toBe(process.stderr.isTTY !== true);
  });
});

describe('stderr TTY fallback (launcher pipes stdout, terminal is still there)', () => {
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

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('writes the title to stderr when stdout is a pipe', () => {
    vi.stubEnv('TMUX', '');
    const stdout = fakeStream(false);
    const stderr = fakeStream(true);
    writeTerminalTitle(stdout, '🟢  Ready', stderr);
    expect(stdout.writes).toEqual([]);
    expect(stderr.writes).toEqual([plainTitle('🟢  Ready')]);
  });

  it('keeps writing to stdout when stdout is the TTY', () => {
    vi.stubEnv('TMUX', '');
    const stdout = fakeStream(true);
    const stderr = fakeStream(true);
    writeTerminalTitle(stdout, '🟠  Working', stderr);
    expect(stderr.writes).toEqual([]);
    expect(stdout.writes).toEqual([plainTitle('🟠  Working')]);
  });

  it('writes NOTHING when both streams are pipes', () => {
    const stdout = fakeStream(false);
    const stderr = fakeStream(false);
    writeTerminalTitle(stdout, '🟢  Ready', stderr);
    expect([...stdout.writes, ...stderr.writes]).toEqual([]);
  });

  it('rings on stderr when stdout is a pipe', () => {
    const stdout = fakeStream(false);
    const stderr = fakeStream(true);
    const delays: number[] = [];
    playStatusAudioPing(stdout, 'error', {
      mode: 'all',
      fallback: stderr,
      schedule(fn: () => void, ms: number) {
        delays.push(ms);
        fn();
      },
    });
    expect(stdout.writes).toEqual([]);
    expect(stderr.writes).toEqual([BEL, BEL, BEL]);
    expect(delays).toEqual([120, 120]);
  });

  it('stays silent when both streams are pipes, even with audio enabled', () => {
    const stdout = fakeStream(false);
    const stderr = fakeStream(false);
    playStatusAudioPing(stdout, 'idle', { mode: 'all', fallback: stderr });
    expect([...stdout.writes, ...stderr.writes]).toEqual([]);
  });

  it('honours the tmux passthrough on the stderr write too', () => {
    // The fallback must not bypass the wrapper: a title written to fd 2 inside
    // tmux needs exactly the same DCS treatment as one written to fd 1.
    vi.stubEnv('TMUX', '/tmp/tmux-1000/default,4242,0');
    const stdout = fakeStream(false);
    const stderr = fakeStream(true);
    writeTerminalTitle(stdout, 'x', stderr);
    expect(stderr.writes).toHaveLength(1);
    expect(stderr.writes[0]).toContain(ESC + 'Ptmux;');
  });
});
