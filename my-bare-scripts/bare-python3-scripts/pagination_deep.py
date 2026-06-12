#!/usr/bin/env python3
"""Get critical pagination processor details"""
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

# 1. Full Page Calculator script
print("=" * 60)
print("FULL: Page Calculator for Batch Wait (ddde81db)")
print("=" * 60)
pc = api_get('/processors/ddde81db-322a-3d9e-6fe5-86822f06ebfa')
body = pc.get('component', {}).get('config', {}).get('properties', {}).get('groovyx-script-body', '')
print(body)
print()

# 2. Full Pagination Evaluator
print("=" * 60)
print("FULL: Universal Pagination Evaluator (d1480fb7)")
print("=" * 60)
pe = api_get('/processors/d1480fb7-324c-3ec5-04bf-1324ad463555')
body2 = pe.get('component', {}).get('config', {}).get('properties', {}).get('groovyx-script-body', '')
print(body2)
print()

# 3. Build Next Page URL - ALL properties
print("=" * 60)
print("ALL PROPS: Build Next Page URL (d6c08dc8)")
print("=" * 60)
bn = api_get('/processors/d6c08dc8-00bf-3944-a229-6a1fb998584d')
props = bn.get('component', {}).get('config', {}).get('properties', {})
for k, v in props.items():
    print("  " + k + ": " + str(v)[:300])

# 4. Determine Pagination Required Route - ALL props
print()
print("=" * 60)
print("ALL PROPS: Determine Pagination Required Route (887f01cc)")
print("=" * 60)
dr = api_get('/processors/887f01cc-b484-3544-3aff-9fba4a09a953')
props2 = dr.get('component', {}).get('config', {}).get('properties', {})
for k, v in props2.items():
    print("  " + k + ": " + str(v)[:300])

# 5. Determine Pagination Strategy Route - ALL props
print()
print("=" * 60)
print("ALL PROPS: Determine Pagination Strategy Route (720b1cc9)")
print("=" * 60)
ds = api_get('/processors/720b1cc9-63e3-3d27-f465-c8afe5b5b426')
props3 = ds.get('component', {}).get('config', {}).get('properties', {})
for k, v in props3.items():
    print("  " + k + ": " + str(v)[:300])

# 6. BaseRowDataAPIProcess - Initialise Task - ALL properties
print()
print("=" * 60)
print("ALL PROPS: BaseRowDataAPIProcess - Initialise Task (2ce14709)")
print("=" * 60)
init = api_get('/processors/2ce14709-b2e8-3f74-df8c-89d182b7c598')
props4 = init.get('component', {}).get('config', {}).get('properties', {})
for k, v in props4.items():
    if k.startswith('api.') or 'batch' in k.lower() or 'size' in k.lower() or 'page' in k.lower() or 'count' in k.lower():
        print("  " + k + ": " + str(v)[:300])

print()
print("Done.")
