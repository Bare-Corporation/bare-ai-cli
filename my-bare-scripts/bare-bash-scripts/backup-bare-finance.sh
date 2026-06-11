#!/bin/bash
set -e

echo "============================================"
echo " Bare-Finance Database Backup — 2026-06-11"
echo "============================================"

# --- Step 3: pg_dump ---
echo ""
echo "[Step 3] Running pg_dump via Docker..."
mkdir -p $HOME/bare-table/database

sudo docker exec bare-table-db-1 pg_dump -U bare_erp -d bare_erp --no-owner --no-privileges -f /tmp/bare-finance-backup.sql
sudo docker cp bare-table-db-1:/tmp/bare-finance-backup.sql $HOME/bare-table/database/bare-finance-backup.sql

echo "pg_dump complete: $(wc -c < $HOME/bare-table/database/bare-finance-backup.sql) bytes"

# --- Step 4: Baserow API Export ---
echo ""
echo "[Step 4] Baserow async export..."

TOKEN="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ0b2tlbl90eXBlIjoiYWNjZXNzIiwiZXhwIjoxNzgxMjAwMTA3LCJpYXQiOjE3ODExOTk1MDcsImp0aSI6IjMxZmQ5MGExYjIwOTRmMWFhNjFmZTg1ODU4YmYyZWRjIiwidXNlcl9pZCI6IjEifQ.THD3JzakajCFzrk5ie6K9GvI1GzUtS0CwE4umzh9tr0"

EXPORT_RESP=$(curl -s -X POST "http://100.64.0.19/api/database/export/async/" -H "Authorization: JWT $TOKEN" -H "Content-Type: application/json" -d '{"workspace_id": 2}')
echo "Export response:"
echo "$EXPORT_RESP" | python3 -m json.tool

JOB_ID=$(echo "$EXPORT_RESP" | python3 -c "import sys,json; print(json.load(sys.stdin).get('job_id',''))" 2>/dev/null)
echo "JOB_ID=$JOB_ID"

if [ -z "$JOB_ID" ]; then
  echo "ERROR: No job_id returned from export API"
  exit 1
fi

for i in $(seq 1 30); do
  sleep 10
  JOB_STATUS=$(curl -s "http://100.64.0.19/api/jobs/$JOB_ID/" -H "Authorization: JWT $TOKEN")
  STATE=$(echo "$JOB_STATUS" | python3 -c "import sys,json; print(json.load(sys.stdin).get('state',''))" 2>/dev/null)
  echo "Poll $i: state=$STATE"
  
  if [ "$STATE" = "finished" ]; then
    EXPORT_URL=$(echo "$JOB_STATUS" | python3 -c "import sys,json; print(json.load(sys.stdin).get('exported_file_url',''))" 2>/dev/null)
    echo "EXPORT_URL=$EXPORT_URL"
    if [ -n "$EXPORT_URL" ]; then
      curl -s -o $HOME/bare-table/database/bare-finance-export.tar.gz -H "Authorization: JWT $TOKEN" "http://100.64.0.19$EXPORT_URL"
      echo "Baserow export downloaded: $(wc -c < $HOME/bare-table/database/bare-finance-export.tar.gz) bytes"
    fi
    break
  elif [ "$STATE" = "failed" ]; then
    echo "Export job FAILED:"
    echo "$JOB_STATUS" | python3 -m json.tool
    break
  fi
done

echo ""
echo "============================================"
echo " Backup files:"
echo "============================================"
ls -lh $HOME/bare-table/database/
