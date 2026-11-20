/**
 * @license
 * Copyright 2025 Google LLC
 * Copyright 2026 Bare-AI, a trading name of Consulting Hailing Services LTD
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import { calculateMainAreaWidth } from './ui-sizing.js';
import type { Config } from '@bare-ai/core';

describe('ui-sizing', () => {
  describe('calculateMainAreaWidth', () => {
    it.each([
      // expected, width, altBuffer
      [80, 80, false],
      [100, 100, false],
      [79, 80, true],
      [99, 100, true],
    ])(
      'should return %i when width=%i and altBuffer=%s',
      (expected, width, altBuffer) => {
        const mockConfig = {
          getUseAlternateBuffer: () => altBuffer,
          getUseTerminalBuffer: () => false,
        } as unknown as Config;
        expect(calculateMainAreaWidth(width, mockConfig)).toBe(expected);
      },
    );
  });
});
