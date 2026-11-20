/**
 * @license
 * Copyright 2025 Google LLC
 * Copyright 2026 Bare-AI, a trading name of Consulting Hailing Services LTD
 * SPDX-License-Identifier: Apache-2.0
 */

import yauzl from 'yauzl';
import type { Entry, ZipFile } from 'yauzl';
import { createWriteStream } from 'node:fs';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

/**
 * Hardened zip extraction shared by the extension and skill installers.
 *
 * This used to delegate to extract-zip 2.0.1, but every published release of
 * extract-zip is affected by GHSA-7pqw-9j4j-h8q3 and GHSA-jmr9-qjv8-65gv and
 * none is patched: extract-zip hands an archive-controlled target straight to
 * fs.symlink(), so an archive can plant links that point outside the
 * destination. The dangerous call sits inside the dependency, so it cannot be
 * fixed from the outside, and the dependency is gone. Extraction is done here
 * directly over yauzl, the reader extract-zip wrapped.
 *
 * The guarantees are unchanged:
 *   1. every entry is checked before anything is written, rejecting symlink
 *      entries, absolute paths, Windows drive prefixes, '..' segments, and any
 *      destination that resolves outside the target;
 *   2. a file is only written once its parent directory's real path is
 *      confirmed to be inside the target, so a symlink that already existed in
 *      the destination cannot be used as a write-through;
 *   3. no symlink is ever created, and a post-extraction walk removes and
 *      reports any symlink that somehow reached disk, as defence in depth.
 */

/** The subset of a yauzl entry the safety checks need. */
export interface ZipEntryLike {
  readonly fileName: string;
  readonly externalFileAttributes: number;
}

/** Unix file type mask and type bits, as recorded in the central directory. */
const S_IFMT = 0o170000;
const S_IFLNK = 0o120000;
const S_IFDIR = 0o040000;

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

/** True when the entry describes a directory rather than a file. */
export function isDirectoryEntry(entry: ZipEntryLike): boolean {
  return (
    entry.fileName.endsWith('/') ||
    (getZipEntryMode(entry) & S_IFMT) === S_IFDIR
  );
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

/** Opens a zip for lazy, entry-at-a-time reading. */
function openZip(zipPath: string): Promise<ZipFile> {
  return new Promise<ZipFile>((resolve, reject) => {
    yauzl.open(zipPath, { lazyEntries: true }, (error, zipFile) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(zipFile);
    });
  });
}

/**
 * Throws unless candidateDir canonicalises inside root, so a symlink that
 * already existed in the destination cannot be used to write through it.
 */
async function assertResolvesInsideRoot(
  root: string,
  candidateDir: string,
): Promise<void> {
  const [realRoot, realDir] = await Promise.all([
    fs.realpath(root),
    fs.realpath(candidateDir),
  ]);
  if (realDir !== realRoot && !realDir.startsWith(realRoot + path.sep)) {
    throw new UnsafeZipEntryError(
      `Refusing to write through "${candidateDir}", which resolves outside ${realRoot}`,
    );
  }
}

/** Validates a single entry and writes it under targetDir. */
async function extractEntry(
  zipFile: ZipFile,
  entry: Entry,
  targetDir: string,
): Promise<void> {
  assertSafeZipEntry(entry, targetDir);

  const destination = path.resolve(targetDir, entry.fileName);

  if (isDirectoryEntry(entry)) {
    await fs.mkdir(destination, { recursive: true });
    return;
  }

  const parent = path.dirname(destination);
  await fs.mkdir(parent, { recursive: true });
  await assertResolvesInsideRoot(targetDir, parent);

  const stream = await new Promise<Readable>((resolve, reject) => {
    zipFile.openReadStream(entry, (error, entryStream) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(entryStream);
    });
  });

  await pipeline(stream, createWriteStream(destination));
}

/**
 * Extracts zipPath into targetDir, refusing entries that could escape it.
 */
export async function safeExtractZip(
  zipPath: string,
  targetDir: string,
): Promise<void> {
  const resolvedTarget = path.resolve(targetDir);
  await fs.mkdir(resolvedTarget, { recursive: true });

  const zipFile = await openZip(zipPath);

  await new Promise<void>((resolve, reject) => {
    let settled = false;

    const fail = (error: Error) => {
      if (settled) {
        return;
      }
      settled = true;
      zipFile.close();
      reject(error);
    };

    zipFile.on('error', fail);
    zipFile.on('end', () => {
      if (settled) {
        return;
      }
      settled = true;
      resolve();
    });
    zipFile.on('entry', (entry: Entry) => {
      extractEntry(zipFile, entry, resolvedTarget).then(() => {
        if (!settled) {
          zipFile.readEntry();
        }
      }, fail);
    });

    zipFile.readEntry();
  });

  await assertNoSymlinks(resolvedTarget);
}
