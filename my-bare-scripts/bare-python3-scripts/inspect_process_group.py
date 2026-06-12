#!/usr/bin/env python3
"""Inspect NiFi process group 8eee8d34-b6f7-35cc-b985-c9c6e0a0c95e"""
import json, subprocess, sys, os

NIFI = 'https://localhost:8443/nifi-api'
PG_ID = '8eee8d34-b6f7-35cc-b985-c9c6e0a0c95e'

def get_token():
    cache_paths = ['/tmp/nifi_jwt.txt',
                   '/home/bare-ai/bare-ai-cli/nifi_token.txt',
                   '/home/bare-ai/bare-connectfi/.nifi_token']
    for p in cache_paths:
        if os.path.exists(p):
            with open(p) as f:
                token = f.read().strip()
            if len(token) > 50:
                return token
    return None

def api_get(path):
    token = get_token()
    if not token:
        print("ERROR: No valid token found")
        sys.exit(1)
    url = NIFI + path
    cmd = ['curl', '-sk', '-H', 'Authorization: Bearer ' + token, url]
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode != 0:
        print("ERROR: curl failed with", r.returncode)
        print(r.stderr)
        return None
    try:
        return json.loads(r.stdout)
    except json.JSONDecodeError:
        if 'The supplied' in r.stdout or 'Unauthorized' in r.stdout:
            print("ERROR: Token expired or invalid")
            print(r.stdout[:200])
        else:
            print("JSON parse error. Raw:", r.stdout[:500])
        return None

print("=" * 60)
print("PROCESS GROUP DETAILS")
print("=" * 60)
pg = api_get('/flow/process-groups/' + PG_ID)
if not pg:
    print("Failed to get process group")
    sys.exit(1)

comp = pg.get('processGroupFlow', {}).get('flow', {})
breadcrumb = pg.get('processGroupFlow', {}).get('breadcrumb', {})
name = breadcrumb.get('breadcrumb', {}).get('name', 'Unknown')
print("Name:", name)
print("ID:", PG_ID)

processors = comp.get('processors', [])
print()
print("Processors:", len(processors))
for p in processors:
    pid = p.get('id', '?')
    pname = p.get('component', {}).get('name', '?')
    ptype = p.get('component', {}).get('type', '?')
    print()
    print("  [" + pid + "] " + pname)
    print("    Type:", ptype)
    print("    State:", p.get('status', {}).get('runStatus', '?'))

cs_list = comp.get('controllerServices', [])
print()
print("Controller Services:", len(cs_list))
for cs in cs_list:
    csid = cs.get('id', '?')
    csname = cs.get('component', {}).get('name', '?')
    cstype = cs.get('component', {}).get('type', '?')
    print("  [" + csid + "] " + csname + " (" + cstype + ")")

iports = comp.get('inputPorts', [])
oports = comp.get('outputPorts', [])
print()
print("Input Ports:", len(iports), ", Output Ports:", len(oports))

child_pgs = comp.get('processGroups', [])
print()
print("Child Process Groups:", len(child_pgs))
for cpg in child_pgs:
    cpgid = cpg.get('id', '?')
    cpgname = cpg.get('component', {}).get('name', '?')
    print("  [" + cpgid + "] " + cpgname)

connections = comp.get('connections', [])
print()
print("Connections:", len(connections))

funnels = comp.get('funnels', [])
print()
print("Funnels:", len(funnels))

variables = comp.get('variables', {})
if variables:
    print()
    print("Variables:", json.dumps(variables, indent=2))

print()
print("=" * 60)
print("PROCESSOR DETAILS (deep dive)")
print("=" * 60)

for p in processors:
    pid = p.get('id', '?')
    p_detail = api_get('/processors/' + pid)
    if p_detail:
        pc = p_detail.get('component', {})
        pconfig = pc.get('config', {})
        props = pconfig.get('properties', {})
        print()
        print("--- Processor:", pc.get('name', '?'), "---")
        print("  ID:", pid)
        print("  Type:", pc.get('type', '?'))
        print("  State:", pc.get('state', '?'))
        print("  Properties:")
        for k, v in props.items():
            val = str(v)[:200]
            print("    " + k + ": " + val)
        sched = pconfig.get('schedulingStrategy', '?')
        print("  Scheduling:", sched)
        run_sched = pconfig.get('schedulingPeriod', '?')
        print("  Run Schedule:", run_sched)
        conc = pconfig.get('concurrentlySchedulableTaskCount', '?')
        print("  Concurrent Tasks:", conc)
        bull = pconfig.get('bulletinLevel', '?')
        print("  Bulletin Level:", bull)

print()
print("=" * 60)
print("CONNECTIONS & BACKPRESSURE")
print("=" * 60)

pg2 = api_get('/flow/process-groups/' + PG_ID)
if pg2:
    comp2 = pg2.get('processGroupFlow', {}).get('flow', {})
    connections2 = comp2.get('connections', [])
    for conn in connections2:
        cid = conn.get('id', '?')
        cname = conn.get('component', {}).get('name', '?')
        cstatus = conn.get('status', {})
        aggregate = cstatus.get('aggregateSnapshot', {})
        bp_data_size = aggregate.get('percentUseBytes', '?')
        bp_count = aggregate.get('percentUseCount', '?')
        source = conn.get('component', {}).get('source', {}).get('name', '?')
        dest = conn.get('component', {}).get('destination', {}).get('name', '?')
        selected_rel = conn.get('component', {}).get('selectedRelationships', [])
        flowfile_exp = conn.get('component', {}).get('flowFileExpiration', '?')
        backpressure_obj_thresh = conn.get('component', {}).get('backPressureObjectThreshold', '?')
        backpressure_data_thresh = conn.get('component', {}).get('backPressureDataSizeThreshold', '?')
        print()
        print("  [" + cid + "] " + source + " -> " + dest)
        print("    Name:", cname)
        print("    Relationships:", selected_rel)
        print("    Backpressure objects:", backpressure_obj_thresh)
        print("    Backpressure data size:", backpressure_data_thresh)
        print("    FlowFile expiration:", flowfile_exp)
        print("    Current usage:", bp_count, "% count,", bp_data_size, "% bytes")

print()
print("Done.")
