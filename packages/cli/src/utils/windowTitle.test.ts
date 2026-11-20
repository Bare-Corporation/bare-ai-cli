/**
 * @license
 * Copyright 2025 Google LLC
 * Copyright 2026 Bare-AI, a trading name of Consulting Hailing Services LTD
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  computeTerminalTitle,
  type TerminalTitleOptions,
} from './windowTitle.js';
import { StreamingState } from '../ui/types.js';

describe('computeTerminalTitle', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it.each([
    {
      description: 'idle state title with folder name',
      args: {
        streamingState: StreamingState.Idle,
        isConfirming: false,
        isSilentWorking: false,
        folderName: 'my-project',
        showThoughts: false,
        useDynamicTitle: true,
      } as TerminalTitleOptions,
      expected: '◇  Ready (my-project)',
    },
    {
      description: 'legacy title when useDynamicTitle is false',
      args: {
        streamingState: StreamingState.Responding,
        isConfirming: false,
        isSilentWorking: false,
        folderName: 'my-project',
        showThoughts: true,
        useDynamicTitle: false,
      } as TerminalTitleOptions,
      expected: 'Gemini CLI (my-project)'.padEnd(80, ' '),
      exact: true,
    },
    {
      description:
        'active state title with "Working…" when thoughts are disabled',
      args: {
        streamingState: StreamingState.Responding,
        thoughtSubject: 'Reading files',
        isConfirming: false,
        isSilentWorking: false,
        folderName: 'my-project',
        showThoughts: false,
        useDynamicTitle: true,
      } as TerminalTitleOptions,
      expected: '✦  Working… (my-project)',
    },
    {
      description:
        'active state title with thought subject and suffix when thoughts are short enough',
      args: {
        streamingState: StreamingState.Responding,
        thoughtSubject: 'Short thought',
        isConfirming: false,
        isSilentWorking: false,
        folderName: 'my-project',
        showThoughts: true,
        useDynamicTitle: true,
      } as TerminalTitleOptions,
      expected: '✦  Short thought (my-project)',
    },
    {
      description:
        'fallback active title with suffix if no thought subject is provided even when thoughts are enabled',
      args: {
        streamingState: StreamingState.Responding,
        thoughtSubject: undefined,
        isConfirming: false,
        isSilentWorking: false,
        folderName: 'my-project',
        showThoughts: true,
        useDynamicTitle: true,
      } as TerminalTitleOptions,
      expected: '✦  Working… (my-project)'.padEnd(80, ' '),
      exact: true,
    },
    {
      description: 'action required state when confirming',
      args: {
        streamingState: StreamingState.Idle,
        isConfirming: true,
        isSilentWorking: false,
        folderName: 'my-project',
        showThoughts: false,
        useDynamicTitle: true,
      } as TerminalTitleOptions,
      expected: '✋  Action Required (my-project)',
    },
    {
      description: 'silent working state',
      args: {
        streamingState: StreamingState.Responding,
        isConfirming: false,
        isSilentWorking: true,
        folderName: 'my-project',
        showThoughts: false,
        useDynamicTitle: true,
      } as TerminalTitleOptions,
      expected: '⏲  Working… (my-project)',
    },
  ])('should return $description', ({ args, expected, exact }) => {
    const title = computeTerminalTitle(args);
    if (exact) {
      expect(title).toBe(expected);
    } else {
      expect(title).toContain(expected);
    }
    expect(title.length).toBe(80);
  });

  it('should return active state title with thought subject and NO suffix when thoughts are very long', () => {
    const longThought = 'A'.repeat(70);
    const title = computeTerminalTitle({
      streamingState: StreamingState.Responding,
      thoughtSubject: longThought,
      isConfirming: false,
      isSilentWorking: false,
      folderName: 'my-project',
      showThoughts: true,
      useDynamicTitle: true,
    });

    expect(title).not.toContain('(my-project)');
    expect(title).toContain('✦  AAAAAAAAAAAAAAAA');
    expect(title.length).toBe(80);
  });

  it('should truncate long thought subjects when thoughts are enabled', () => {
    const longThought = 'A'.repeat(100);
    const title = computeTerminalTitle({
      streamingState: StreamingState.Responding,
      thoughtSubject: longThought,
      isConfirming: false,
      isSilentWorking: false,
      folderName: 'my-project',
      showThoughts: true,
      useDynamicTitle: true,
    });

    expect(title.length).toBe(80);
    expect(title).toContain('…');
    expect(title.trimEnd().length).toBe(80);
  });

  it('should strip control characters from the title', () => {
    const title = computeTerminalTitle({
      streamingState: StreamingState.Responding,
      thoughtSubject: 'BadTitle\x00 With\x07Control\x1BChars',
      isConfirming: false,
      isSilentWorking: false,
      folderName: 'my-project',
      showThoughts: true,
      useDynamicTitle: true,
    });

    expect(title).toContain('BadTitle WithControlChars');
    expect(title).not.toContain('\x00');
    expect(title).not.toContain('\x07');
    expect(title).not.toContain('\x1B');
    expect(title.length).toBe(80);
  });

  it('should prioritize CLI_TITLE environment variable over folder name when thoughts are disabled', () => {
    vi.stubEnv('CLI_TITLE', 'EnvOverride');

    const title = computeTerminalTitle({
      streamingState: StreamingState.Idle,
      isConfirming: false,
      isSilentWorking: false,
      folderName: 'my-project',
      showThoughts: false,
      useDynamicTitle: true,
    });

    expect(title).toContain('◇  Ready (EnvOverride)');
    expect(title).not.toContain('my-project');
    expect(title.length).toBe(80);
  });

  it.each([
    {
      name: 'folder name',
      folderName: 'A'.repeat(100),
      expected: '◇  Ready (AAAAA',
    },
    {
      name: 'CLI_TITLE',
      folderName: 'my-project',
      envTitle: 'B'.repeat(100),
      expected: '◇  Ready (BBBBB',
    },
  ])(
    'should truncate very long $name to fit within 80 characters',
    ({ folderName, envTitle, expected }) => {
      if (envTitle) {
        vi.stubEnv('CLI_TITLE', envTitle);
      }

      const title = computeTerminalTitle({
        streamingState: StreamingState.Idle,
        isConfirming: false,
        isSilentWorking: false,
        folderName,
        showThoughts: false,
        useDynamicTitle: true,
      });

      expect(title.length).toBe(80);
      expect(title).toContain(expected);
      expect(title).toContain('…)');
    },
  );

  it('should truncate long folder name when useDynamicTitle is false', () => {
    const longFolderName = 'C'.repeat(100);
    const title = computeTerminalTitle({
      streamingState: StreamingState.Responding,
      isConfirming: false,
      isSilentWorking: false,
      folderName: longFolderName,
      showThoughts: true,
      useDynamicTitle: false,
    });

    expect(title.length).toBe(80);
    expect(title).toContain('Gemini CLI (CCCCC');
    expect(title).toContain('…)');
  });
});

describe('computeTerminalTitle with an agent status', () => {
  const baseArgs: TerminalTitleOptions = {
    streamingState: StreamingState.Idle,
    isConfirming: false,
    isSilentWorking: false,
    folderName: 'my-project',
    showThoughts: false,
    useDynamicTitle: true,
  };

  it('shows the idle circle when the loop is ready', () => {
    expect(computeTerminalTitle({ ...baseArgs, status: 'idle' })).toBe(
      '🟢  Ready (my-project)'.padEnd(80, ' '),
    );
  });

  it('shows the working circle while responding', () => {
    expect(
      computeTerminalTitle({
        ...baseArgs,
        streamingState: StreamingState.Responding,
        status: 'working',
      }),
    ).toBe('🟠  Working… (my-project)'.padEnd(80, ' '));
  });

  it('shows the working circle while awaiting confirmation', () => {
    expect(
      computeTerminalTitle({
        ...baseArgs,
        isConfirming: true,
        status: 'working',
      }),
    ).toBe('🟠  Action Required (my-project)'.padEnd(80, ' '));
  });

  it('keeps the thought subject visible next to the working circle', () => {
    expect(
      computeTerminalTitle({
        ...baseArgs,
        streamingState: StreamingState.Responding,
        showThoughts: true,
        thoughtSubject: 'Reading the config',
        status: 'working',
      }),
    ).toBe('🟠  Reading the config (my-project)'.padEnd(80, ' '));
  });

  it('shows the error circle for a failed turn', () => {
    expect(computeTerminalTitle({ ...baseArgs, status: 'error' })).toBe(
      '🔴  Error (my-project)'.padEnd(80, ' '),
    );
  });

  it('lets the error circle outrank every other state', () => {
    // A failure while the loop is still nominally responding, or while a
    // confirmation is pending, must not be masked by those labels.
    expect(
      computeTerminalTitle({
        ...baseArgs,
        streamingState: StreamingState.Responding,
        isConfirming: true,
        status: 'error',
      }),
    ).toBe('🔴  Error (my-project)'.padEnd(80, ' '));
  });

  it('carries the circle on the static title too', () => {
    expect(
      computeTerminalTitle({
        ...baseArgs,
        useDynamicTitle: false,
        status: 'idle',
      }),
    ).toBe('🟢 Bare AI CLI (my-project)'.padEnd(80, ' '));
  });

  it('leaves the title unchanged when no status is supplied', () => {
    // Backwards compatibility: callers that predate the indicator must produce
    // exactly the bytes they produced before, decorative glyph included.
    expect(computeTerminalTitle(baseArgs)).toBe(
      '◇  Ready (my-project)'.padEnd(80, ' '),
    );
    expect(
      computeTerminalTitle({
        ...baseArgs,
        streamingState: StreamingState.Responding,
      }),
    ).toBe('✦  Working… (my-project)'.padEnd(80, ' '));
  });

  it('keeps every status title at exactly 80 columns', () => {
    const titles: string[] = [];
    for (const status of ['idle', 'working', 'error'] as const) {
      for (const useDynamicTitle of [true, false]) {
        for (const thoughtSubject of [
          undefined,
          'a very long thought subject that must be truncated to fit the title',
        ]) {
          titles.push(
            computeTerminalTitle({
              ...baseArgs,
              streamingState: StreamingState.Responding,
              showThoughts: true,
              thoughtSubject,
              useDynamicTitle,
              status,
            }),
          );
        }
      }
    }
    // 3 states x dynamic/static x with/without a long subject.
    expect(titles).toHaveLength(12);
    expect(titles.filter((title) => title.length !== 80)).toEqual([]);
  });
});
