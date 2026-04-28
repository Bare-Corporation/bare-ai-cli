/**
 * @license
 * Copyright 2026 Cloud Integration Corporation
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
 /**
############################################################
#    ____ _                 _ _       _        ____        #
#   / ___| | ___  _   _  ___| (_)_ __ | |_     / ___|___   #
#  | |   | |/ _ \| | | |/ __| | | '_ \| __|   | |   / _ \  #
#  | |___| | (_) | |_| | (__| | | | | | |_    | |__| (_) | #
#   \____|_|\___/ \__,_|\___|_|_|_| |_|\__|    \____\___/  #
#                                                          #
############################################################
*/
import type React from 'react';
import { StatsDisplay } from './StatsDisplay.js';
import { useSessionStats } from '../contexts/SessionContext.js';
import { escapeShellArg, getShellConfiguration } from '@bare-ai/core';

interface SessionSummaryDisplayProps {
  duration: string;
}

export const SessionSummaryDisplay: React.FC<SessionSummaryDisplayProps> = ({
  duration,
}) => {
  const { stats } = useSessionStats();
  const { shell } = getShellConfiguration();
  const footer = `To resume this session: bare --resume ${escapeShellArg(stats.sessionId, shell)}`;

  return (
    <StatsDisplay
      title="Agent powering down. Goodbye!"
      duration={duration}
      footer={footer}
    />
  );
};
