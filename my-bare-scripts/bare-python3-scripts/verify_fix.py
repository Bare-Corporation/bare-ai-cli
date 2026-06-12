#!/usr/bin/env python3
"""Verify the fix: check processor configs, NiFi logs, and cache status"""
import json, subprocess, os, time

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
    try:
        return json.loads(r.stdout)
    except:
        return None

# ===== 1. Verify processor configs =====
print("=" * 60)
print("VERIFICATION 1: Processor Configurations")
print("=" * 60)

# Batch Waiter
bw = api_get('/processors/4687b8b5-fcbe-3282-213a-e5d721727c3b')
if bw:
    p = bw.get('component', {}).get('config', {}).get('properties', {})
    print("Batch Waiter (4687b8b5):")
    print("  release-signal-id:", p.get('release-signal-id', '?'))
    print("  signal-counter-name:", p.get('signal-counter-name', '?'))
    print("  target-signal-count:", p.get('target-signal-count', '?'))

# Main Group Notify
mn = api_get('/processors/486778cb-a12a-34c6-b6e4-2de44273c08a')
if mn:
    p = mn.get('component', {}).get('config', {}).get('properties', {})
    print("Main Group Notify (486778cb):")
    print("  release-signal-id:", p.get('release-signal-id', '?'))
    print("  signal-counter-name:", p.get('signal-counter-name', '?'))
    print("  signal-counter-delta:", p.get('signal-counter-delta', '?'))

# GenerateFlowFile
gf = api_get('/processors/2ce14709-b2e8-3f74-df8c-89d182b7c598')
if gf:
    p = gf.get('component', {}).get('config', {}).get('properties', {})
    print("GenerateFlowFile (2ce14709):")
    print("  api.param.size_name.value:", p.get('api.param.size_name.value', '?'))
    print("  taskGuid:", p.get('taskGuid', '?'))

# ===== 2. Check NiFi logs for recent activity =====
print()
print("=" * 60)
print("VERIFICATION 2: NiFi Log Activity (last 30 lines)")
print("=" * 60)
log_path = '/home/bare-ai/bare-connectfi/nifi-2.3.0/logs/nifi-app.log'
result = subprocess.run(['tail', '-30', log_path], capture_output=True, text=True)
# Filter for relevant lines
for line in result.stdout.split('
'):
    if any(kw in line.lower() for kw in ['taskguid', 'taskid', 'pagination', 'pages_complete', 'notify', 'batch', 'wait', 'tsk000000008c', 'page=', 'size=200', 'dynamic api', 'url generated', 'splitjson', 'mapcache']):
        print("  " + line.strip()[:200])

# ===== 3. Check processor statuses =====
print()
print("=" * 60)
print("VERIFICATION 3: Processor Statuses")
print("=" * 60)
procs = [
    ('486778cb', 'Main Group Notify'),
    ('4687b8b5', 'Batch Waiter'),
    ('2ce14709', 'GenerateFlowFile'),
    ('cc0b97fe', 'API Request Builder'),
    ('e057a56c', 'SplitJson'),
    ('e6ec4cd7', 'PutDistMapCache'),
    ('c5857f73', 'Initalise Wait'),
]
for pid, name in procs:
    proc = api_get(f'/processors/{pid}-a12a-34c6-b6e4-2de44273c08a' if pid == '486778cb' else
                   f'/processors/{pid}-fcbe-3282-213a-e5d721727c3b' if pid == '4687b8b5' else
                   f'/processors/{pid}-b2e8-3f74-df8c-89d182b7c598' if pid == '2ce14709' else
                   f'/processors/{pid}-d48b-37d6-cd36-419247c63323' if pid == 'cc0b97fe' else
                   f'/processors/{pid}-22d7-39c1-95c0-01ef528f23da' if pid == 'e057a56c' else
                   f'/processors/{pid}-a46d-3b5b-aac0-367842a297a9' if pid == 'e6ec4cd7' else
                   f'/processors/{pid}-dccb-316a-4c8e-ca1ce192a27d')
    if proc:
        state = proc.get('component', {}).get('state', '?')
        active = proc.get('status', {}).get('aggregateSnapshot', {}).get('activeThreadCount', '?')
        tasks = proc.get('status', {}).get('aggregateSnapshot', {}).get('tasks', '?')
        print(f"  {name}: {state}, active threads: {active}, tasks: {tasks}")

# ===== 4. Check queue sizes (flow files in connections) =====
print()
print("=" * 60)
print("VERIFICATION 4: Queue Sizes")
print("=" * 60)
pg = api_get('/flow/process-groups/8eee8d34-b6f7-35cc-b985-c9c6e0a0c95e')
if pg:
    conns = pg.get('processGroupFlow', {}).get('flow', {}).get('connections', [])
    for c in conns:
        src = c.get('component', {}).get('source', {}).get('name', '?')
        dst = c.get('component', {}).get('destination', {}).get('name', '?')
        qsize = c.get('status', {}).get('aggregateSnapshot', {}).get('queuedCount', '?')
        qbytes = c.get('status', {}).get('aggregateSnapshot', {}).get('queuedBytes', '?')
        if qsize and qsize != '0' and qsize != 0:
            print(f"  {src} -> {dst}: {qsize} files, {qbytes} bytes")

# ===== 5. Check DistributedMapCache entries =====
print()
print("=" * 60)
print("VERIFICATION 5: Cache Status")
print("=" * 60)
cache_dir = '/home/bare-ai/bare-connectfi/nifi-2.3.0/state/distributed-map-cache'
result = subprocess.run(['find', cache_dir, '-type', 'f'], capture_output=True, text=True)
files = [f for f in result.stdout.strip().split('
') if f]
print(f"  Cache files on disk: {len(files)}")
if files:
    # Show first 5 filenames
    for f in files[:5]:
        print(f"    {f}")

# ===== 6. Check child PG queues too =====
print()
print("=" * 60)
print("VERIFICATION 6: Pagination Process Queue Sizes")
print("=" * 60)
pp = api_get('/flow/process-groups/86abd36c-6fb9-3ad9-cf20-39b0fa20be76')
if pp:
    conns = pp.get('processGroupFlow', {}).get('flow', {}).get('connections', [])
    for c in conns:
        src = c.get('component', {}).get('source', {}).get('name', '?')
        dst = c.get('component', {}).get('destination', {}).get('name', '?')
        qsize = c.get('status', {}).get('aggregateSnapshot', {}).get('queuedCount', '?')
        if qsize and qsize != '0' and qsize != 0:
            print(f"  {src} -> {dst}: {qsize} files")

print()
print("Done.")
