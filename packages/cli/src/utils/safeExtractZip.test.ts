/**
 * @license
 * Copyright 2025 Google LLC
 * Copyright 2026 Bare-AI, a trading name of Consulting Hailing Services LTD
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  UnsafeZipEntryError,
  assertNoSymlinks,
  assertSafeZipEntry,
  isSymlinkEntry,
  safeExtractZip,
} from './safeExtractZip.js';

/** Unix mode bits used by the fixtures. */
const MODE_FILE = 0o100644;
const MODE_DIR = 0o040755;
const MODE_SYMLINK = 0o120777;

/** CRC32 lookup table, so the fixtures are valid stored zips. */
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) !== 0 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c >>> 0;
  }
  return table;
})();

function crc32(data: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

interface ZipSpec {
  readonly name: string;
  readonly data?: Buffer;
  readonly mode: number;
}

/** Builds a minimal uncompressed (stored) zip archive. */
function buildZip(entries: readonly ZipSpec[]): Buffer {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBuf = Buffer.from(entry.name, 'utf8');
    const data = entry.data ?? Buffer.alloc(0);
    const crc = crc32(data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(0, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);
    localParts.push(local, nameBuf, data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE((3 << 8) | 20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(0, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE((entry.mode << 16) >>> 0, 38);
    central.writeUInt32LE(offset, 42);
    centralParts.push(central, nameBuf);

    offset += local.length + nameBuf.length + data.length;
  }

  const centralBuf = Buffer.concat(centralParts);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([...localParts, centralBuf, eocd]);
}

async function pathExists(target: string): Promise<boolean> {
  try {
    await fs.lstat(target);
    return true;
  } catch {
    return false;
  }
}

describe('safeExtractZip', () => {
  let workDir: string;
  let targetDir: string;

  beforeEach(async () => {
    workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'safe-extract-test-'));
    targetDir = path.join(workDir, 'target');
    await fs.mkdir(targetDir, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(workDir, { recursive: true, force: true });
  });

  describe('isSymlinkEntry', () => {
    it('detects a Unix symlink mode', () => {
      expect(
        isSymlinkEntry({
          fileName: 'link',
          externalFileAttributes: MODE_SYMLINK << 16,
        }),
      ).toBe(true);
    });

    it('does not flag a regular file or a directory', () => {
      expect(
        isSymlinkEntry({
          fileName: 'file',
          externalFileAttributes: MODE_FILE << 16,
        }),
      ).toBe(false);
      expect(
        isSymlinkEntry({
          fileName: 'dir/',
          externalFileAttributes: MODE_DIR << 16,
        }),
      ).toBe(false);
    });
  });

  describe('assertSafeZipEntry', () => {
    it('allows a plain nested file', () => {
      expect(() =>
        assertSafeZipEntry(
          {
            fileName: 'nested/file.txt',
            externalFileAttributes: MODE_FILE << 16,
          },
          '/tmp/target',
        ),
      ).not.toThrow();
    });

    it('allows a directory entry', () => {
      expect(() =>
        assertSafeZipEntry(
          { fileName: 'dir/', externalFileAttributes: MODE_DIR << 16 },
          '/tmp/target',
        ),
      ).not.toThrow();
    });

    it('rejects a parent segment', () => {
      expect(() =>
        assertSafeZipEntry(
          {
            fileName: '../escape.txt',
            externalFileAttributes: MODE_FILE << 16,
          },
          '/tmp/target',
        ),
      ).toThrow(UnsafeZipEntryError);
    });

    it('rejects a parent segment buried in a nested path', () => {
      expect(() =>
        assertSafeZipEntry(
          {
            fileName: 'a/../../escape.txt',
            externalFileAttributes: MODE_FILE << 16,
          },
          '/tmp/target',
        ),
      ).toThrow(UnsafeZipEntryError);
    });

    it('rejects an absolute path', () => {
      expect(() =>
        assertSafeZipEntry(
          {
            fileName: '/etc/passwd',
            externalFileAttributes: MODE_FILE << 16,
          },
          '/tmp/target',
        ),
      ).toThrow(UnsafeZipEntryError);
    });

    it('rejects a Windows drive prefix', () => {
      expect(() =>
        assertSafeZipEntry(
          {
            fileName: 'C:/windows/system32/drivers/etc/hosts',
            externalFileAttributes: MODE_FILE << 16,
          },
          '/tmp/target',
        ),
      ).toThrow(UnsafeZipEntryError);
    });

    it('rejects a symlink entry', () => {
      expect(() =>
        assertSafeZipEntry(
          { fileName: 'link', externalFileAttributes: MODE_SYMLINK << 16 },
          '/tmp/target',
        ),
      ).toThrow(UnsafeZipEntryError);
    });

    it('rejects an entry with no name', () => {
      expect(() =>
        assertSafeZipEntry(
          { fileName: '', externalFileAttributes: MODE_FILE << 16 },
          '/tmp/target',
        ),
      ).toThrow(UnsafeZipEntryError);
    });
  });

  describe('safeExtractZip', () => {
    it('extracts a normal archive', async () => {
      const zipPath = path.join(workDir, 'normal.zip');
      await fs.writeFile(
        zipPath,
        buildZip([
          {
            name: 'hello.txt',
            data: Buffer.from('hello world'),
            mode: MODE_FILE,
          },
          {
            name: 'nested/deep.txt',
            data: Buffer.from('nested'),
            mode: MODE_FILE,
          },
        ]),
      );

      await safeExtractZip(zipPath, targetDir);

      await expect(
        fs.readFile(path.join(targetDir, 'hello.txt'), 'utf8'),
      ).resolves.toBe('hello world');
      await expect(
        fs.readFile(path.join(targetDir, 'nested/deep.txt'), 'utf8'),
      ).resolves.toBe('nested');
    });

    it('rejects a symlink entry before creating the link', async () => {
      const zipPath = path.join(workDir, 'symlink.zip');
      await fs.writeFile(
        zipPath,
        buildZip([
          {
            name: 'evil-link',
            data: Buffer.from('/etc/passwd'),
            mode: MODE_SYMLINK,
          },
        ]),
      );

      await expect(safeExtractZip(zipPath, targetDir)).rejects.toThrow(
        UnsafeZipEntryError,
      );
      await expect(pathExists(path.join(targetDir, 'evil-link'))).resolves.toBe(
        false,
      );
    });

    it('rejects a parent-traversal entry and writes nothing outside', async () => {
      const zipPath = path.join(workDir, 'escape.zip');
      await fs.writeFile(
        zipPath,
        buildZip([
          {
            name: '../escaped.txt',
            data: Buffer.from('escaped'),
            mode: MODE_FILE,
          },
        ]),
      );

      await expect(safeExtractZip(zipPath, targetDir)).rejects.toThrow();
      await expect(pathExists(path.join(workDir, 'escaped.txt'))).resolves.toBe(
        false,
      );
    });
  });

  describe('assertNoSymlinks', () => {
    it('resolves when the directory does not exist', async () => {
      await expect(
        assertNoSymlinks(path.join(workDir, 'missing')),
      ).resolves.toBeUndefined();
    });

    it('resolves when the tree has no symlinks', async () => {
      await fs.writeFile(path.join(targetDir, 'plain.txt'), 'x');
      await expect(assertNoSymlinks(targetDir)).resolves.toBeUndefined();
    });

    it('removes a planted symlink and reports it', async () => {
      const linkPath = path.join(targetDir, 'planted');
      await fs.symlink('/etc/passwd', linkPath);

      await expect(assertNoSymlinks(targetDir)).rejects.toThrow(
        UnsafeZipEntryError,
      );
      await expect(pathExists(linkPath)).resolves.toBe(false);
    });
  });
});
