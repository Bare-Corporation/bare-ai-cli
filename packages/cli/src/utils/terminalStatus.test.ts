/**
 * @license
 * Copyright 2025 Google LLC
 * Copyright 2026 Bare-AI, a trading name of Consulting Hailing Services LTD
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import {
  AGENT_STATUS_GLYPHS,
  isWindowTitleSupported,
  reduceAgentStatus,
  statusGlyph,
  type AgentStatus,
} from './terminalStatus.js';

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
