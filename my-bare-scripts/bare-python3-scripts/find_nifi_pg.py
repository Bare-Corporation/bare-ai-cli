#!/usr/bin/env python3
import urllib.request, ssl, json, sys

TOKEN = sys.argv[1]
TARGET = sys.argv[2] if len(sys.argv) > 2 else "Fire Next Integration"
BASE = "https://localhost:8443/nifi-api"

ctx = ssl.create_default_context()
ctx.check_hostname = False
ctx.verify_mode = ssl.CERT_NONE

def api_get(path):
    req = urllib.request.Request(BASE + path)
    req.add_header("Authorization", "Bearer " + TOKEN)
    try:
        with urllib.request.urlopen(req, context=ctx, timeout=30) as resp:
            return json.loads(resp.read().decode())
    except Exception as e:
        return None

def search_pg(pg_id, pg_name, depth=0):
    if TARGET.lower() in pg_name.lower():
        print("FOUND: " + pg_name + " | ID: " + pg_id)
        return pg_id
    data = api_get("/flow/process-groups/" + pg_id)
    if not data:
        return None
    pgs = data.get('processGroupFlow', {}).get('flow', {}).get('processGroups', [])
    for pg in pgs:
        name = pg.get('component', {}).get('name', '')
        cid = pg.get('id', '')
        result = search_pg(cid, name, depth + 1)
        if result:
            return result
    return None

print("Searching for: " + TARGET)
root = api_get("/flow/process-groups/root")
if not root:
    print("FAIL")
    sys.exit(1)

for pg in root.get('processGroupFlow', {}).get('flow', {}).get('processGroups', []):
    name = pg.get('component', {}).get('name', '')
    cid = pg.get('id', '')
    result = search_pg(cid, name, 1)
    if result:
        sys.exit(0)
print("NOT FOUND: " + TARGET)
