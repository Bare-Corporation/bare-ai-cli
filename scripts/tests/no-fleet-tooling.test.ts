/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

// This suite's setup file replaces 'fs' with a partial stub, so the real
// module is taken through vi.importActual: these tests need working filesystem
// calls in order to build the fixture trees the guard is pointed at.
const fs = await vi.importActual<typeof import('node:fs')>('node:fs');

const guardPath = fileURLToPath(
  new URL('../../scripts/check-no-fleet-tooling.js', import.meta.url),
);

type GuardRun = {
  status: number;
  stdout: string;
  stderr: string;
};

function runGuard(args: readonly string[]): GuardRun {
  const result = spawnSync(process.execPath, [guardPath, ...args], {
    encoding: 'utf8',
  });
  return {
    status: result.status ?? -1,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

let base: string;

function fixture(name: string, files: Record<string, string>): string {
  const dir = path.join(base, name);
  fs.mkdirSync(dir, { recursive: true });
  for (const [relative, content] of Object.entries(files)) {
    const target = path.join(dir, relative);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content, 'utf8');
  }
  return dir;
}

beforeAll(() => {
  base = fs.mkdtempSync(path.join(tmpdir(), 'no-fleet-tooling-'));
});

afterAll(() => {
  fs.rmSync(base, { recursive: true, force: true });
});

describe('check-no-fleet-tooling', () => {
  it('finds the repository itself clean', () => {
    const run = runGuard([]);
    expect(run.stderr).toBe('');
    expect(run.status).toBe(0);
    expect(run.stdout).toContain('OK check-no-fleet-tooling');
  });

  it('passes a tree that holds only innocent files', () => {
    const root = fixture('clean', {
      'app.js': 'export const value = 1;',
      'nested/notes.md': 'nothing to see here',
    });
    const run = runGuard(['--root', root]);
    expect(run.stderr).toBe('');
    expect(run.status).toBe(0);
  });

  it('fails and names a stray fleet-*.sh at any depth', () => {
    const root = fixture('stray-name', {
      'nested/tools/fleet-cli-update.sh': 'echo hi',
    });
    const run = runGuard(['--root', root]);
    expect(run.status).toBe(1);
    expect(run.stderr).toContain('nested/tools/fleet-cli-update.sh');
    expect(run.stderr).toContain('name matches fleet-*.sh');
  });

  it('control: an innocent script at the same depth passes', () => {
    const root = fixture('innocent-sh', {
      'nested/tools/update-cli.sh': 'echo hi',
    });
    const run = runGuard(['--root', root]);
    expect(run.stderr).toBe('');
    expect(run.status).toBe(0);
  });

  it('fails a root script that reaches for a workspace sovereign copy', () => {
    const root = fixture('stray-content', {
      'deploy.js': 'node sovereign-v2.js --model 013',
    });
    const run = runGuard(['--root', root]);
    expect(run.status).toBe(1);
    expect(run.stderr).toContain('deploy.js');
    expect(run.stderr).toContain('sovereign-v2.js');
  });

  it('fails a root script that runs a destructive checkout', () => {
    const root = fixture('stray-checkout', {
      'sync.js': 'git checkout -- sovereign.js',
    });
    const run = runGuard(['--root', root]);
    expect(run.status).toBe(1);
    expect(run.stderr).toContain('sync.js');
    expect(run.stderr).toContain('destructive checkout');
  });

  it('scans script content at the repository root only', () => {
    const root = fixture('deep-content', {
      'nested/deploy.js': 'node sovereign-v2.js',
    });
    const run = runGuard(['--root', root]);
    expect(run.stderr).toBe('');
    expect(run.status).toBe(0);
  });

  it('exits 0 and prints usage for --help', () => {
    const run = runGuard(['--help']);
    expect(run.status).toBe(0);
    expect(run.stdout).toContain(
      'Usage: node scripts/check-no-fleet-tooling.js',
    );
  });

  it('fails closed on an unknown argument', () => {
    const run = runGuard(['--bogus']);
    expect(run.status).toBe(1);
    expect(run.stderr).toContain('bad arguments');
  });
});
