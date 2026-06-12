#!/usr/bin/env python3
"""Bare-AI: NiFi Template Reconnaissance & Cloning Engine"""
import json, subprocess, sys, os

TOKEN = open('/tmp/nifi_jwt.txt').read().strip()
NIFI = 'https://localhost:8443/nifi-api'

def api(method, path, data=None):
    cmd = ['curl', '-sk', '-X', method, '-H', f'Authorization: Bearer {TOKEN}']
    if data:
        cmd += ['-H', 'Content-Type: application/json', '-d', json.dumps(data)]
    cmd.append(NIFI + path)
    r = subprocess.run(cmd, capture_output=True, text=True)
    try:
        return json.loads(r.stdout) if r.stdout.strip() else {}
    except:
        return {'_raw': r.stdout[:200], '_code': r.returncode}

# ============================================================
# PART 1: LIST ALL TEMPLATES
# ============================================================
print("=" * 80)
print("PART 1: ALL TEMPLATES")
print("=" * 80)
templates_resp = api('GET', '/flow/templates')
templates = templates_resp.get('templates', [])
for t in templates:
    tid = t.get('id', '?')
    name = t.get('name', '?')
    desc = t.get('description', '')[:100]
    print(f"  ID: {tid}")
    print(f"  Name: {name}")
    print(f"  Desc: {desc}")
    print()

# ============================================================
# PART 2: INSPECT TEMPLATE PROCESS GROUP
# ============================================================
TEMPLATE_PG_ID = '2012c87c-00f1-3682-c267-94f5a48466d9'
print("=" * 80)
print(f"PART 2: TEMPLATE PG: {TEMPLATE_PG_ID}")
print("=" * 80)

# Get the template flow
for t in templates:
    if t['id'] == TEMPLATE_PG_ID:
        print(f"  Name: {t.get('name')}")
        print(f"  Desc: {t.get('description', 'N/A')[:200]}")
        print()

# Get template details via /templates/{id}
tmpl_detail = api('GET', f'/templates/{TEMPLATE_PG_ID}')
if '_raw' not in tmpl_detail:
    print(f"  Template details keys: {list(tmpl_detail.keys())}")
    snippet = tmpl_detail.get('template', {}).get('snippet', {})
    if not snippet:
        snippet = tmpl_detail.get('snippet', {})
    print(f"  Snippet keys: {list(snippet.keys())}")
    
    # List processors in template
    procs = snippet.get('processors', [])
    print(f"
  Processors in template ({len(procs)}):")
    for p in procs:
        pid = p.get('id', '?')
        pname = p.get('name', '?')
        ptype = p.get('type', '?')
        print(f"    [{pid}] {pname} -> {ptype}")
    
    # List process groups in template
    pgs = snippet.get('processGroups', [])
    print(f"
  Child Process Groups ({len(pgs)}):")
    for pg in pgs:
        pgid = pg.get('id', '?')
        pgname = pg.get('name', '?')
        print(f"    [{pgid}] {pgname}")
    
    # List connections
    conns = snippet.get('connections', [])
    print(f"
  Connections ({len(conns)}):")
    for c in conns:
        cid = c.get('id', '?')
        cname = c.get('name', '?')
        src = c.get('source', {}).get('id', '?')
        dst = c.get('destination', {}).get('id', '?')
        rels = c.get('selectedRelationships', [])
        print(f"    [{cid}] {cname}: {src} -> {dst} [{','.join(rels)}]")
    
    # List input/output ports
    in_ports = snippet.get('inputPorts', [])
    out_ports = snippet.get('outputPorts', [])
    print(f"
  Input Ports: {[(p.get('id','?'), p.get('name','?')) for p in in_ports]}")
    print(f"  Output Ports: {[(p.get('id','?'), p.get('name','?')) for p in out_ports]}")

# ============================================================
# PART 3: INSPECT APP 1 PG (3bfb629f-c614-3cfa-ad93-34e9d6d2ad65)
# ============================================================
APP1_PG_ID = '3bfb629f-c614-3cfa-ad93-34e9d6d2ad65'
APP1_GFF_ID = '735a1019-b1c9-3850-7c36-18d93e879a7f'
print()
print("=" * 80)
print(f"PART 3: APP 1 PG: {APP1_PG_ID}")
print(f"  GenerateFlowFile: {APP1_GFF_ID}")
print("=" * 80)

app1_flow = api('GET', f'/flow/process-groups/{APP1_PG_ID}')
app1_flow_data = app1_flow.get('processGroupFlow', {}).get('flow', {})

# Get all processors
for p in app1_flow_data.get('processors', []):
    pid = p.get('id', '?')
    comp = p.get('component', {})
    name = comp.get('name', '?')
    ptype = comp.get('type', '?')
    state = comp.get('state', '?')
    if pid == APP1_GFF_ID:
        print(f"
  *** TARGET: GenerateFlowFile ***")
        print(f"  Name: {name}")
        print(f"  Type: {ptype}")
        print(f"  State: {state}")
        props = comp.get('properties', {})
        print(f"  --- All Properties ---")
        for k, v in sorted(props.items()):
            print(f"    {k}: {v}")
        desc = comp.get('config', {}).get('descriptors', {})
        print(f"  --- Descriptors ---")
        for k in sorted(desc.keys()):
            print(f"    {k}")
    else:
        print(f"  [{pid[:16]}...] {name} [{state}] -> {ptype}")

# ============================================================
# PART 4: INSPECT APP 2 PG (70572fed-9cc8-3b2d-2b79-67cf71d52786)
# ============================================================
APP2_PG_ID = '70572fed-9cc8-3b2d-2b79-67cf71d52786'
APP2_GFF_ID = '7724a15d-0b22-3dec-c630-03893124f53e'
print()
print("=" * 80)
print(f"PART 4: APP 2 PG: {APP2_PG_ID}")
print(f"  GenerateFlowFile: {APP2_GFF_ID}")
print("=" * 80)

app2_flow = api('GET', f'/flow/process-groups/{APP2_PG_ID}')
app2_flow_data = app2_flow.get('processGroupFlow', {}).get('flow', {})

for p in app2_flow_data.get('processors', []):
    pid = p.get('id', '?')
    comp = p.get('component', {})
    name = comp.get('name', '?')
    ptype = comp.get('type', '?')
    state = comp.get('state', '?')
    if pid == APP2_GFF_ID:
        print(f"
  *** TARGET: GenerateFlowFile ***")
        print(f"  Name: {name}")
        print(f"  Type: {ptype}")
        print(f"  State: {state}")
        props = comp.get('properties', {})
        print(f"  --- All Properties ---")
        for k, v in sorted(props.items()):
            print(f"    {k}: {v}")
        desc = comp.get('config', {}).get('descriptors', {})
        print(f"  --- Descriptors ---")
        for k in sorted(desc.keys()):
            print(f"    {k}")
    else:
        print(f"  [{pid[:16]}...] {name} [{state}] -> {ptype}")

# ============================================================
# PART 5: LIST ROOT PROCESS GROUPS (find where to instantiate)
# ============================================================
print()
print("=" * 80)
print("PART 5: ROOT PROCESS GROUPS")
print("=" * 80)
root = api('GET', '/flow/process-groups/root')
pg_flow = root.get('processGroupFlow', {}).get('flow', {})
for pg in pg_flow.get('processGroups', []):
    pgid = pg.get('id', '?')
    comp = pg.get('component', {})
    name = comp.get('name', '?')
    print(f"  [{pgid}] {name}")

print()
print("=" * 80)
print("RECONNAISSANCE COMPLETE")
print("=" * 80)
