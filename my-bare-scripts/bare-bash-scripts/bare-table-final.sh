#!/bin/bash
# Bare-Table final completion script
JWT="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ0b2tlbl90eXBlIjoiYWNjZXNzIiwiZXhwIjoxNzgxMDIwMDc0LCJpYXQiOjE3ODEwMTk0NzQsImp0aSI6ImVhNmNkMzQzN2IyYjQyMWE4OGU5NGZmMDhhMDQ2Yzc5IiwidXNlcl9pZCI6IjEifQ.LW_7rdS5tXSaaqYm8eD0P2lF3TUUFlufaLRNpycY0jc"
PASS="Test1234!Abcd"

echo "=== Step 1: Disable signups ==="
curl -s -X PATCH http://100.64.0.19/api/settings/update/ -H "Authorization: JWT ${JWT}" -H "Content-Type: application/json" -d '{"allow_new_signups":false}' | python3 -m json.tool

echo "=== Step 2: Create workspace ==="
WS_JSON=$(curl -s -X POST http://100.64.0.19/api/workspaces/ -H "Authorization: JWT ${JWT}" -H "Content-Type: application/json" -d '{"name":"Bare-Table Workspace"}')
echo "$WS_JSON" | python3 -m json.tool
WS_ID=$(echo "$WS_JSON" | python3 -c "import sys,json; print(json.load(sys.stdin)['id'])")
echo "Workspace ID: ${WS_ID}"

echo "=== Step 3: Create API token ==="
TOKEN_JSON=$(curl -s -X POST http://100.64.0.19/api/database/tokens/ -H "Authorization: JWT ${JWT}" -H "Content-Type: application/json" -d "{"name":"bare-ConnectFi Integration Token","workspace":${WS_ID}}")
echo "$TOKEN_JSON" | python3 -m json.tool
API_TOKEN=$(echo "$TOKEN_JSON" | python3 -c "import sys,json; print(json.load(sys.stdin)['key'])")
echo "API Token: ${API_TOKEN}"

echo "=== Step 4: Write credentials ==="
mkdir -p /home/bare-ai/bare-ai-workspace/credentials
cat > /home/bare-ai/bare-ai-workspace/credentials/bare-table-deploy.env << ENDCREDS
# Bare-Table Deployment Credentials
# Rebranded from bare-ERP — 2026-06-09
# KEEP SECURE
ADMIN_EMAIL=admin@bare-table.com
ADMIN_PASSWORD=${PASS}
WORKSPACE_ID=${WS_ID}
BARE_TABLE_API_TOKEN=${API_TOKEN}
BASE_API_URL=http://100.64.0.19/api/database/rows/table
ENDCREDS
chmod 600 /home/bare-ai/bare-ai-workspace/credentials/bare-table-deploy.env
echo "Credentials saved to bare-table-deploy.env"

echo "=== Step 5: Remove bare-erp directory ==="
rm -rf /home/bare-ai/bare-erp && echo "~/bare-erp removed" || echo "bare-erp already gone"

echo "=== Step 6: Remove orphaned volumes ==="
sudo docker volume ls | grep bare-erp || echo "No bare-erp volumes"
sudo docker volume ls -q | grep bare-erp | xargs -r sudo docker volume rm || true
echo "Remaining bare volumes:"
sudo docker volume ls | grep bare

echo "=== Step 7: Container status ==="
cd /home/bare-ai/bare-table && sudo docker compose ps

echo ""
echo "========== FINAL CREDENTIALS =========="
echo "ADMIN_EMAIL   : admin@bare-table.com"
echo "ADMIN_PASS    : ${PASS}"
echo "WORKSPACE_ID  : ${WS_ID}"
echo "API_TOKEN     : ${API_TOKEN:0:12}..."
echo "========================================"
