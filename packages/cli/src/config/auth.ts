/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { AuthType } from '@bare-ai/core';
import { loadEnvironment, loadSettings } from './settings.js';

export function validateAuthMethod(authMethod: string): string | null {
  loadEnvironment(loadSettings().merged, process.cwd());
  if (
    authMethod === AuthType.LOGIN_WITH_GOOGLE ||
    authMethod === AuthType.COMPUTE_ADC
  ) {
    return null;
  }

  if (authMethod === AuthType.USE_GEMINI) {
    // If a custom endpoint is set (local AI), no API key is required
    if (process.env['BARE_AI_ENDPOINT']) {
      return null;
    }
    if (!process.env['BARE_AI_API_KEY']) {
      return (
        'Please set BARE_AI_API_KEY (for cloud APIs) or BARE_AI_ENDPOINT (for local AI).\n' +
        'Update your environment and try again (no reload needed if using .env)!'
      );
    }
    return null;
  }

  if (authMethod === AuthType.USE_VERTEX_AI) {
    const hasVertexProjectLocationConfig =
      !!process.env['GOOGLE_CLOUD_PROJECT'] &&
      !!process.env['GOOGLE_CLOUD_LOCATION'];
    const hasGoogleApiKey = !!process.env['BARE_AI_API_KEY'];
    if (!hasVertexProjectLocationConfig && !hasGoogleApiKey) {
      return (
        'When using Vertex AI, you must specify either:\n' +
        '• GOOGLE_CLOUD_PROJECT and GOOGLE_CLOUD_LOCATION environment variables.\n' +
        '• BARE_AI_API_KEY environment variable (if using express mode).\n' +
        'Update your environment and try again (no reload needed if using .env)!'
      );
    }
    return null;
  }

  return 'Invalid auth method selected.';
}
