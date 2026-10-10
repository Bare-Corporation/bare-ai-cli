/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

// Guard: non-repo fleet tooling must never appear inside this repository.
//
// WHY: the fleet's own update tooling lives OUTSIDE this repo, in the
// bare-ai-brain workspace. One generation of its fleet-cli-update.sh copied a
// workspace copy of sovereign-v2.js over sovereign.js and then ran a
// destructive git checkout on it, and a stale copy of that script sat
// UNTRACKED inside this repo's root, where no tracked-file hash and no review
// could see it. See docs/FLEET-TOOLING.md.
//
// WHAT: this scans the working tree - tracked and untracked alike - and exits
// 1, naming every offending path, when anything belonging to that outside
// tooling is present. It is wired into the commit path as Guard 3 of
// .husky/pre-commit and is exercised by scripts/tests/no-fleet-tooling.test.ts.
//
// Usage: node scripts/check-no-fleet-tooling.js [--root <dir>] [--quiet]

import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

// Names that only ever belong to the fleet's dispatch/rollout tooling.
const NAME_RULES = [
  { label: 'fleet-*.sh', pattern: /^fleet-.*\.sh$/i },
  { label: 'dispatch-job.sh', pattern: /^dispatch-job\.sh$/i },
  { label: 'dispatch-wait.sh', pattern: /^dispatch-wait\.sh$/i },
  { label: 'mcb-preflight.sh', pattern: /^mcb-preflight\.sh$/i },
  { label: 'swap-in.sh', pattern: /^swap-in\.sh$/i },
  { label: 'install-fleet-*.sh', pattern: /^install-fleet-.*\.sh$/i },
  { label: 'taskbus-agent-job.py', pattern: /^taskbus-agent-job\.py$/i },
  { label: '*-rollout.sh', pattern: /-rollout\.sh$/i },
  { label: 'fleet-sync-*.sh', pattern: /^fleet-sync-.*\.sh$/i },
  { label: 'fleet-bundle-swap.sh', pattern: /^fleet-bundle-swap\.sh$/i },
];

// Root-level *.sh / *.js that reach for sovereign.js from outside this repo.
// sovereign.js is authoritative HERE; a workspace copy must never replace it.
const CONTENT_RULES = [
  { label: 'mentions sovereign-v2.js', needle: 'sovereign-v2.js' },
  {
    label: 'runs a destructive checkout of sovereign.js',
    needle: 'git checkout -- sovereign',
  },
];
const CONTENT_EXTENSIONS = new Set(['.sh', '.js']);

// Only git's own object store is skipped. There is deliberately no other
// exclusion: a silently ignored path is where a stray would hide.
const SKIP_DIRS = new Set(['.git']);

/**
 * @param {string} root
 * @returns {Promise<Array<{ path: string, rules: string[] }>>}
 */
async function findStrays(root) {
  /** @type {Map<string, Set<string>>} */
  const findings = new Map();

  /** @param {string} relPath @param {string} label */
  const record = (relPath, label) => {
    const labels = findings.get(relPath) ?? new Set();
    labels.add(label);
    findings.set(relPath, labels);
  };

  /** @param {string} dir @param {number} depth */
  const visit = async (dir, depth) => {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      const rel = path.relative(root, full).split(path.sep).join('/');

      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) {
          await visit(full, depth + 1);
        }
        continue;
      }

      for (const rule of NAME_RULES) {
        if (rule.pattern.test(entry.name)) {
          record(rel, `name matches ${rule.label}`);
        }
      }

      const isRootScript =
        depth === 0 &&
        CONTENT_EXTENSIONS.has(path.extname(entry.name).toLowerCase());
      // readFile follows symlinks on purpose: a link with an innocent name
      // pointing at outside tooling must not read as a clean file.
      if (isRootScript && (entry.isFile() || entry.isSymbolicLink())) {
        let text;
        try {
          text = (await readFile(full, 'utf8')).toLowerCase();
        } catch {
          record(rel, 'unreadable while scanning (fail-closed)');
          continue;
        }
        for (const rule of CONTENT_RULES) {
          if (text.includes(rule.needle)) {
            record(rel, `${rule.label} (${rule.needle})`);
          }
        }
      }
    }
  };

  await visit(root, 0);

  return [...findings.entries()]
    .map(([filePath, labels]) => ({
      path: filePath,
      rules: [...labels].sort(),
    }))
    .sort((a, b) => a.path.localeCompare(b.path));
}

/** @param {string[]} argv */
function parseArgs(argv) {
  const defaultRoot = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '..',
  );
  let root = defaultRoot;
  let quiet = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--root') {
      const value = argv[i + 1];
      if (!value) {
        throw new Error('--root requires a directory');
      }
      root = path.resolve(value);
      i++;
    } else if (arg === '--quiet') {
      quiet = true;
    } else if (arg === '--help' || arg === '-h') {
      console.log(
        'Usage: node scripts/check-no-fleet-tooling.js [--root <dir>] [--quiet]',
      );
      process.exit(0);
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }

  return { root, quiet };
}

async function main() {
  let options;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error('FAIL check-no-fleet-tooling: bad arguments');
    console.error(String(error));
    process.exit(1);
  }

  const strays = await findStrays(options.root);

  if (strays.length === 0) {
    if (!options.quiet) {
      console.log(
        `OK check-no-fleet-tooling: no fleet-tooling strays under ${options.root}`,
      );
    }
    process.exit(0);
  }

  console.error(
    'FAIL check-no-fleet-tooling: fleet tooling that belongs outside this repo is present in the tree',
  );
  console.error(`root: ${options.root}`);
  for (const stray of strays) {
    console.error(`  ${stray.path}  [${stray.rules.join('; ')}]`);
  }
  console.error(
    'Fleet update tooling belongs to the bare-ai-brain workspace, not this repo,',
  );
  console.error(
    'and sovereign.js is authoritative here. See docs/FLEET-TOOLING.md.',
  );
  console.error('Remove or relocate the path(s) named above, then retry.');
  process.exit(1);
}

await main();
