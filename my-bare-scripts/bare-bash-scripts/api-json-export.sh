#!/bin/bash
# Portable JSON backup — iterates all Bare-Finance tables and dumps rows
set -e

TOKEN="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ0b2tlbl90eXBlIjoiYWNjZXNzIiwiZXhwIjoxNzgxMjAwMTA3LCJpYXQiOjE3ODExOTk1MDcsImp0aSI6IjMxZmQ5MGExYjIwOTRmMWFhNjFmZTg1ODU4YmYyZWRjIiwidXNlcl9pZCI6IjEifQ.THD3JzakajCFzrk5ie6K9GvI1GzUtS0CwE4umzh9tr0"
OUTDIR="$HOME/bare-table/database"
mkdir -p "$OUTDIR"

echo "[Step 4-alt] Exporting all Bare-Finance tables via API..."

# Get all tables in database 2
TABLES=$(curl -s "http://100.64.0.19/api/database/tables/database/2/" -H "Authorization: JWT ${TOKEN}")
echo "$TABLES" | python3 -c "
import sys, json
tables = json.load(sys.stdin)
for t in tables:
    print(f"{t['id']}|{t['name']}")
" > /tmp/bf_tables.txt

echo "Found tables:"
cat /tmp/bf_tables.txt
echo ""

EXPORT_JSON="$OUTDIR/bare-finance-api-export.json"
echo "{" > "$EXPORT_JSON"
echo '  "exported_at": "'$(date -u -Iseconds)'",' >> "$EXPORT_JSON"
echo '  "database_id": 2,' >> "$EXPORT_JSON"
echo '  "database_name": "Bare-Finance",' >> "$EXPORT_JSON"
echo '  "tables": {' >> "$EXPORT_JSON"

FIRST=true
TOTAL_TABLES=0
while IFS='|' read -r tid tname; do
  TOTAL_TABLES=$((TOTAL_TABLES + 1))
  echo "  Fetching table $tid: $tname..."
  
  ROWS=$(curl -s "http://100.64.0.19/api/database/rows/table/${tid}/?size=10000" -H "Authorization: JWT ${TOKEN}")
  COUNT=$(echo "$ROWS" | python3 -c "import sys,json; print(len(json.load(sys.stdin).get('results',[])))" 2>/dev/null || echo "0")
  
  if [ "$FIRST" = true ]; then
    FIRST=false
  else
    echo "," >> "$EXPORT_JSON"
  fi
  
  echo -n "    "${tname}": " >> "$EXPORT_JSON"
  echo "$ROWS" | python3 -c "
import sys, json
data = json.load(sys.stdin)
print(json.dumps(data.get('results', []), indent=6))
" >> "$EXPORT_JSON"
  
  echo "    -> $COUNT rows"
done < /tmp/bf_tables.txt

echo "" >> "$EXPORT_JSON"
echo '  }' >> "$EXPORT_JSON"
echo "}" >> "$EXPORT_JSON"

# Validate JSON
python3 -c "import json; json.load(open('$EXPORT_JSON')); print('JSON valid')"

echo ""
echo "API export complete: $(wc -c < "$EXPORT_JSON") bytes, $TOTAL_TABLES tables"
ls -lh "$EXPORT_JSON"
