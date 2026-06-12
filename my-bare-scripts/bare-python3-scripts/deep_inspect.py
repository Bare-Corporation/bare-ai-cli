#!/usr/bin/env python3
"""Deep inspect child process groups and Groovy scripts"""
import json, subprocess, sys, os

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

# 1. Get FULL Groovy script body from Dynamic API Request Builder
print("=" * 60)
print("FULL GROOVY SCRIPT: Dynamic API Request Builder (v1.9)")
print("=" * 60)
cc = api_get('/processors/cc0b97fe-d48b-37d6-cd36-419247c63323')
props = cc.get('component', {}).get('config', {}).get('properties', {})
body = props.get('groovyx-script-body', '')
print(body[:10000])
print("... (truncated at 10k chars)" if len(body) > 10000 else "")

# 2. Get PaginationProcess group details
print()
print("=" * 60)
print("PAGINATION PROCESS GROUP")
print("=" * 60)
pp = api_get('/flow/process-groups/86abd36c-6fb9-3ad9-cf20-39b0fa20be76')
comp = pp.get('processGroupFlow', {}).get('flow', {})
processors = comp.get('processors', [])
print("Processors:", len(processors))
for p in processors:
    pid = p.get('id', '?')
    pname = p.get('component', {}).get('name', '?')
    ptype = p.get('component', {}).get('type', '?')
    print()
    print("  [" + pid + "] " + pname)
    print("    Type:", ptype)
    # Get details
    pd = api_get('/processors/' + pid)
    pc = pd.get('component', {})
    pprops = pc.get('config', {}).get('properties', {})
    for k, v in pprops.items():
        if 'script-body' in k or 'page' in k.lower() or 'limit' in k.lower() or 'size' in k.lower() or 'count' in k.lower():
            print("    " + k + ": " + str(v)[:300])

child_pgs = comp.get('processGroups', [])
print()
print("Child Groups:", len(child_pgs))
for cpg in child_pgs:
    print("  [" + cpg.get('id', '?') + "] " + cpg.get('component', {}).get('name', '?'))

# 3. Get DeltaWaitNotifyProcess Master group
print()
print("=" * 60)
print("DELTA WAIT NOTIFY - MASTER PROCESS GROUP")
print("=" * 60)
dw = api_get('/flow/process-groups/665bd5fa-563c-386b-2bc0-bdb663e3a9ab')
comp2 = dw.get('processGroupFlow', {}).get('flow', {})
processors2 = comp2.get('processors', [])
print("Processors:", len(processors2))
for p in processors2:
    pid = p.get('id', '?')
    pname = p.get('component', {}).get('name', '?')
    ptype = p.get('component', {}).get('type', '?')
    print()
    print("  [" + pid + "] " + pname)
    print("    Type:", ptype)
    pd = api_get('/processors/' + pid)
    pc = pd.get('component', {})
    pprops = pc.get('config', {}).get('properties', {})
    for k, v in pprops.items():
        if 'script-body' in k or 'page' in k.lower() or 'limit' in k.lower() or 'size' in k.lower() or 'count' in k.lower() or 'signal' in k.lower():
            print("    " + k + ": " + str(v)[:300])

# Show wait/notify processors
for p in processors2:
    pid = p.get('id', '?')
    ptype = p.get('component', {}).get('type', '?')
    if 'Wait' in ptype or 'Notify' in ptype:
        pname = p.get('component', {}).get('name', '?')
        print()
        print("  [" + pid + "] " + pname + " (" + ptype + ")")
        pd = api_get('/processors/' + pid)
        pc = pd.get('component', {})
        pprops = pc.get('config', {}).get('properties', {})
        for k, v in pprops.items():
            print("    " + k + ": " + str(v)[:300])

print()
print("Done.")
