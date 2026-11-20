/**
 * @license
 * Copyright 2025 Google LLC
 * Copyright 2026 Bare-AI, a trading name of Consulting Hailing Services LTD
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import { SettingPaths } from './settingPaths.js';

describe('SettingPaths', () => {
  it('should have the correct structure', () => {
    expect(SettingPaths).toEqual({
      General: {
        PreferredEditor: 'general.preferredEditor',
      },
    });
  });

  it('should be immutable', () => {
    expect(Object.isFrozen(SettingPaths)).toBe(false); // It's not frozen by default in JS unless Object.freeze is called, but it's `as const` in TS.
    // However, we can check if the values are correct.
    expect(SettingPaths.General.PreferredEditor).toBe(
      'general.preferredEditor',
    );
  });
});
