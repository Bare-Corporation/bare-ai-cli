/**
 * @license
 * Copyright 2025 Google LLC
 * Copyright 2026 Bare-AI, a trading name of Consulting Hailing Services LTD
 * SPDX-License-Identifier: Apache-2.0
 */

import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { checkForUpdates } from './updateCheck.js';
import type { LoadedSettings } from '../../config/settings.js';

const getPackageJson = vi.hoisted(() => vi.fn());
const debugLogger = vi.hoisted(() => ({
  warn: vi.fn(),
  debug: vi.fn(),
}));
vi.mock('@bare-ai/core', () => ({
  getPackageJson,
  debugLogger,
}));

const latestVersion = vi.hoisted(() => vi.fn());
vi.mock('latest-version', () => ({
  default: latestVersion,
}));

describe('checkForUpdates', () => {
  let mockSettings: LoadedSettings;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.resetAllMocks();
    // Clear DEV environment variable before each test
    delete process.env['DEV'];

    mockSettings = {
      merged: {
        general: {
          enableAutoUpdateNotification: true,
        },
      },
    } as LoadedSettings;
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('should return null if enableAutoUpdateNotification is false', async () => {
    mockSettings.merged.general.enableAutoUpdateNotification = false;
    const result = await checkForUpdates(mockSettings);
    expect(result).toBeNull();
    expect(getPackageJson).not.toHaveBeenCalled();
    expect(latestVersion).not.toHaveBeenCalled();
  });

  it('should return null when running from source (DEV=true)', async () => {
    process.env['DEV'] = 'true';
    getPackageJson.mockResolvedValue({
      name: 'test-package',
      version: '1.0.0',
    });
    latestVersion.mockResolvedValue('1.1.0');
    const result = await checkForUpdates(mockSettings);
    expect(result).toBeNull();
    expect(getPackageJson).not.toHaveBeenCalled();
    expect(latestVersion).not.toHaveBeenCalled();
  });

  it('should return null if package.json is missing', async () => {
    getPackageJson.mockResolvedValue(null);
    const result = await checkForUpdates(mockSettings);
    expect(result).toBeNull();
  });

  it('should return null if there is no update', async () => {
    getPackageJson.mockResolvedValue({
      name: 'test-package',
      version: '1.0.0',
    });
    latestVersion.mockResolvedValue('1.0.0');
    const result = await checkForUpdates(mockSettings);
    expect(result).toBeNull();
  });

  it('should return a message if a newer version is available', async () => {
    getPackageJson.mockResolvedValue({
      name: 'test-package',
      version: '1.0.0',
    });
    latestVersion.mockResolvedValue('1.1.0');

    const result = await checkForUpdates(mockSettings);
    expect(result?.message).toContain('1.0.0 → 1.1.0');
    expect(result?.update.current).toEqual('1.0.0');
    expect(result?.update.latest).toEqual('1.1.0');
    expect(result?.update.name).toEqual('test-package');
  });

  it('should return null if the latest version is the same as the current version', async () => {
    getPackageJson.mockResolvedValue({
      name: 'test-package',
      version: '1.0.0',
    });
    latestVersion.mockResolvedValue('1.0.0');
    const result = await checkForUpdates(mockSettings);
    expect(result).toBeNull();
  });

  it('should return null if the latest version is older than the current version', async () => {
    getPackageJson.mockResolvedValue({
      name: 'test-package',
      version: '1.1.0',
    });
    latestVersion.mockResolvedValue('1.0.0');
    const result = await checkForUpdates(mockSettings);
    expect(result).toBeNull();
  });

  it('should return null if latestVersion rejects', async () => {
    getPackageJson.mockResolvedValue({
      name: 'test-package',
      version: '1.0.0',
    });
    latestVersion.mockRejectedValue(new Error('Timeout'));

    const result = await checkForUpdates(mockSettings);
    expect(result).toBeNull();
  });

  it('should handle errors gracefully', async () => {
    getPackageJson.mockRejectedValue(new Error('test error'));
    const result = await checkForUpdates(mockSettings);
    expect(result).toBeNull();
  });

  describe('nightly updates', () => {
    it('should notify for a newer nightly version when current is nightly', async () => {
      getPackageJson.mockResolvedValue({
        name: 'test-package',
        version: '1.2.3-nightly.1',
      });

      latestVersion.mockImplementation(async (name, options) => {
        if (options?.version === 'nightly') {
          return '1.2.3-nightly.2';
        }
        return '1.2.3';
      });

      const result = await checkForUpdates(mockSettings);
      expect(result?.message).toContain('1.2.3-nightly.1 → 1.2.3-nightly.2');
      expect(result?.update.latest).toBe('1.2.3-nightly.2');
    });
  });
});

describe('checkForUpdates with an unpublished package', () => {
  let mockSettings: LoadedSettings;

  beforeEach(() => {
    vi.resetAllMocks();
    delete process.env['DEV'];
    mockSettings = {
      merged: {
        general: {
          enableAutoUpdateNotification: true,
        },
      },
    } as LoadedSettings;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function packageNotFound(): Error {
    const err = new Error("Package '@bare-ai/cli' could not be found");
    // The name is what the production code matches on; the class comes from
    // package-json and a duplicated copy in the tree would defeat instanceof.
    err.name = 'PackageNotFoundError';
    return err;
  }

  it('suppresses PackageNotFoundError instead of warning', async () => {
    getPackageJson.mockResolvedValue({
      name: '@bare-ai/cli',
      version: '1.0.0',
    });
    latestVersion.mockRejectedValue(packageNotFound());

    const result = await checkForUpdates(mockSettings);

    expect(result).toBeNull();
    // The regression: this printed "Failed to check for updates:
    // PackageNotFoundError..." on every shutdown of a git checkout, which is
    // the normal state of this fleet's nodes.
    expect(debugLogger.warn).not.toHaveBeenCalled();
    expect(debugLogger.debug).toHaveBeenCalled();
  });

  it('still warns for a genuine failure', async () => {
    // Control: the suppression must be narrow. A network outage is a real
    // problem and has to remain visible.
    getPackageJson.mockResolvedValue({
      name: '@bare-ai/cli',
      version: '1.0.0',
    });
    latestVersion.mockRejectedValue(new Error('ETIMEDOUT'));

    const result = await checkForUpdates(mockSettings);

    expect(result).toBeNull();
    expect(debugLogger.warn).toHaveBeenCalled();
  });
});
