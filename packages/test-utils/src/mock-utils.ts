/**
 * @license
 * Copyright 2025 Google LLC
 * Copyright 2026 Bare-AI, a trading name of Consulting Hailing Services LTD
 * SPDX-License-Identifier: Apache-2.0
 */

import type { SandboxConfig } from '@bare-ai/core';

export function createMockSandboxConfig(
  overrides?: Partial<SandboxConfig>,
): SandboxConfig {
  return {
    enabled: true,
    allowedPaths: [],
    networkAccess: false,
    ...overrides,
  };
}
