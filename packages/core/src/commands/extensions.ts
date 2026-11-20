/**
 * @license
 * Copyright 2025 Google LLC
 * Copyright 2026 Bare-AI, a trading name of Consulting Hailing Services LTD
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Config } from '../config/config.js';

export function listExtensions(config: Config) {
  return config.getExtensions();
}
