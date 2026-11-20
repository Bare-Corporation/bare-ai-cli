/**
 * @license
 * Copyright 2025 Google LLC
 * Copyright 2026 Bare-AI, a trading name of Consulting Hailing Services LTD
 * SPDX-License-Identifier: Apache-2.0
 */

export * from './types.js';
export * from './base-token-storage.js';
export * from './hybrid-token-storage.js';
export * from './keychain-token-storage.js';

export const DEFAULT_SERVICE_NAME = 'bare-ai-cli-oauth';
export const FORCE_ENCRYPTED_FILE_ENV_VAR =
  'GEMINI_FORCE_ENCRYPTED_FILE_STORAGE';
