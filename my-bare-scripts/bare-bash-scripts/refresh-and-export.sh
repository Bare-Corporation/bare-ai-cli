#!/bin/bash
NEW_TOKEN=$(curl -s -X POST http://100.64.0.19/api/user/token-auth/ -H "Content-Type: application/json" -d '{"email":"admin@bare-table.com","password":"Test1234!Abcd"}' | python3 -c "import sys,json; print(json.load(sys.stdin)['token'])")
echo "Token length: $(echo ${NEW_TOKEN} | wc -c)"
SCRIPT="/home/bare-ai/bare-ai-cli/my-bare-scripts/bare-python3-scripts/bare-db-export.py"
sed -i "s|^TOKEN = .*|TOKEN = "${NEW_TOKEN}"|" "${SCRIPT}"
echo "Running export..."
python3 "${SCRIPT}"
