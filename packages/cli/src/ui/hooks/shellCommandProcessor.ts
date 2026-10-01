/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Shell-execution surface consumed by useGeminiStream.
 *
 * STATUS: this module used to be a two-line stub that ignored every argument
 * and returned an empty object through an `any` return type. Two consequences,
 * both unintended:
 *
 * 1. Every member useGeminiStream destructures was `undefined` at runtime, so
 *    a caller such as AppContainer that invokes toggleBackgroundShell or reads
 *    backgroundShells.size would throw rather than no-op.
 * 2. The `any` return type was the sole source of ten no-unsafe-assignment
 *    errors in useGeminiStream.ts, which blocked that file from passing the
 *    repo's own pre-commit lint gate.
 *
 * The typed implementation below is deliberately minimal. It keeps the shell
 * registry honest - a real map, so backgroundShells and backgroundShellCount
 * reflect what actually backgrounded - and makes every other member a safe
 * no-op, so no call site can throw while the feature is unwired.
 *
 * Wiring up the interactive shell and the background-shell UI is a separate
 * decision and is NOT done here: the candidate implementation,
 * useExecutionLifecycle, currently has no caller anywhere in packages/cli/src.
 */

import { useCallback, useState } from 'react';
import type { BackgroundShell } from './shellReducer.js';

export type { BackgroundShell } from './shellReducer.js';

export interface ShellCommandProcessor {
  /**
   * Handles input typed in shell mode. Returns true when it consumed the
   * input. Always false here: the interactive shell path is not wired, so the
   * caller falls through to normal model handling.
   */
  handleShellCommand: (command: string, abortSignal: AbortSignal) => boolean;
  /** The pid of the shell the user is focused on, or null when there is none. */
  activeShellPtyId: number | null;
  lastShellOutputTime: number;
  backgroundShellCount: number;
  isBackgroundShellVisible: boolean;
  toggleBackgroundShell: () => void;
  backgroundCurrentShell: () => void;
  registerBackgroundShell: (
    pid: number,
    command: string,
    initialOutput: string,
  ) => void;
  dismissBackgroundShell: (pid: number) => void;
  backgroundShells: Map<number, BackgroundShell>;
}

export function useShellCommandProcessor(): ShellCommandProcessor {
  const [backgroundShells, setBackgroundShells] = useState<
    Map<number, BackgroundShell>
  >(() => new Map());

  const registerBackgroundShell = useCallback(
    (pid: number, command: string, initialOutput: string) => {
      setBackgroundShells((previous) => {
        const next = new Map(previous);
        next.set(pid, {
          pid,
          command,
          output: initialOutput,
          isBinary: false,
          binaryBytesReceived: 0,
          status: 'running',
        });
        return next;
      });
    },
    [],
  );

  const dismissBackgroundShell = useCallback((pid: number) => {
    setBackgroundShells((previous) => {
      if (!previous.has(pid)) {
        return previous;
      }
      const next = new Map(previous);
      next.delete(pid);
      return next;
    });
  }, []);

  const handleShellCommand = useCallback(
    (_command: string, _abortSignal: AbortSignal) => false,
    [],
  );
  const toggleBackgroundShell = useCallback(() => {}, []);
  const backgroundCurrentShell = useCallback(() => {}, []);

  return {
    handleShellCommand,
    activeShellPtyId: null,
    lastShellOutputTime: 0,
    backgroundShellCount: backgroundShells.size,
    isBackgroundShellVisible: false,
    toggleBackgroundShell,
    backgroundCurrentShell,
    registerBackgroundShell,
    dismissBackgroundShell,
    backgroundShells,
  };
}
