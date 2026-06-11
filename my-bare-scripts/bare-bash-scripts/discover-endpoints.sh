#!/bin/bash
TOKEN="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ0b2tlbl90eXBlIjoiYWNjZXNzIiwiZXhwIjoxNzgxMjAwMTA3LCJpYXQiOjE3ODExOTk1MDcsImp0aSI6IjMxZmQ5MGExYjIwOTRmMWFhNjFmZTg1ODU4YmYyZWRjIiwidXNlcl9pZCI6IjEifQ.THD3JzakajCFzrk5ie6K9GvI1GzUtS0CwE4umzh9tr0"

echo "=== Try /api/database/2/ ==="
curl -s "http://100.64.0.19/api/database/2/" -H "Authorization: JWT ${TOKEN}" | python3 -m json.tool 2>&1 | head -30

echo ""
echo "=== Try /api/database/tables/database/2/ ==="
curl -s "http://100.64.0.19/api/database/tables/database/2/" -H "Authorization: JWT ${TOKEN}" | python3 -m json.tool 2>&1 | head -30

echo ""
echo "=== Try /api/database/views/database/2/ ==="
curl -s "http://100.64.0.19/api/database/views/database/2/" -H "Authorization: JWT ${TOKEN}" | python3 -m json.tool 2>&1 | head -30

echo ""
echo "=== Try /api/export/ ==="
curl -s -X POST "http://100.64.0.19/api/export/" -H "Authorization: JWT ${TOKEN}" -H "Content-Type: application/json" -d '{"resource_type":"database","resource_id":2}' | python3 -m json.tool 2>&1 | head -20
