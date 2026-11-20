/**
 * @license
 * Copyright 2025 Google LLC
 * Copyright 2026 Bare-AI, a trading name of Consulting Hailing Services LTD
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useCallback } from 'react';

export function useSettingsCommand() {
  const [isSettingsDialogOpen, setIsSettingsDialogOpen] = useState(false);

  const openSettingsDialog = useCallback(() => {
    setIsSettingsDialogOpen(true);
  }, []);

  const closeSettingsDialog = useCallback(() => {
    setIsSettingsDialogOpen(false);
  }, []);

  return {
    isSettingsDialogOpen,
    openSettingsDialog,
    closeSettingsDialog,
  };
}
