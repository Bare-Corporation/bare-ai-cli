#!/bin/bash
cat >> /home/bare-ai/.bare-ai/diary/2026-06-11.md << 'DIARYEOF'

---

## Schema Sync: Bare-Control → Bare-Finance

**Task:** Compare and sync Bare-Control (DB 3) table/field names to match Bare-Finance (DB 2) master.

### Phase 1 — Schema Comparison
- Fetched full schema for both databases (via API)
- Bare-Finance: 30 tables | Bare-Control: 41 tables | 12 common (after Country rename)
- Every common table had mismatches — field name differences, type differences, format issues

### Phase 2 — Table & Field Renames
- **Table rename:** "List of Countries (ISO 3166-1)" → "Country (ISO 3166-1)" (API PATCH)
- **Field renames:** 20/20 succeeded via API (Legal Entity, Legal Entity Bank Accounts, Stakeholder Account, Stakeholder - Representatives, Workers, etc.)
- **3 API failures** resolved via direct PostgreSQL:
  - `database_field` id 1034: "Created At" → "Created_on"
  - `database_field` id 1131: "Last Modified (Confirmed Account Trigger)" → "Last_modified"
  - `database_field` id 1460: "Last Modified Time (Screening Req TRIGGER)" → "Last_modified"

### Phase 3 — Type Fixes
- **8/8 type fixes** via API: long_text→text, number→text, email→text, date→created_on, date→last_modified

### Phase 4 — Date Standardization (UTC + ISO)
- **51 format fixes** (EU/US → ISO) across both databases
- **39 timezone fixes** (None → UTC) for created_on/last_modified
- **21 name fixes** (Created Time → Created_on, Last Modified* → Last_modified)
- **8 type fixes** (date → created_on/last_modified)

### Phase 5 — Currency Lookups (Step 6)
- No link_row to Country table in BC Legal Entity — currency fields remain as text
- Needs manual link_row creation before lookup fields can be built

### Phase 6 — Unit of Measure Formula (Step 7)
- API POST /database/fields/76/ returned 405 — formula field creation not supported via API at this endpoint
- Deferred for manual UI creation

### DO NOT TOUCH (held for decision)
- Previous Name(s): multiple_select → text
- Service or Product Category: single_select → text
- Stakeholder SubType: multiple_select → single_select
- Bare-ERP Role(s): multiple_select → single_select
- Unit of Measure Category: single_select → text
- Workers: multiple_select/text/date/file conversions

### Key Learnings
- **Baserow 2.2.2 OSE** has no `/api/database/export/async/`, no `/api/schema/`
- Database API token only works for row CRUD; JWT needed for table/field listing
- JWT expires in ~10 minutes — always refresh before operations
- Django multi-table inheritance in Baserow: `database_field` is parent, child tables use `field_ptr_id` FK back to parent
- Direct PostgreSQL updates work when API returns 400 — bypass the service layer for field names
- `write_file` tool converts `
` in Python strings to literal newlines — use separate `print()` calls

### Git
- Commit `00ce09e`: Initial backup (pg_dump + API exports)
- Commit `83cbf99`: Final backup post-schema-sync (31 MB pg_dump)
DIARYEOF
echo "Diary updated."
