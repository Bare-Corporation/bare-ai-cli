/**
 * @license
 * Copyright 2025 Google LLC
 * Copyright 2026 Bare-AI, a trading name of Consulting Hailing Services LTD
 * SPDX-License-Identifier: Apache-2.0
 */

import { getPackageJson } from './package.js';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let versionPromise: Promise<string> | undefined;

export function getVersion(): Promise<string> {
  if (versionPromise) {
    return versionPromise;
  }
  versionPromise = (async () => {
    const pkgJson = await getPackageJson(__dirname);
    return process.env['CLI_VERSION'] || pkgJson?.version || 'unknown';
  })();
  return versionPromise;
}

/** For testing purposes only */
export function resetVersionCache(): void {
  versionPromise = undefined;
}
