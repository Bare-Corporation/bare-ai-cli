/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import React from 'react';
import { Text } from 'ink';

interface ShortcutsHintProps {
  show?: boolean;
}

export function ShortcutsHint({ show }: ShortcutsHintProps): React.ReactElement | null {
  if (!show) return null;
  return <Text dimColor>Tab: complete | Esc: cancel | Ctrl+C: exit</Text>;
}
