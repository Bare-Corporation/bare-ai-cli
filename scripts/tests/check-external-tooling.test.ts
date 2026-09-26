/**
 * Regression tests for scripts/check-external-tooling.js.
 * Generic fixtures only - no external system, path or artefact is named.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const GUARD = join(process.cwd(), 'scripts', 'check-external-tooling.js');

function runIn(dir: string): { status: number; out: string } {
  try {
    const out = execFileSync('node', [GUARD, '--root', dir], { encoding: 'utf8' });
    return { status: 0, out };
  } catch (e) {
    const err = e as { status?: number; stdout?: string; stderr?: string };
    return { status: err.status ?? 1, out: `${err.stdout ?? ''}${err.stderr ?? ''}` };
  }
}

describe('check-external-tooling', () => {
  it('passes on a clean tree', () => {
    const dir = mkdtempSync(join(tmpdir(), 'oot-'));
    try {
      mkdirSync(join(dir, 'scripts'));
      writeFileSync(join(dir, 'scripts', 'fine.sh'), 'echo hi
');
      expect(runIn(dir).status).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('fails on a script at the repository root', () => {
    const dir = mkdtempSync(join(tmpdir(), 'oot-'));
    try {
      writeFileSync(join(dir, 'some-operations-tool.sh'), 'echo hi
');
      const r = runIn(dir);
      expect(r.status).toBe(1);
      expect(r.out).toContain('some-operations-tool.sh');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('fails when a hook discards changes to a tracked file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'oot-'));
    try {
      mkdirSync(join(dir, '.husky'));
      writeFileSync(join(dir, '.husky', 'pre-commit'), 'git checkout -- tracked-file
');
      expect(runIn(dir).status).toBe(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
