/**
 * @license
 * Copyright 2025 Google LLC
 * Copyright 2026 Bare-AI, a trading name of Consulting Hailing Services LTD
 * SPDX-License-Identifier: Apache-2.0
 */

import { StreamingState } from '../ui/types.js';
import { statusGlyph, type AgentStatus } from './terminalStatus.js';

export interface TerminalTitleOptions {
  streamingState: StreamingState;
  thoughtSubject?: string;
  isConfirming: boolean;
  isSilentWorking: boolean;
  folderName: string;
  showThoughts: boolean;
  useDynamicTitle: boolean;
  /**
   * The agent loop's live status. When supplied, its circle replaces the
   * decorative per-branch glyph so the title carries one meaningful icon.
   * Omitted by callers that predate the indicator, whose output is unchanged.
   */
  status?: AgentStatus;
}

function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) {
    return text;
  }
  return text.substring(0, maxLen - 1) + '…';
}

/**
 * Computes the dynamic terminal window title based on the current CLI state.
 *
 * @param options - The current state of the CLI and environment context
 * @returns A formatted string padded to 80 characters for the terminal title
 */
export function computeTerminalTitle({
  streamingState,
  thoughtSubject,
  isConfirming,
  isSilentWorking,
  folderName,
  showThoughts,
  useDynamicTitle,
  status,
}: TerminalTitleOptions): string {
  const MAX_LEN = 80;

  // Use CLI_TITLE env var if available, otherwise use the provided folder name
  let displayContext = process.env['CLI_TITLE'] || folderName;

  if (!useDynamicTitle) {
    // The static title still carries the status circle: with the dynamic subject
    // line switched off it is the only indicator left, and that is the whole
    // point of the feature. base.length feeds the truncation maths below, so the
    // extra two code units are accounted for automatically.
    const staticIcon = status ? `${statusGlyph(status)} ` : '';
    const base = `${staticIcon}Bare AI CLI `;
    // Max context length is 80 - base.length - 2 (for brackets)
    const maxContextLen = MAX_LEN - base.length - 2;
    displayContext = truncate(displayContext, maxContextLen);
    return `${base}(${displayContext})`.padEnd(MAX_LEN, ' ');
  }

  // Pre-calculate suffix but keep it flexible
  const getSuffix = (context: string) => ` (${context})`;

  // One icon per title: when a status is supplied its circle replaces the
  // decorative glyph this branch would otherwise use.
  const statusIcon = status ? statusGlyph(status) : undefined;

  let title;
  if (status === 'error') {
    // An errored turn outranks every other state, including idle: the loop has
    // stopped, but the user still needs to see that the last run failed. The
    // latch that keeps it here lives in terminalStatus.reduceAgentStatus.
    const base = `${statusIcon}  Error`;
    // Max context length is 80 - base.length - 3 (for ' (' and ')')
    const maxContextLen = MAX_LEN - base.length - 3;
    const context = truncate(displayContext, maxContextLen);
    title = `${base}${getSuffix(context)}`;
  } else if (
    isConfirming ||
    streamingState === StreamingState.WaitingForConfirmation
  ) {
    const base = `${statusIcon ?? '✋'}  Action Required`;
    // Max context length is 80 - base.length - 3 (for ' (' and ')')
    const maxContextLen = MAX_LEN - base.length - 3;
    const context = truncate(displayContext, maxContextLen);
    title = `${base}${getSuffix(context)}`;
  } else if (isSilentWorking) {
    const base = `${statusIcon ?? '⏲'}  Working…`;
    // Max context length is 80 - base.length - 3 (for ' (' and ')')
    const maxContextLen = MAX_LEN - base.length - 3;
    const context = truncate(displayContext, maxContextLen);
    title = `${base}${getSuffix(context)}`;
  } else if (streamingState === StreamingState.Idle) {
    const base = `${statusIcon ?? '◇'}  Ready`;
    // Max context length is 80 - base.length - 3 (for ' (' and ')')
    const maxContextLen = MAX_LEN - base.length - 3;
    const context = truncate(displayContext, maxContextLen);
    title = `${base}${getSuffix(context)}`;
  } else {
    // Active/Working state
    const cleanSubject =
      showThoughts && thoughtSubject?.replace(/[\r\n]+/g, ' ').trim();

    // If we have a thought subject and it's too long to fit with the suffix,
    // we drop the suffix to maximize space for the thought.
    // Otherwise, we keep the suffix.
    // The icon prefix width is measured, not assumed: a status circle is two
    // code units where the decorative glyph was one, and the fit test below has
    // to use the real width or a long subject overflows the 80-column title.
    const iconPrefix = `${statusIcon ?? '✦'}  `;
    const suffix = getSuffix(displayContext);
    const suffixLen = suffix.length;
    const canFitThoughtWithSuffix = cleanSubject
      ? cleanSubject.length + suffixLen + iconPrefix.length <= MAX_LEN
      : true;

    let activeSuffix = '';
    let maxStatusLen = MAX_LEN - iconPrefix.length;

    if (!cleanSubject || canFitThoughtWithSuffix) {
      activeSuffix = suffix;
      maxStatusLen -= activeSuffix.length;
    }

    const displayStatus = cleanSubject
      ? truncate(cleanSubject, maxStatusLen)
      : 'Working…';

    title = `${iconPrefix}${displayStatus}${activeSuffix}`;
  }

  // Remove control characters that could cause issues in terminal titles
  // eslint-disable-next-line no-control-regex
  const safeTitle = title.replace(/[\x00-\x1F\x7F]/g, '');

  // Pad the title to a fixed width to prevent taskbar icon resizing/jitter.
  // We also slice it to ensure it NEVER exceeds MAX_LEN.
  return safeTitle.padEnd(MAX_LEN, ' ').substring(0, MAX_LEN);
}
