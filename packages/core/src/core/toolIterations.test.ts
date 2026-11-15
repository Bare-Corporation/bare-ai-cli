/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  DEFAULT_MAX_TOOL_ITERATIONS,
  MAX_TOOL_ITERATIONS_CEILING,
  resolveMaxToolIterations,
} from './client.js';

describe('resolveMaxToolIterations', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('defaults to 32 when neither the setting nor the env var is set', () => {
    vi.stubEnv('BARE_AI_MAX_TOOL_ITERATIONS', '');
    expect(resolveMaxToolIterations(undefined)).toBe(32);
    expect(DEFAULT_MAX_TOOL_ITERATIONS).toBe(32);
  });

  it('honours the environment variable when the setting is unset', () => {
    vi.stubEnv('BARE_AI_MAX_TOOL_ITERATIONS', '64');
    expect(resolveMaxToolIterations(undefined)).toBe(64);
  });

  it('prefers the setting over the environment variable', () => {
    vi.stubEnv('BARE_AI_MAX_TOOL_ITERATIONS', '64');
    expect(resolveMaxToolIterations(128)).toBe(128);
  });

  it('clamps the ceiling to 256 from either source', () => {
    vi.stubEnv('BARE_AI_MAX_TOOL_ITERATIONS', '');
    expect(resolveMaxToolIterations(9999)).toBe(256);
    expect(MAX_TOOL_ITERATIONS_CEILING).toBe(256);
    vi.stubEnv('BARE_AI_MAX_TOOL_ITERATIONS', '9999');
    expect(resolveMaxToolIterations(undefined)).toBe(256);
  });

  it('treats a non-positive or unparseable value as unset rather than disabling the bound', () => {
    vi.stubEnv('BARE_AI_MAX_TOOL_ITERATIONS', '');
    expect(resolveMaxToolIterations(0)).toBe(32);
    expect(resolveMaxToolIterations(-5)).toBe(32);
    vi.stubEnv('BARE_AI_MAX_TOOL_ITERATIONS', 'not-a-number');
    expect(resolveMaxToolIterations(undefined)).toBe(32);
  });

  it('floors a fractional value so the budget stays an integer', () => {
    vi.stubEnv('BARE_AI_MAX_TOOL_ITERATIONS', '');
    expect(resolveMaxToolIterations(12.7)).toBe(12);
  });

  it('accepts the extremes of the range', () => {
    vi.stubEnv('BARE_AI_MAX_TOOL_ITERATIONS', '');
    expect(resolveMaxToolIterations(1)).toBe(1);
    expect(resolveMaxToolIterations(256)).toBe(256);
  });
});
