/**
 * @license
 * Copyright 2025 Google LLC
 * Copyright 2026 Bare-AI, a trading name of Consulting Hailing Services LTD
 * SPDX-License-Identifier: Apache-2.0
 */

import extract from 'extract-zip';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

/**
 * Hardened zip extraction shared by the extension and skill installers.
 *
 * extract-zip 2.0.1, and every earlier published version, has no patched
 * release for GHSA-7pqw-9j4j-h8q3 / GHSA-jmr9-qjv8-65gv. It does reject an
 * entry whose parent directory canonicalises outside the destination, which
 * blocks the classic "write a file through a symlink" chain, but it still
 * calls fs.symlink() with an archive-controlled target and leaves that link
 * on disk. Extracting a third-party archive before the user has consented to
 * it therefore lets the archive plant links outside the target directory.
 *
 * This helper closes that gap in two passes:
 *   1. an onEntry hook that aborts before the entry is written, rejecting
 *      symlink entries, absolute paths, Windows drive prefixes, '..'
 *      segments, and any destination that resolves outside the target;
 *   2. a post-extraction walk that removes and reports any symlink that
 *      still reached disk, as defence in depth.
 */

/** The subset of a yauzl entry the safety checks need. */
export interface ZipEntryLike {
  readonly fileName: string;
  readonly externalFileAttributes: number;
}

/** Unix file type mask and symlink type bits, as used by extract-zip. */
const S_IFMT = 0o170000;
const S_IFLNK = 0o120000;

/** A literal backslash, built without a source escape. */
const BACKSLASH = String.fromCharCode(92);

/** Matches either path separator, including Windows-style names. */
const PATH_SEPARATORS = new RegExp('[' + BACKSLASH + '/]');

/** Matches a Windows drive prefix such as C: or d: */
const WINDOWS_DRIVE_PREFIX = /^[A-Za-z]:/;

/** Raised when an archive entry would escape the target directory. */
export class UnsafeZipEntryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnsafeZipEntryError';
  }
}

/** Unix mode bits recorded for the entry in the central directory. */
export function getZipEntryMode(entry: ZipEntryLike): number {
  return (entry.externalFileAttributes >>> 16) & 0xffff;
}

/** True when the entry is a Unix symlink rather than a file or directory. */
export function isSymlinkEntry(entry: ZipEntryLike): boolean {
  return (getZipEntryMode(entry) & S_IFMT) === S_IFLNK;
}

/**
 * Throws UnsafeZipEntryError unless the entry is a plain file or directory
 * that stays inside targetDir.
 */
export function assertSafeZipEntry(
  entry: ZipEntryLike,
  targetDir: string,
): void {
  const name = entry.fileName;

  if (isSymlinkEntry(entry)) {
    throw new UnsafeZipEntryError(
      `Refusing to extract symlink entry "${name}"`,
    );
  }

  if (name.length === 0) {
    throw new UnsafeZipEntryError('Refusing to extract an entry with no name');
  }

  if (name.startsWith('/') || name.startsWith(BACKSLASH)) {
    throw new UnsafeZipEntryError(
      `Refusing to extract absolute path entry "${name}"`,
    );
  }

  if (WINDOWS_DRIVE_PREFIX.test(name)) {
    throw new UnsafeZipEntryError(
      `Refusing to extract Windows drive path entry "${name}"`,
    );
  }

  if (name.split(PATH_SEPARATORS).includes('..')) {
    throw new UnsafeZipEntryError(
      `Refusing to extract entry "${name}" containing a parent segment`,
    );
  }

  const root = path.resolve(targetDir);
  const resolved = path.resolve(root, name);
  if (resolved !== root && !resolved.startsWith(root + path.sep)) {
    throw new UnsafeZipEntryError(
      `Refusing to extract entry "${name}" outside the target directory`,
    );
  }
}

function isEnoent(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) {
    return false;
  }
  return 'code' in error && error.code === 'ENOENT';
}

async function collectSymlinks(dir: string, found: string[]): Promise<void> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isSymbolicLink()) {
      found.push(full);
      continue;
    }
    if (entry.isDirectory()) {
      await collectSymlinks(full, found);
    }
  }
}

/**
 * Removes any symlink left under root and throws if one was found.
 * A missing root simply means nothing was extracted.
 */
export async function assertNoSymlinks(root: string): Promise<void> {
  const resolvedRoot = path.resolve(root);
  try {
    await fs.readdir(resolvedRoot, { withFileTypes: true });
  } catch (error) {
    if (isEnoent(error)) {
      return;
    }
    throw error;
  }

  const found: string[] = [];
  await collectSymlinks(resolvedRoot, found);
  if (found.length === 0) {
    return;
  }

  for (const link of found) {
    await fs.unlink(link);
  }
  throw new UnsafeZipEntryError(
    `Removed ${found.length} symlink(s) created outside policy while extracting into ${resolvedRoot}`,
  );
}

/**
 * Extracts zipPath into targetDir, refusing entries that could escape it.
 */
export async function safeExtractZip(
  zipPath: string,
  targetDir: string,
): Promise<void> {
  const resolvedTarget = path.resolve(targetDir);
  await extract(zipPath, {
    dir: resolvedTarget,
    onEntry: (entry) => {
      assertSafeZipEntry(entry, resolvedTarget);
    },
  });
  await assertNoSymlinks(resolvedTarget);
}
