#!/usr/bin/env python3
"""Deep dive into Wait/Notify mechanism - no f-string newlines"""
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

sep = "=" * 60

# ---------- 1. Master group connections ----------
print(sep)
print("DELTA WAIT NOTIFY MASTER - ALL CONNECTIONS")
print(sep)
dw = api_get('/flow/process-groups/665bd5fa-563c-386b-2bc0-bdb663e3a9ab')
conns = dw.get('processGroupFlow', {}).get('flow', {}).get('connections', [])
for c in conns:
    src = c.get('component', {}).get('source', {}).get('name', '?')
    dst = c.get('component', {}).get('destination', {}).get('name', '?')
    rels = c.get('component', {}).get('selectedRelationships', [])
    print("  " + src + " -> [" + ",".join(rels) + "] -> " + dst)

iports = dw.get('processGroupFlow', {}).get('flow', {}).get('inputPorts', [])
oports = dw.get('processGroupFlow', {}).get('flow', {}).get('outputPorts', [])
print()
print("Input Ports:", [(p.get('component',{}).get('name','?'), p.get('id','?')) for p in iports])
print("Output Ports:", [(p.get('component',{}).get('name','?'), p.get('id','?')) for p in oports])

# ---------- 2. Initalise Wait ----------
print()
print(sep)
print("FULL: Initalise WaitNotifyProcess (c5857f73)")
print(sep)
iw = api_get('/processors/c5857f73-dccb-316a-4c8e-ca1ce192a27d')
pc = iw.get('component', {})
pconfig = pc.get('config', {})
props = pconfig.get('properties', {})
print("  State:", pc.get('state', '?'))
print("  Scheduling:", pconfig.get('schedulingStrategy', '?'))
print("  Run Schedule:", pconfig.get('schedulingPeriod', '?'))
for k, v in props.items():
    print("  " + k + ": " + str(v))

# ---------- 3. GenerateFlowFile ----------
print()
print(sep)
print("FULL: BaseRowDataAPIProcess - Initialise Task (2ce14709)")
print(sep)
gf = api_get('/processors/2ce14709-b2e8-3f74-df8c-89d182b7c598')
pc2 = gf.get('component', {})
pconfig2 = pc2.get('config', {})
props2 = pconfig2.get('properties', {})
print("  State:", pc2.get('state', '?'))
print("  Scheduling:", pconfig2.get('schedulingStrategy', '?'))
print("  Run Schedule:", pconfig2.get('schedulingPeriod', '?'))
print("  Concurrent Tasks:", pconfig2.get('concurrentlySchedulableTaskCount', '?'))
for k, v in props2.items():
    print("  " + k + ": " + str(v))

# ---------- 4. Batch Waiter ----------
print()
print(sep)
print("FULL: Batch Waiter (4687b8b5)")
print(sep)
bw = api_get('/processors/4687b8b5-fcbe-3282-213a-e5d721727c3b')
pc3 = bw.get('component', {})
pconfig3 = pc3.get('config', {})
props3 = pconfig3.get('properties', {})
print("  State:", pc3.get('state', '?'))
for k, v in props3.items():
    print("  " + k + ": " + str(v))

# ---------- 5. PaginationProcess Notify Main Gate ----------
print()
print(sep)
print("FULL: PaginationProcess Notify Main Gate (9e950169)")
print(sep)
pn = api_get('/processors/9e950169-846c-3a46-2942-fcb1c5975c8b')
pc4 = pn.get('component', {})
pconfig4 = pc4.get('config', {})
props4 = pconfig4.get('properties', {})
print("  State:", pc4.get('state', '?'))
for k, v in props4.items():
    print("  " + k + ": " + str(v))

# ---------- 6. Main group Notify Main Gate ----------
print()
print(sep)
print("FULL: Main Group Notify Main Gate (486778cb)")
print(sep)
mn = api_get('/processors/486778cb-a12a-34c6-b6e4-2de44273c08a')
pc5 = mn.get('component', {})
pconfig5 = pc5.get('config', {})
props5 = pconfig5.get('properties', {})
print("  State:", pc5.get('state', '?'))
for k, v in props5.items():
    print("  " + k + ": " + str(v))

# ---------- 7. Main group notify/split connections ----------
print()
print(sep)
print("MAIN GROUP - NOTIFY/SPLIT CONNECTIONS")
print(sep)
mg = api_get('/flow/process-groups/8eee8d34-b6f7-35cc-b985-c9c6e0a0c95e')
mg_conns = mg.get('processGroupFlow', {}).get('flow', {}).get('connections', [])
for c in mg_conns:
    src = c.get('component', {}).get('source', {}).get('name', '?')
    dst = c.get('component', {}).get('destination', {}).get('name', '?')
    rels = c.get('component', {}).get('selectedRelationships', [])
    if 'Notify' in src or 'Notify' in dst or 'Wait' in src or 'Wait' in dst or 'Split' in src:
        print("  " + src + " -> [" + ",".join(rels) + "] -> " + dst)

# ---------- 8. Check current size value ----------
print()
print(sep)
print("CURRENT SIZE VALUE CHECK")
print(sep)
gf2 = api_get('/processors/2ce14709-b2e8-3f74-df8c-89d182b7c598')
cur_size = gf2.get('component', {}).get('config', {}).get('properties', {}).get('api.param.size_name.value', '?')
print("  api.param.size_name.value =", cur_size)

print()
print("Done.")
