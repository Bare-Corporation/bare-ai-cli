#!/usr/bin/env node
/* eslint-env node */
/* global process */
"use strict";
/**
 * Fails when tooling that does not belong to this repository is present in the tree.
 *
 * Deliberately GENERIC. It does not name any external system, path or artefact, because naming them
 * would publish information this repository has no business carrying. What it enforces is the shape:
 * an out-of-tree operational script dropped into the repository root, and a script that discards
 * changes to a tracked file.
 *
 * Usage: node scripts/check-external-tooling.js [--root <dir>] [--quiet]
 * Exit 0 = clean, 1 = findings, 2 = usage/IO error.
 */
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const quiet = args.includes('--quiet');
const rootArg = args.indexOf('--root');
const root = path.resolve(rootArg >= 0 ? args[rootArg + 1] : process.cwd());

// Directories that legitimately hold tooling in this repository.
const ALLOWED_DIRS = new Set(['.git', '.husky', 'node_modules', 'scripts', 'packages', 'docs', 'src', 'test', 'tests']);

// A root-level script is out-of-tree operational tooling unless it is one of ours.
const ROOT_SCRIPT = /\.(sh|bash|py|rb|pl)$/i;

// A script that discards local changes to a tracked file is never acceptable here.
const DESTRUCTIVE = [/git\s+checkout\s+--\s+\S/, /git\s+reset\s+--hard/];

const findings = [];

for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
  if (entry.isDirectory()) {
    if (!ALLOWED_DIRS.has(entry.name) && !entry.name.startsWith('.')) {
      // A non-standard top-level directory is reported only if it holds scripts.
      const sub = path.join(root, entry.name);
      let holds = false;
      try {
        holds = fs.readdirSync(sub).some((f) => ROOT_SCRIPT.test(f));
      } catch {
        holds = false;
      }
      if (holds) findings.push([entry.name, 'top-level directory containing shell/python scripts']);
    }
    continue;
  }
  if (!entry.isFile()) continue;
  if (ROOT_SCRIPT.test(entry.name)) {
    findings.push([entry.name, 'script at repository root (belongs outside this repo)']);
  }
}

for (const rel of ['.husky/pre-commit']) {
  const p = path.join(root, rel);
  if (!fs.existsSync(p)) continue;
  const text = fs.readFileSync(p, 'utf8');
  for (const re of DESTRUCTIVE) {
    if (re.test(text)) findings.push([rel, 'script discards changes to tracked files']);
  }
}

if (findings.length === 0) {
  if (!quiet) console.log(`OK check-external-tooling: no out-of-tree tooling under ${root}`);
  process.exit(0);
}
console.error('BLOCKED: out-of-tree tooling found in this repository.');
for (const [file, why] of findings) console.error(`  ${file}: ${why}`);
console.error('See docs/EXTERNAL-TOOLING.md');
process.exit(1);
