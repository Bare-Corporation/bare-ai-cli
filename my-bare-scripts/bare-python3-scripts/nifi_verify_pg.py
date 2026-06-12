#!/usr/bin/env python3
import json, subprocess

TOKEN = open('/tmp/nifi_jwt.txt').read().strip()
NIFI = 'https://localhost:8443/nifi-api'

def api(path):
    cmd = ['curl', '-sk', '-H', 'Authorization: Bearer ' + TOKEN, NIFI + path]
    r = subprocess.run(cmd, capture_output=True, text=True)
    try:
        return json.loads(r.stdout) if r.stdout.strip() else {}
    except:
        return {'raw': r.stdout[:200], 'rc': r.returncode}

# Check root
print('=== ROOT PROCESS GROUP ===')
root = api('/flow/process-groups/root')
pgf = root.get('processGroupFlow', {})
pg = pgf.get('processGroup', {})
flow = pgf.get('flow', {})
print('Root PG ID:', pg.get('id'))
print('Root PG Name:', pg.get('component', {}).get('name'))
pgs = flow.get('processGroups', [])
print('Sub-PGs:', len(pgs))
for p in pgs:
    c = p.get('component', {})
    print('  ID:', p['id'], 'Name:', c.get('name'))

# Check target sub-PG
print()
print('=== TARGET SUB-PG 050150dc ===')
tgt = api('/process-groups/050150dc-43f9-3354-8801-0b065971999a')
if 'component' in tgt:
    c = tgt['component']
    print('EXISTS - Name:', c.get('name'), 'Parent:', c.get('parentGroupId'))
    # Get its flow
    tgt_flow = api('/flow/process-groups/050150dc-43f9-3354-8801-0b065971999a')
    tf = tgt_flow.get('processGroupFlow', {}).get('flow', {})
    print('Processors:', len(tf.get('processors', [])))
    print('Connections:', len(tf.get('connections', [])))
    for p in tf.get('processors', []):
        comp = p.get('component', {})
        print('  PROC:', comp.get('name'), '| State:', comp.get('state'), '| Type:', comp.get('type', '')[:60])
else:
    print('NOT FOUND:', str(tgt)[:300])

# Check parent PG 52bb60da
print()
print('=== PARENT PG 52bb60da ===')
par = api('/flow/process-groups/52bb60da-14f3-3791-64d7-ad20ca0e294f')
ppgf = par.get('processGroupFlow', {})
ppg = ppgf.get('processGroup', {})
pflow = ppgf.get('flow', {})
print('PG ID:', ppg.get('id'))
print('PG Name:', ppg.get('component', {}).get('name'))
spgs = pflow.get('processGroups', [])
print('Sub-PGs:', len(spgs))
for p in spgs:
    c = p.get('component', {})
    print('  ID:', p['id'], 'Name:', c.get('name'))
