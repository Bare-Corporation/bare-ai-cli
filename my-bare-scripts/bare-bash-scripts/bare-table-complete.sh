#!/bin/bash
# Bare-Table completion: JWT, signups, workspace, API token, cleanup, report
set -e

ADMIN_PASSWORD="Test1234!Abcd"
echo "=== Getting JWT ==="
JWT=$(curl -s -X POST http://100.64.0.19/api/user/token-auth/ -H "Content-Type: application/json" -d "{"email":"admin@bare-table.com","password":"${ADMIN_PASSWORD}"}" | python3 -c "import sys,json; print(json.load(sys.stdin)['token'])")
echo "JWT: ${JWT:0:30}..."

echo "=== Disabling open signups ==="
curl -s -X PATCH http://100.64.0.19/api/settings/update/ -H "Authorization: JWT ${JWT}" -H "Content-Type: application/json" -d '{"allow_new_signups": false}' | python3 -m json.tool

echo "=== Creating workspace ==="
WS=$(curl -s -X POST http://100.64.0.19/api/workspaces/ -H "Authorization: JWT ${JWT}" -H "Content-Type: application/json" -d '{"name":"Bare-Table Workspace"}')
echo "$WS" | python3 -m json.tool
WS_ID=$(echo "$WS" | python3 -c "import sys,json; print(json.load(sys.stdin)['id'])")
echo "Workspace ID: ${WS_ID}"

echo "=== Creating API token ==="
TOKEN_RESP=$(curl -s -X POST http://100.64.0.19/api/database/tokens/ -H "Authorization: JWT ${JWT}" -H "Content-Type: application/json" -d "{"name":"bare-ConnectFi Integration Token","workspace":${WS_ID}}")
echo "$TOKEN_RESP" | python3 -m json.tool
API_TOKEN=$(echo "$TOKEN_RESP" | python3 -c "import sys,json; print(json.load(sys.stdin)['key'])")
echo "API Token: ${API_TOKEN}"

echo "=== Writing credentials ==="
mkdir -p /home/bare-ai/bare-ai-workspace/credentials
cat > /home/bare-ai/bare-ai-workspace/credentials/bare-table-deploy.env << CREDS
# Bare-Table Deployment Credentials
# Rebranded from bare-ERP — $(date -Iseconds)
# KEEP SECURE
ADMIN_EMAIL=admin@bare-table.com
ADMIN_PASSWORD=${ADMIN_PASSWORD}
WORKSPACE_ID=${WS_ID}
BARE_TABLE_API_TOKEN=${API_TOKEN}
BASE_API_URL=http://100.64.0.19/api/database/rows/table
CREDS
chmod 600 /home/bare-ai/bare-ai-workspace/credentials/bare-table-deploy.env
echo "Credentials saved."

echo "=== Cleaning up bare-erp ==="
rm -rf /home/bare-ai/bare-erp
echo "~/bare-erp removed"

echo "=== Removing orphaned bare-erp volumes ==="
sudo docker volume ls | grep bare-erp || echo "No bare-erp volumes found"
sudo docker volume ls -q | grep bare-erp | xargs -r sudo docker volume rm || echo "None to remove"
echo "=== Remaining volumes ==="
sudo docker volume ls | grep bare

echo "=== Docker compose status ==="
cd /home/bare-ai/bare-table && sudo docker compose ps

echo "=== CREDENTIALS_FOR_REPORT ==="
echo "ADMIN_PASSWORD=${ADMIN_PASSWORD}"
echo "WS_ID=${WS_ID}"
echo "API_TOKEN=${API_TOKEN}"
