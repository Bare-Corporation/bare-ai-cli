#!/bin/bash
TOKEN=$(curl -s -X POST http://100.64.0.19/api/user/token-auth/ -H "Content-Type: application/json" -d '{"email":"admin@bare-table.com","password":"Test1234!Abcd"}' | python3 -c "import sys,json; print(json.load(sys.stdin)['token'])")
echo "Token OK"

# Test table 8 rows
echo "=== Table 8 (Legal Entity) rows ==="
curl -s "http://100.64.0.19/api/database/rows/table/8/?size=5" -H "Authorization: JWT ${TOKEN}" | python3 -c "
import sys,json
d=json.load(sys.stdin)
print('Top keys:', list(d.keys()))
print('count:', d.get('count','N/A'))
print('results type:', type(d.get('results','')).__name__)
print('results len:', len(d.get('results',[])))
if d.get('results'):
    print('First row keys:', list(d['results'][0].keys())[:5])
"

# Test with limit instead of size
echo ""
echo "=== Table 8 with limit=5 ==="
curl -s "http://100.64.0.19/api/database/rows/table/8/?limit=5" -H "Authorization: JWT ${TOKEN}" | python3 -c "
import sys,json
d=json.load(sys.stdin)
print('count:', d.get('count','N/A'))
print('results len:', len(d.get('results',[])))
"

# Check what query params the API actually uses
echo ""
echo "=== Table 8 no params ==="
curl -s "http://100.64.0.19/api/database/rows/table/8/" -H "Authorization: JWT ${TOKEN}" | python3 -c "
import sys,json
d=json.load(sys.stdin)
print('count:', d.get('count','N/A'))
print('results len:', len(d.get('results',[])))
print('next:', d.get('next','N/A'))
"
