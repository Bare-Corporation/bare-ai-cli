/**
 * @license
 * Copyright 2025 Google LLC
 * Copyright 2026 Bare-AI, a trading name of Consulting Hailing Services LTD
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import { getFlattenedSchema, parseEditedValue } from './settingsUtils.js';

describe('parseEditedValue with bounds', () => {
  const bounds = { min: 1, max: 256 };

  it('rejects a value above the maximum', () => {
    expect(parseEditedValue('number', '300', bounds)).toBeNull();
  });

  it('rejects a value below the minimum', () => {
    expect(parseEditedValue('number', '0', bounds)).toBeNull();
    expect(parseEditedValue('number', '-7', bounds)).toBeNull();
  });

  it('accepts both inclusive limits', () => {
    expect(parseEditedValue('number', '1', bounds)).toBe(1);
    expect(parseEditedValue('number', '256', bounds)).toBe(256);
  });

  it('rejects a non-integer rather than storing a fraction', () => {
    expect(parseEditedValue('number', '32.5', bounds)).toBeNull();
  });

  it('still returns null for empty or unparseable entries', () => {
    expect(parseEditedValue('number', '   ', bounds)).toBeNull();
    expect(parseEditedValue('number', 'abc', bounds)).toBeNull();
  });

  it('leaves unbounded numbers alone, so existing callers are unaffected', () => {
    expect(parseEditedValue('number', '300')).toBe(300);
    expect(parseEditedValue('number', '-7')).toBe(-7);
  });
});

describe('maxToolIterations schema bounds', () => {
  it('declares 1..256 and appears in the settings dialog', () => {
    const definition = getFlattenedSchema()['model.maxToolIterations'];
    expect(definition).toBeDefined();
    expect(definition.min).toBe(1);
    expect(definition.max).toBe(256);
    expect(definition.default).toBe(32);
    expect(definition.showInDialog).toBe(true);
  });
});
