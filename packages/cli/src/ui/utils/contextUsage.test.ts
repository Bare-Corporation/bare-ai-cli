/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import { DEEPSEEK_TOKEN_LIMIT, debugLogger } from '@bare-ai/core';
import {
  getContextUsage,
  getContextUsagePercentage,
  isContextUsageHigh,
  resetContextWindowWarningState,
  warnIfContextWindowExceeded,
} from './contextUsage.js';

// NOTE: deliberately NO module mock here. These tests run against the REAL
// tokenLimit(), which is what lets them prove that the resolved limit did not
// move and that DEEPSEEK_TOKEN_LIMIT is still the untouched table entry.

describe('contextUsage', () => {
  beforeEach(() => {
    delete process.env['BARE_AI_CONTEXT_WINDOW'];
  });

  afterEach(() => {
    delete process.env['BARE_AI_CONTEXT_WINDOW'];
    resetContextWindowWarningState();
    vi.restoreAllMocks();
  });

  describe('getContextUsage', () => {
    it('reports no authoritative window when none is declared', () => {
      const usage = getContextUsage(605000, 'deepseek-v4-flash');
      expect(usage.windowKnown).toBe(false);
      expect(usage.windowSource).toBe('none');
      expect(usage.windowLimit).toBe(0);
      expect(usage.ratio).toBe(0);
      expect(usage.exceedsKnownWindow).toBe(false);
      // The table value is still resolved - it drives behaviour and the
      // self-report - but it must never become a rendered denominator.
      expect(usage.resolvedLimit).toBe(DEEPSEEK_TOKEN_LIMIT);
      expect(usage.exceedsResolvedLimit).toBe(true);
    });

    it('becomes authoritative when the operator declares a window', () => {
      process.env['BARE_AI_CONTEXT_WINDOW'] = '524288';
      const usage = getContextUsage(605000, 'deepseek-v4-flash');
      expect(usage.windowKnown).toBe(true);
      expect(usage.windowSource).toBe('env');
      expect(usage.windowLimit).toBe(524288);
      expect(usage.ratio).toBeCloseTo(605000 / 524288, 10);
      expect(usage.exceedsKnownWindow).toBe(true);
    });

    it('lets the declared window win over the table entry', () => {
      process.env['BARE_AI_CONTEXT_WINDOW'] = '20000';
      const usage = getContextUsage(10000, 'deepseek-v4-flash');
      expect(usage.windowLimit).toBe(20000);
      expect(usage.windowLimit).not.toBe(DEEPSEEK_TOKEN_LIMIT);
      expect(usage.ratio).toBeCloseTo(0.5, 10);
    });

    it('does not treat equality with the declared window as exceeded', () => {
      process.env['BARE_AI_CONTEXT_WINDOW'] = '1000';
      const usage = getContextUsage(1000, 'deepseek-v4-flash');
      expect(usage.ratio).toBe(1);
      expect(usage.exceedsKnownWindow).toBe(false);
    });

    it.each(['0', '-1', 'not-a-number', ''])(
      'ignores the declared window %j, matching tokenLimit()',
      (value) => {
        process.env['BARE_AI_CONTEXT_WINDOW'] = value;
        expect(getContextUsage(100, 'deepseek-v4-flash').windowKnown).toBe(
          false,
        );
      },
    );

    it('reports no window for an unusable model id', () => {
      const usage = getContextUsage(100, undefined);
      expect(usage.windowKnown).toBe(false);
      expect(usage.windowLimit).toBe(0);
    });
  });

  describe('getContextUsagePercentage', () => {
    it('returns the authoritative ratio when a window is declared', () => {
      process.env['BARE_AI_CONTEXT_WINDOW'] = '10000';
      expect(getContextUsagePercentage(5000, 'deepseek-v4-flash')).toBeCloseTo(
        0.5,
        10,
      );
    });

    it('returns 0 rather than a table-derived ratio when none is declared', () => {
      expect(getContextUsagePercentage(5000, 'deepseek-v4-flash')).toBe(0);
    });
  });

  describe('isContextUsageHigh (behavioural threshold, must not move)', () => {
    it('keeps using the resolved limit when no window is declared', () => {
      // 80000 / 131072 = 0.610..., 70000 / 131072 = 0.534...
      expect(isContextUsageHigh(80000, 'deepseek-v4-flash')).toBe(true);
      expect(isContextUsageHigh(70000, 'deepseek-v4-flash')).toBe(false);
    });

    it('is NOT disabled by the display reporting an unknown window', () => {
      // Guards the obvious wrong refactor: wiring this to
      // getContextUsagePercentage() would make it permanently false on any node
      // without an override, silently switching off the context warnings.
      expect(getContextUsage(80000, 'deepseek-v4-flash').windowKnown).toBe(
        false,
      );
      expect(getContextUsagePercentage(80000, 'deepseek-v4-flash')).toBe(0);
      expect(isContextUsageHigh(80000, 'deepseek-v4-flash')).toBe(true);
    });

    it('follows the declared window once one is set', () => {
      process.env['BARE_AI_CONTEXT_WINDOW'] = '1000';
      expect(isContextUsageHigh(700, 'deepseek-v4-flash')).toBe(true);
      expect(isContextUsageHigh(500, 'deepseek-v4-flash')).toBe(false);
    });

    it('honours a custom threshold', () => {
      expect(isContextUsageHigh(50000, 'deepseek-v4-flash', 0.2)).toBe(true);
      expect(isContextUsageHigh(10000, 'deepseek-v4-flash', 0.2)).toBe(false);
    });

    it('returns false for an unusable model id, as before', () => {
      expect(isContextUsageHigh(Number.MAX_SAFE_INTEGER, undefined)).toBe(
        false,
      );
      expect(isContextUsageHigh(Number.MAX_SAFE_INTEGER, '')).toBe(false);
    });
  });

  describe('warnIfContextWindowExceeded', () => {
    it('names the model, the observed count, the resolved limit and the fix', () => {
      const warnSpy = vi
        .spyOn(debugLogger, 'warn')
        .mockImplementation(() => {});

      warnIfContextWindowExceeded(
        605000,
        'deepseek-v4-flash',
        DEEPSEEK_TOKEN_LIMIT,
      );

      expect(warnSpy).toHaveBeenCalledTimes(1);
      const message = String(warnSpy.mock.calls[0][0]);
      expect(message).toContain('deepseek-v4-flash');
      expect(message).toContain('605000');
      expect(message).toContain(String(DEEPSEEK_TOKEN_LIMIT));
      // Must tell the operator how to declare the real window.
      expect(message).toContain('BARE_AI_CONTEXT_WINDOW');
    });

    it('stays silent while the prompt fits the resolved limit', () => {
      const warnSpy = vi
        .spyOn(debugLogger, 'warn')
        .mockImplementation(() => {});

      warnIfContextWindowExceeded(1000, 'deepseek-v4-flash', 131072);

      expect(warnSpy).not.toHaveBeenCalled();
    });

    it('emits once per model per process, and independently per model', () => {
      const warnSpy = vi
        .spyOn(debugLogger, 'warn')
        .mockImplementation(() => {});

      warnIfContextWindowExceeded(605000, 'deepseek-v4-flash', 131072);
      warnIfContextWindowExceeded(605001, 'deepseek-v4-flash', 131072);
      expect(warnSpy).toHaveBeenCalledTimes(1);

      warnIfContextWindowExceeded(605000, 'deepseek-v4-pro', 131072);
      expect(warnSpy).toHaveBeenCalledTimes(2);
    });

    it('ignores an unusable model id', () => {
      const warnSpy = vi
        .spyOn(debugLogger, 'warn')
        .mockImplementation(() => {});

      warnIfContextWindowExceeded(605000, undefined, 131072);
      warnIfContextWindowExceeded(605000, '', 131072);

      expect(warnSpy).not.toHaveBeenCalled();
    });
  });
});
