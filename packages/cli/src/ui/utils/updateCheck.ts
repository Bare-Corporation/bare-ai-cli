/**
 * @license
 * Copyright 2025 Google LLC
 * Copyright 2026 Bare-AI, a trading name of Consulting Hailing Services LTD
 * SPDX-License-Identifier: Apache-2.0
 */

import latestVersion from 'latest-version';
import semver from 'semver';
import { getPackageJson, debugLogger } from '@bare-ai/core';
import type { LoadedSettings } from '../../config/settings.js';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const FETCH_TIMEOUT_MS = 2000;

// Replicating the bits of UpdateInfo we need from update-notifier
export interface UpdateInfo {
  latest: string;
  current: string;
  name: string;
  type?: semver.ReleaseType;
}

export interface UpdateObject {
  message: string;
  update: UpdateInfo;
  isUpdating?: boolean;
}

/**
 * From a nightly and stable version, determines which is the "best" one to offer.
 * The rule is to always prefer nightly if the base versions are the same.
 */
function getBestAvailableUpdate(
  nightly?: string,
  stable?: string,
): string | null {
  if (!nightly) return stable || null;
  if (!stable) return nightly || null;

  if (semver.coerce(stable)?.version === semver.coerce(nightly)?.version) {
    return nightly;
  }

  return semver.gt(stable, nightly) ? stable : nightly;
}

/**
 * Whether an error is npm reporting that the package is not on the registry.
 *
 * Matched on the error NAME rather than with instanceof: the class comes from
 * package-json, and a second copy of that package in the dependency tree
 * yields a class that fails instanceof while still carrying the name. A name
 * check cannot be fooled that way, and it costs nothing.
 */
function isPackageNotFoundError(e: unknown): boolean {
  return (
    typeof e === 'object' &&
    e !== null &&
    'name' in e &&
    e.name === 'PackageNotFoundError'
  );
}

export async function checkForUpdates(
  settings: LoadedSettings,
): Promise<UpdateObject | null> {
  try {
    if (!settings.merged.general.enableAutoUpdateNotification) {
      return null;
    }
    // Skip update check when running from source (development mode)
    if (process.env['DEV'] === 'true') {
      return null;
    }
    const packageJson = await getPackageJson(__dirname);
    if (!packageJson || !packageJson.name || !packageJson.version) {
      return null;
    }

    const { name, version: currentVersion } = packageJson;
    const isNightly = currentVersion.includes('nightly');

    if (isNightly) {
      const [nightlyUpdate, latestUpdate] = await Promise.all([
        latestVersion(name, { version: 'nightly' }),
        latestVersion(name),
      ]);

      const bestUpdate = getBestAvailableUpdate(nightlyUpdate, latestUpdate);

      if (bestUpdate && semver.gt(bestUpdate, currentVersion)) {
        const message = `A new version of Bare AI CLI is available! ${currentVersion} → ${bestUpdate}`;
        const type = semver.diff(bestUpdate, currentVersion) || undefined;
        return {
          message,
          update: {
            latest: bestUpdate,
            current: currentVersion,
            name,
            type,
          },
        };
      }
    } else {
      const latestUpdate = await latestVersion(name);

      if (latestUpdate && semver.gt(latestUpdate, currentVersion)) {
        const message = `Bare AI CLI update available! ${currentVersion} → ${latestUpdate}`;
        const type = semver.diff(latestUpdate, currentVersion) || undefined;
        return {
          message,
          update: {
            latest: latestUpdate,
            current: currentVersion,
            name,
            type,
          },
        };
      }
    }

    return null;
  } catch (e) {
    // A git checkout of this CLI is not published to npm, so there is no
    // published version to compare against. That is the normal state of every
    // node in this fleet - updates arrive by git, through bare-update - so
    // reporting it as a warning on each shutdown is noise that trains the
    // operator to ignore the warnings that matter. Say it once, quietly, at
    // debug level, and treat the outcome as 'no update available'.
    if (isPackageNotFoundError(e)) {
      debugLogger.debug(
        'Update check skipped: this package is not published to the npm registry.',
      );
      return null;
    }
    debugLogger.warn('Failed to check for updates: ' + e);
    return null;
  }
}
