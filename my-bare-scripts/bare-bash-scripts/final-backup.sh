#!/bin/bash
set -e
# Fresh backup after schema sync
sudo docker exec bare-table-db-1 pg_dump -U bare_erp -d bare_erp --no-owner --no-privileges -f /tmp/bare-finance-backup.sql
sudo docker cp bare-table-db-1:/tmp/bare-finance-backup.sql /home/bare-ai/bare-table/database/bare-finance-backup.sql
SIZE=$(wc -c < /home/bare-ai/bare-table/database/bare-finance-backup.sql)
echo "pg_dump: ${SIZE} bytes"

# Also do fresh API exports  
TOKEN=$(curl -s -X POST http://100.64.0.19/api/user/token-auth/ -H "Content-Type: application/json" -d '{"email":"***REMOVED***","password":"***REMOVED***"}' | python3 -c "import sys,json; print(json.load(sys.stdin)['token'])")

cd /home/bare-ai/bare-table/database

for DB_ID in 2 3; do
  if [ "$DB_ID" = "2" ]; then DB_NAME="Bare-Finance"; else DB_NAME="Bare-Control"; fi
  echo "Exporting ${DB_NAME}..."
  TABLES=$(curl -s "http://100.64.0.19/api/database/tables/database/${DB_ID}/" -H "Authorization: JWT ${TOKEN}")
  TCOUNT=$(printf '%s' "$TABLES" | python3 -c "import sys,json; print(len(json.load(sys.stdin)))")
  
  TMPDIR="/tmp/bf_final_${DB_ID}"
  rm -rf "$TMPDIR"
  mkdir -p "$TMPDIR"
  
  printf '%s' "$TABLES" | python3 -c "import sys,json; [print(str(t['id'])+'|'+t['name']) for t in json.load(sys.stdin)]" > "${TMPDIR}/_index.txt"
  
  TOTAL=0
  while IFS='|' read -r tid tname; do
    SAFE=$(echo "$tname" | tr ' /()' '____')
    ROWS=$(curl -s "http://100.64.0.19/api/database/rows/table/${tid}/?size=10000" -H "Authorization: JWT ${TOKEN}")
    COUNT=$(printf '%s' "$ROWS" | python3 -c "import sys,json; print(len(json.load(sys.stdin).get('results',[])))" 2>/dev/null || echo "0")
    printf '%s' "$ROWS" > "${TMPDIR}/${tid}_${SAFE}.json"
    TOTAL=$((TOTAL + COUNT))
  done < "${TMPDIR}/_index.txt"
  
  tar -czf "${DB_NAME}-api-export.tar.gz" -C "$TMPDIR" .
  SIZE2=$(wc -c < "${DB_NAME}-api-export.tar.gz")
  echo "  -> ${DB_NAME}-api-export.tar.gz: ${SIZE2} bytes, ${TCOUNT} tables"
  rm -rf "$TMPDIR"
done

echo "Done."
ls -lh /home/bare-ai/bare-table/database/
