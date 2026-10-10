# Fleet tooling and this repo

Fleet update tooling belongs to **bare-ai-brain**, not to this repository.

- Canonical location:
  `~/.bare-necessities-workspace/my-bare-scripts/bare-bash-scripts/` (the
  bare-ai-brain workspace repo, `Cian-CloudIntCorp/-bare-ai-brain`).
- Dispatch tooling: `dispatch-job.sh`, `dispatch-wait.sh`, `mcb-preflight.sh`,
  `fleet-repo-pull-dispatch.sh`, `fleet-cli-update.sh`,
  `fleet-bundle-install.sh`.
- A copy of any of these inside this tree is a **finding**, not a convenience.
  Remove it and report it.

## sovereign.js is authoritative here

`sovereign.js` is committed and owned by this repo. Never overwrite it from a
workspace copy (for example `.../bare-js-scripts/sovereign-v2.js`), and never
run `git checkout -- sovereign.js` against a node's checkout: both discard work
that belongs to this repo.

## The fleet-cli-update.sh generations (why the guard exists)

| md5                                | size     | status                                                                                                     |
| ---------------------------------- | -------- | ---------------------------------------------------------------------------------------------------------- |
| `3dac7440cb8249ce8fbe3d539817fdde` | 2320 B   | STALE. Sat untracked in this repo's working tree (2026-08-31). Removed 2026-09-26.                         |
| `af35b50276c75b26e1b97f51e61a7948` | 2705 B   | BAD. Overwrote sovereign.js from a workspace copy and ran `git checkout -- sovereign.js`.                  |
| `e42caa517913d64e142f7650176dea97` | 52 lines | CORRECTED (2026-09-26). No sovereign-v2 reference, no destructive checkout. On all seven specialist nodes. |

## The automated check

`scripts/check-no-fleet-tooling.js` fails if tooling that belongs outside this
repo appears in the tree (tracked or untracked). It is wired into
`.husky/pre-commit` at `.husky/pre-commit:29` and is exercised by
`scripts/tests/no-fleet-tooling.test.ts`.
