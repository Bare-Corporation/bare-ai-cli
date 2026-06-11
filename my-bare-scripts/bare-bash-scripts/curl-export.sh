#!/bin/bash
# Bare-Finance + Bare-Control API export via curl
set -e

TOKEN=$(curl -s -X POST http://100.64.0.19/api/user/token-auth/ -H "Content-Type: application/json" -d '{"email":"***REMOVED***","password":"***REMOVED***"}' | python3 -c "import sys,json; print(json.load(sys.stdin)['token'])")
echo "Token acquired"

BASE="http://100.64.0.19/api"
OUTDIR="$HOME/bare-table/database"
mkdir -p "$OUTDIR"

for DB_ID in 2 3; do
  if [ "$DB_ID" = "2" ]; then DB_NAME="Bare-Finance"; else DB_NAME="Bare-Control"; fi
  echo ""
  echo "=== ${DB_NAME} (ID=${DB_ID}) ==="
  TABLES=$(curl -s "${BASE}/database/tables/database/${DB_ID}/" -H "Authorization: JWT ${TOKEN}")
  TCOUNT=$(printf '%s' "$TABLES" | python3 -c "import sys,json; print(len(json.load(sys.stdin)))")
  echo "Tables: ${TCOUNT}"
  
  TMPDIR="/tmp/bf_export_${DB_ID}"
  rm -rf "$TMPDIR"
  mkdir -p "$TMPDIR"
  
  printf '%s' "$TABLES" | python3 -c "import sys,json; [print(str(t['id'])+'|'+t['name']) for t in json.load(sys.stdin)]" > "${TMPDIR}/_index.txt"
  
  TOTAL=0
  while IFS='|' read -r tid tname; do
    SAFE=$(echo "$tname" | tr ' /()' '____')
    echo -n "  [${tid}] ${tname} ... "
    ROWS=$(curl -s "${BASE}/database/rows/table/${tid}/?size=10000" -H "Authorization: JWT ${TOKEN}")
    COUNT=$(printf '%s' "$ROWS" | python3 -c "import sys,json; print(len(json.load(sys.stdin).get('results',[])))" 2>/dev/null || echo "0")
    echo "${COUNT} rows"
    printf '%s' "$ROWS" > "${TMPDIR}/${tid}_${SAFE}.json"
    TOTAL=$((TOTAL + COUNT))
  done < "${TMPDIR}/_index.txt"
  
  TARNAME="${DB_NAME}-api-export.tar.gz"
  tar -czf "${OUTDIR}/${TARNAME}" -C "$TMPDIR" .
  SIZE=$(wc -c < "${OUTDIR}/${TARNAME}")
  echo "  -> ${TARNAME}: ${SIZE} bytes, ${TCOUNT} tables, ${TOTAL} rows"
  rm -rf "$TMPDIR"
done

echo ""
echo "=== Final listing ==="
ls -lh "${OUTDIR}/"
