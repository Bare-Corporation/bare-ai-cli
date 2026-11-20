/**
 * @license
 * Copyright 2025 Google LLC
 * Copyright 2026 Bare-AI, a trading name of Consulting Hailing Services LTD
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Lives in its own module because zod 4 reads enum values when a schema is
 * constructed, so a schema that references an enum exported from config.ts
 * would see undefined while the config/code_assist import cycle is still
 * resolving.
 */
export enum AuthProviderType {
  DYNAMIC_DISCOVERY = 'dynamic_discovery',
  GOOGLE_CREDENTIALS = 'google_credentials',
  SERVICE_ACCOUNT_IMPERSONATION = 'service_account_impersonation',
}
