#!/bin/bash
# Fetch full schema for Bare-Finance and Bare-Control
# Output: table name -> field list

TOKEN=$(curl -s -X POST http://100.64.0.19/api/user/token-auth/ -H "Content-Type: application/json" -d '{"email":"admin@bare-table.com","password":"Test1234!Abcd"}' | python3 -c "import sys,json; print(json.load(sys.stdin)['token'])")
BASE="http://100.64.0.19/api"

fetch_schema() {
  local db_id=$1
  local db_name=$2
  local outfile=$3
  
  echo "=== ${db_name} (ID=${db_id}) ===" >&2
  
  TABLES=$(curl -s "${BASE}/database/tables/database/${db_id}/" -H "Authorization: JWT ${TOKEN}")
  
  printf '%s' "$TABLES" | python3 -c "
import sys, json
tables = json.load(sys.stdin)
for t in tables:
    print(str(t['id']) + '|' + t['name'])
" | while IFS='|' read -r tid tname; do
    echo "  Fetching fields for [${tid}] ${tname}..." >&2
    FIELDS=$(curl -s "${BASE}/database/fields/table/${tid}/" -H "Authorization: JWT ${TOKEN}")
    printf '%s' "$FIELDS" | python3 -c "
import sys, json
fields = json.load(sys.stdin)
for f in fields:
    fid = f.get('id', '?')
    fname = f.get('name', '?')
    ftype = f.get('type', '?')
    print(f"${tid}|${tname}|{fid}|{fname}|{ftype}")
" 2>/dev/null
  done > "${outfile}"
  
  echo "  -> $(wc -l < "${outfile}") fields" >&2
}

fetch_schema 2 "Bare-Finance" "/tmp/bf_schema_finance.txt"
fetch_schema 3 "Bare-Control" "/tmp/bf_schema_control.txt"

echo ""
echo "=== Bare-Finance Schema (first 20) ==="
head -20 /tmp/bf_schema_finance.txt

echo ""
echo "=== Bare-Control Schema (first 20) ==="
head -20 /tmp/bf_schema_control.txt
