/**
 * @license
 * Copyright 2025 Google LLC
 * Copyright 2026 Bare-AI, a trading name of Consulting Hailing Services LTD
 * SPDX-License-Identifier: Apache-2.0
 */

import { render } from '../../test-utils/render.js';
import { ShellModeIndicator } from './ShellModeIndicator.js';
import { describe, it, expect } from 'vitest';

describe('ShellModeIndicator', () => {
  it('renders correctly', async () => {
    const { lastFrame, unmount } = await render(<ShellModeIndicator />);
    expect(lastFrame()).toContain('shell mode enabled');
    expect(lastFrame()).toContain('esc to disable');
    unmount();
  });
});
