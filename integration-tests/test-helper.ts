/**
 * @license
 * Copyright 2025 Google LLC
 * Copyright 2026 Bare-AI, a trading name of Consulting Hailing Services LTD
 * SPDX-License-Identifier: Apache-2.0
 */

export * from '@bare-ai/cli-test-utils';
export { normalizePath } from '@bare-ai/cli-test-utils';

export const skipFlaky = !process.env['RUN_FLAKY_INTEGRATION'];
