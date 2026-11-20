/**
 * @license
 * Copyright 2025 Google LLC
 * Copyright 2026 Bare-AI, a trading name of Consulting Hailing Services LTD
 * SPDX-License-Identifier: Apache-2.0
 */

import { randomUUID } from 'node:crypto';

export function createSessionId(): string {
  return randomUUID();
}
export const sessionId: string = createSessionId();
