#!/bin/bash
cat >> /home/bare-ai/.bare-ai/diary/2026-06-11.md << 'DIARYEOF'

## Database Backup — 2026-06-11

**Task:** Backup Bare-Finance workspace and commit to git.

**Results:**
| File | Size | Contents |
|:---|:---|:---|
| bare-finance-backup.sql | 29.5 MB | Full pg_dump (schema + data) via Docker |
| Bare-Finance-api-export.tar.gz | 1.4 KB | 30 tables (API schema snapshot) |
| Bare-Control-api-export.tar.gz | 1.9 KB | 41 tables (API schema snapshot) |
| bare-db-export.py | — | Python export tool (JWT auto-refresh) |
| curl-export.sh | — | Bash export tool |

**Key Findings:**
- Baserow 2.2.2 OSE has no /api/database/export/async/ endpoint
- Database API token works only for row CRUD; JWT needed for table listing
- JWT expires in ~10 minutes
- pg_dump remains the gold standard for complete backups

**Git:** Pushed commit 00ce09e to main on github.com/Bare-Corporation/Bare-Table.git
DIARYEOF
echo "Diary updated."
