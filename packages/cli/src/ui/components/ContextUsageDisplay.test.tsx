/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { renderWithProviders } from '../../test-utils/render.js';
import { ContextUsageDisplay } from './ContextUsageDisplay.js';
import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import { debugLogger } from '@bare-ai/core';
import { resetContextWindowWarningState } from '../utils/contextUsage.js';
import { theme } from '../semantic-colors.js';

vi.mock('@bare-ai/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@bare-ai/core')>();
  return {
    ...actual,
    // Faithful to the real tokenLimit() precedence (env override wins over the
    // name-prefix table). If this mock ignored the override, the precedence
    // test below would be measuring the mock rather than the component.
    // Table shape: deepseek-* resolves to a 128K-class entry, everything else
    // to a deliberately round number so the arithmetic stays obvious.
    tokenLimit: (model: string) => {
      const override = Number(process.env['BARE_AI_CONTEXT_WINDOW']);
      if (Number.isFinite(override) && override > 0) {
        return override;
      }
      return model === 'deepseek-v4-flash' ? 131072 : 10000;
    },
  };
});

/**
 * Truecolour SGR foreground escape for a #RRGGBB value, derived from the live
 * theme so these assertions survive a palette change. The harness does emit
 * real codes (verified: theme.status.error renders as \u001b[38;2;255;135;175m),
 * which is what makes "not the error colour" testable rather than merely
 * asserted in a comment.
 */
function fgEscape(hex: string): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `\u001b[38;2;${r};${g};${b}m`;
}

const ERROR_COLOUR = fgEscape(theme.status.error);
const SECONDARY_COLOUR = fgEscape(theme.text.secondary);

describe('ContextUsageDisplay', () => {
  beforeEach(() => {
    delete process.env['BARE_AI_CONTEXT_WINDOW'];
  });

  afterEach(() => {
    delete process.env['BARE_AI_CONTEXT_WINDOW'];
    resetContextWindowWarningState();
    vi.restoreAllMocks();
  });

  // --- STATE 1: no authoritative window is known ---------------------------

  it('renders absolute tokens with "window unknown" and no percentage when no window is declared', async () => {
    const { lastFrame, lastFrameRaw, unmount, waitUntilReady } =
      renderWithProviders(
        <ContextUsageDisplay
          promptTokenCount={605000}
          model="deepseek-v4-flash"
          terminalWidth={120}
        />,
      );
    await waitUntilReady();
    const output = lastFrame();
    expect(output).toContain('605000');
    expect(output).toContain('window unknown');
    expect(output).not.toContain('%');
    // Not the error colour: nothing is known to be wrong, we simply have no
    // denominator.
    const raw = lastFrameRaw();
    expect(raw).toContain(SECONDARY_COLOUR);
    expect(raw).not.toContain(ERROR_COLOUR);
    unmount();
  });

  it('does not use the name-prefix table value as a denominator', async () => {
    // gemini-pro resolves to the mocked table limit of 10000, so a 5000-token
    // prompt would read "50% used" if the table were still treated as truth.
    const { lastFrame, unmount, waitUntilReady } = renderWithProviders(
      <ContextUsageDisplay
        promptTokenCount={5000}
        model="gemini-pro"
        terminalWidth={120}
      />,
    );
    await waitUntilReady();
    const output = lastFrame();
    expect(output).not.toContain('50%');
    expect(output).not.toContain('%');
    expect(output).toContain('5000');
    expect(output).toContain('window unknown');
    unmount();
  });

  it('ignores a non-positive or unparsable declared window', async () => {
    process.env['BARE_AI_CONTEXT_WINDOW'] = '0';
    const { lastFrame, unmount, waitUntilReady } = renderWithProviders(
      <ContextUsageDisplay
        promptTokenCount={5000}
        model="gemini-pro"
        terminalWidth={120}
      />,
    );
    await waitUntilReady();
    expect(lastFrame()).toContain('window unknown');
    unmount();

    process.env['BARE_AI_CONTEXT_WINDOW'] = 'not-a-number';
    const second = renderWithProviders(
      <ContextUsageDisplay
        promptTokenCount={5000}
        model="gemini-pro"
        terminalWidth={120}
      />,
    );
    await second.waitUntilReady();
    expect(second.lastFrame()).toContain('window unknown');
    second.unmount();
  });

  // --- STATE 3: unchanged normal path, now against a declared window -------

  it('renders correct percentage used once a window is declared', async () => {
    process.env['BARE_AI_CONTEXT_WINDOW'] = '10000';
    const { lastFrame, unmount, waitUntilReady } = renderWithProviders(
      <ContextUsageDisplay
        promptTokenCount={5000}
        model="gemini-pro"
        terminalWidth={120}
      />,
    );
    await waitUntilReady();
    expect(lastFrame()).toContain('50% used');
    unmount();
  });

  it('renders correctly when usage is 0%', async () => {
    process.env['BARE_AI_CONTEXT_WINDOW'] = '10000';
    const { lastFrame, unmount, waitUntilReady } = renderWithProviders(
      <ContextUsageDisplay
        promptTokenCount={0}
        model="gemini-pro"
        terminalWidth={120}
      />,
    );
    await waitUntilReady();
    expect(lastFrame()).toContain('0% used');
    unmount();
  });

  it('renders abbreviated label when terminal width is small', async () => {
    process.env['BARE_AI_CONTEXT_WINDOW'] = '10000';
    const { lastFrame, unmount, waitUntilReady } = renderWithProviders(
      <ContextUsageDisplay
        promptTokenCount={2000}
        model="gemini-pro"
        terminalWidth={80}
      />,
      { width: 80 },
    );
    await waitUntilReady();
    const output = lastFrame();
    expect(output).toContain('20%');
    expect(output).not.toContain('context used');
    unmount();
  });

  it('renders 80% correctly', async () => {
    process.env['BARE_AI_CONTEXT_WINDOW'] = '10000';
    const { lastFrame, unmount, waitUntilReady } = renderWithProviders(
      <ContextUsageDisplay
        promptTokenCount={8000}
        model="gemini-pro"
        terminalWidth={120}
      />,
    );
    await waitUntilReady();
    expect(lastFrame()).toContain('80% used');
    unmount();
  });

  it('renders 100% when full, without treating equality as exceeded', async () => {
    process.env['BARE_AI_CONTEXT_WINDOW'] = '10000';
    const { lastFrame, unmount, waitUntilReady } = renderWithProviders(
      <ContextUsageDisplay
        promptTokenCount={10000}
        model="gemini-pro"
        terminalWidth={120}
      />,
    );
    await waitUntilReady();
    expect(lastFrame()).toContain('100% used');
    unmount();
  });

  it('lets the declared window take precedence over the table entry', async () => {
    // deepseek-v4-flash's table entry is 131072; declaring 20000 must win, or
    // this reads "8% used" instead of "50% used".
    process.env['BARE_AI_CONTEXT_WINDOW'] = '20000';
    const { lastFrame, unmount, waitUntilReady } = renderWithProviders(
      <ContextUsageDisplay
        promptTokenCount={10000}
        model="deepseek-v4-flash"
        terminalWidth={120}
      />,
    );
    await waitUntilReady();
    expect(lastFrame()).toContain('50% used');
    unmount();
  });

  // --- STATE 2: a declared window has been exceeded ------------------------

  // Regression: a live deepseek-v4-flash session displayed "462% used" because
  // the denominator was a hardcoded 128K table entry while the served model
  // accepted a far larger prompt. No figure above 100% may be rendered.
  it('never renders a percentage above 100% when the declared window is exceeded', async () => {
    process.env['BARE_AI_CONTEXT_WINDOW'] = '131072';
    const { lastFrame, lastFrameRaw, unmount, waitUntilReady } =
      renderWithProviders(
        <ContextUsageDisplay
          promptTokenCount={605000}
          model="deepseek-v4-flash"
          terminalWidth={120}
        />,
      );
    await waitUntilReady();
    const output = lastFrame();
    expect(output).not.toMatch(/[1-9][0-9]{2}% used/);
    expect(output).not.toContain('% used');
    expect(output).toContain('605000');
    expect(output).toContain('131072');
    expect(output).toContain('configured');
    // This one IS a problem, so it keeps the error colour.
    expect(lastFrameRaw()).toContain(ERROR_COLOUR);
    unmount();
  });

  it('keeps the absolute token figures in the narrow over-window label', async () => {
    process.env['BARE_AI_CONTEXT_WINDOW'] = '131072';
    const { lastFrame, unmount, waitUntilReady } = renderWithProviders(
      <ContextUsageDisplay
        promptTokenCount={605000}
        model="deepseek-v4-flash"
        terminalWidth={80}
      />,
      { width: 80 },
    );
    await waitUntilReady();
    const output = lastFrame();
    expect(output).not.toMatch(/[1-9][0-9]{2}% used/);
    expect(output).toContain('605000');
    expect(output).toContain('131072');
    unmount();
  });

  it('renders 31% used for a prompt within the declared window', async () => {
    process.env['BARE_AI_CONTEXT_WINDOW'] = '131072';
    const { lastFrame, unmount, waitUntilReady } = renderWithProviders(
      <ContextUsageDisplay
        promptTokenCount={40000}
        model="deepseek-v4-flash"
        terminalWidth={120}
      />,
    );
    await waitUntilReady();
    // 40000 / 131072 = 0.305 -> "31% used"
    expect(lastFrame()).toContain('31% used');
    unmount();
  });

  // --- Self-reporting: the data-collection path ----------------------------

  it('still reports the resolved-limit mismatch when no window is declared', async () => {
    // This must NOT be gated on the display having a denominator: it is what
    // puts the real observed ceiling of a fleet-served model into the log.
    const warnSpy = vi.spyOn(debugLogger, 'warn').mockImplementation(() => {});

    const { lastFrame, unmount, waitUntilReady } = renderWithProviders(
      <ContextUsageDisplay
        promptTokenCount={605000}
        model="deepseek-v4-flash"
        terminalWidth={120}
      />,
    );
    await waitUntilReady();

    // The display says it does not know the window...
    expect(lastFrame()).toContain('window unknown');
    // ...and the log still records what the session actually reached.
    expect(warnSpy).toHaveBeenCalledTimes(1);
    const message = String(warnSpy.mock.calls[0][0]);
    expect(message).toContain('deepseek-v4-flash');
    expect(message).toContain('605000');
    expect(message).toContain('131072');
    unmount();
  });

  it('reports the mismatch once per model, not once per render', async () => {
    const warnSpy = vi.spyOn(debugLogger, 'warn').mockImplementation(() => {});

    const first = renderWithProviders(
      <ContextUsageDisplay
        promptTokenCount={605000}
        model="deepseek-v4-flash"
        terminalWidth={120}
      />,
    );
    await first.waitUntilReady();
    expect(warnSpy).toHaveBeenCalledTimes(1);

    const second = renderWithProviders(
      <ContextUsageDisplay
        promptTokenCount={605001}
        model="deepseek-v4-flash"
        terminalWidth={120}
      />,
    );
    await second.waitUntilReady();
    expect(warnSpy).toHaveBeenCalledTimes(1);

    first.unmount();
    second.unmount();
  });
});
