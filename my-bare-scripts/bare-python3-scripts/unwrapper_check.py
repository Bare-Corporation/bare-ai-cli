#!/usr/bin/env python3
"""Get the Unwrapper script and PaginationProcess connections"""
import json, subprocess, os

NIFI = 'https://localhost:8443/nifi-api'
TOKEN = None
for p in ['/tmp/nifi_jwt.txt', '/home/bare-ai/bare-ai-cli/nifi_token.txt']:
    if os.path.exists(p):
        with open(p) as f:
            TOKEN = f.read().strip()
        break

def api_get(path):
    url = NIFI + path
    cmd = ['curl', '-sk', '-H', 'Authorization: Bearer ' + TOKEN, url]
    r = subprocess.run(cmd, capture_output=True, text=True)
    return json.loads(r.stdout)

# 1. Full Unwrapper script
print("=" * 60)
print("FULL: transform_JsonResponse-for-FirstArrayAsPrimarySplit (9af258d9)")
print("=" * 60)
unw = api_get('/processors/9af258d9-3a15-3398-823a-fca6727e1086')
body = unw.get('component', {}).get('config', {}).get('properties', {}).get('groovyx-script-body', '')
print(body)

# 2. PaginationProcess connections
print()
print("=" * 60)
print("PAGINATION PROCESS - ALL CONNECTIONS")
print("=" * 60)
pg = api_get('/flow/process-groups/86abd36c-6fb9-3ad9-cf20-39b0fa20be76')
conns = pg.get('processGroupFlow', {}).get('flow', {}).get('connections', [])
for c in conns:
    src_name = c.get('component', {}).get('source', {}).get('name', '?')
    dst_name = c.get('component', {}).get('destination', {}).get('name', '?')
    rels = c.get('component', {}).get('selectedRelationships', [])
    print(f"  {src_name} -> [{','.join(rels)}] -> {dst_name}")

print()
print("Done.")
