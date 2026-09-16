/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { Text } from 'ink';
import { theme } from '../semantic-colors.js';
import {
  getContextUsage,
  warnIfContextWindowExceeded,
} from '../utils/contextUsage.js';
import { useSettings } from '../contexts/SettingsContext.js';
import {
  MIN_TERMINAL_WIDTH_FOR_FULL_LABEL,
  DEFAULT_COMPRESSION_THRESHOLD,
} from '../constants.js';

export const ContextUsageDisplay = ({
  promptTokenCount,
  model,
  terminalWidth,
}: {
  promptTokenCount: number;
  model: string | undefined;
  terminalWidth: number;
}) => {
  const settings = useSettings();
  const {
    ratio,
    windowLimit,
    windowKnown,
    exceedsKnownWindow,
    resolvedLimit,
    exceedsResolvedLimit,
  } = getContextUsage(promptTokenCount, model);

  const threshold =
    settings.merged.model?.compressionThreshold ??
    DEFAULT_COMPRESSION_THRESHOLD;

  let textColor = theme.text.secondary;
  if (windowKnown && ratio >= 1.0) {
    textColor = theme.status.error;
  } else if (windowKnown && ratio >= threshold) {
    textColor = theme.status.warning;
  }

  const isNarrow = terminalWidth < MIN_TERMINAL_WIDTH_FOR_FULL_LABEL;

  // Self-report against the RESOLVED limit, never the known one. This is the
  // data-collection path: it captures the real prompt ceiling a live session
  // reaches in the debug log even when no window has been declared, which is
  // what will eventually justify a catalog value. Guarded once-per-model inside
  // warnIfContextWindowExceeded, so re-rendering the gauge is cheap and does
  // not spam the log.
  if (exceedsResolvedLimit) {
    warnIfContextWindowExceeded(promptTokenCount, model, resolvedLimit);
  }

  // STATE 1 - no authoritative window is known. The name-prefix table may still
  // resolve to a number, but quoting it as a denominator is the "462% used"
  // defect in its other form: an invented constant presented as fact. Render
  // the absolute count and say plainly that the window is unknown. No
  // percentage at all, and deliberately NOT the error colour - nothing is known
  // to be wrong, we simply have no denominator.
  if (!windowKnown) {
    return (
      <Text color={theme.text.secondary}>
        {`${promptTokenCount} tokens (window unknown)`}
      </Text>
    );
  }

  // STATE 2 - an authoritative window is known and has been exceeded. Never
  // render a figure above 100%: name the declared window and give the absolute
  // numbers. The absolute figures survive the narrow form on purpose - they are
  // the part that identifies a wrong declaration.
  if (exceedsKnownWindow) {
    return (
      <Text color={theme.status.error}>
        {isNarrow
          ? `over (${promptTokenCount}/${windowLimit} configured)`
          : `over window (${promptTokenCount} / ${windowLimit} configured)`}
      </Text>
    );
  }

  // STATE 3 - normal path, unchanged from before this ticket.
  const percentageUsed = (ratio * 100).toFixed(0);
  const label = isNarrow ? '%' : '% used';

  return (
    <Text color={textColor}>
      {percentageUsed}
      {label}
    </Text>
  );
};
