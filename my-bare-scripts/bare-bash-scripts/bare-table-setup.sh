#!/bin/bash
# Bare-Table admin account & API token setup
set -e

# Generate admin password
ADMIN_PASSWORD=$(openssl rand -base64 16 | tr -d '/')
echo "New admin password: ${ADMIN_PASSWORD}"

# Create admin user
echo "=== Creating admin user ==="
CREATE_RESP=$(curl -s -X POST http://100.64.0.19/api/user/ -H "Content-Type: application/json" -d "{"name":"bare-AI Admin","email":"***REMOVED***","password":"${ADMIN_PASSWORD}","authenticate":true}")
echo "$CREATE_RESP" | python3 -m json.tool

# Get JWT token
echo "=== Getting JWT ==="
JWT=$(curl -s -X POST http://100.64.0.19/api/user/token-auth/ -H "Content-Type: application/json" -d "{"email":"***REMOVED***","password":"${ADMIN_PASSWORD}"}" | python3 -c "import sys,json; print(json.load(sys.stdin)['token'])")
echo "JWT: ${JWT:0:30}..."

# Disable open signups
echo "=== Disabling open signups ==="
curl -s -X PATCH http://100.64.0.19/api/settings/update/ -H "Authorization: JWT ${JWT}" -H "Content-Type: application/json" -d '{"allow_new_signups": false}' | python3 -m json.tool

# Create workspace
echo "=== Creating workspace ==="
WS=$(curl -s -X POST http://100.64.0.19/api/workspaces/ -H "Authorization: JWT ${JWT}" -H "Content-Type: application/json" -d '{"name":"Bare-Table Workspace"}')
echo "$WS" | python3 -m json.tool
WS_ID=$(echo "$WS" | python3 -c "import sys,json; print(json.load(sys.stdin)['id'])")
echo "Workspace ID: ${WS_ID}"

# Create API token
echo "=== Creating API token ==="
TOKEN_RESP=$(curl -s -X POST http://100.64.0.19/api/database/tokens/ -H "Authorization: JWT ${JWT}" -H "Content-Type: application/json" -d "{"name":"bare-ConnectFi Integration Token","workspace":${WS_ID}}")
echo "$TOKEN_RESP" | python3 -m json.tool
API_TOKEN=$(echo "$TOKEN_RESP" | python3 -c "import sys,json; print(json.load(sys.stdin)['key'])")
echo "API Token: ${API_TOKEN}"

# Output for credential file
echo "=== CREDENTIALS ==="
echo "ADMIN_PASSWORD=${ADMIN_PASSWORD}"
echo "WS_ID=${WS_ID}"
echo "API_TOKEN=${API_TOKEN}"
