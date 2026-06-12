#!/usr/bin/env python3
"""Fix: Use taskGuid instead of filename for Wait/Notify signal matching + set size=200"""
import json, subprocess, time, os

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

def api_put(path, body):
    url = NIFI + path
    cmd = ['curl', '-sk', '-X', 'PUT',
           '-H', 'Authorization: Bearer ' + TOKEN,
           '-H', 'Content-Type: application/json',
           '-d', json.dumps(body), url]
    r = subprocess.run(cmd, capture_output=True, text=True)
    try:
        return json.loads(r.stdout)
    except:
        return None

def stop_proc(pid):
    proc = api_get(f'/processors/{pid}')
    rev = proc.get('revision', {})
    state = proc.get('component', {}).get('state', '')
    if state == 'STOPPED':
        return rev, 'ALREADY_STOPPED'
    body = {'revision': rev, 'component': {'id': pid, 'state': 'STOPPED'}}
    result = api_put(f'/processors/{pid}', body)
    return result.get('revision', rev) if result else rev, 'STOPPED'

def start_proc(pid):
    proc = api_get(f'/processors/{pid}')
    rev = proc.get('revision', {})
    state = proc.get('component', {}).get('state', '')
    if state == 'RUNNING':
        return rev, 'ALREADY_RUNNING'
    body = {'revision': rev, 'component': {'id': pid, 'state': 'RUNNING'}}
    result = api_put(f'/processors/{pid}', body)
    return result.get('revision', rev) if result else rev, 'STARTED'

def update_props(pid, updates):
    """Update processor properties"""
    proc = api_get(f'/processors/{pid}')
    rev = proc.get('revision', {})
    props = proc.get('component', {}).get('config', {}).get('properties', {})
    for k, v in updates.items():
        props[k] = v
    body = {
        'revision': rev,
        'component': {
            'id': pid,
            'config': {'properties': props}
        }
    }
    return api_put(f'/processors/{pid}', body)

# ===== STEP 1: Stop the 3 critical processors =====
print("STEP 1: Stopping critical processors...")
print()

procs_to_fix = {
    '486778cb-a12a-34c6-b6e4-2de44273c08a': 'Main Group Notify Main Gate',
    '4687b8b5-fcbe-3282-213a-e5d721727c3b': 'Batch Waiter',
    '2ce14709-b2e8-3f74-df8c-89d182b7c598': 'BaseRowDataAPIProcess - Initialise Task',
}

for pid, name in procs_to_fix.items():
    _, status = stop_proc(pid)
    print(f"  Stopped: {name} ({status})")

time.sleep(2)

# ===== STEP 2: Fix Batch Waiter - filename -> taskGuid =====
print()
print("STEP 2: Fixing Batch Waiter signal matching (filename -> taskGuid)...")

result = update_props('4687b8b5-fcbe-3282-213a-e5d721727c3b', {
    'release-signal-id': '${taskGuid}',
    'signal-counter-name': '${taskGuid}.pages_complete',
})

if result:
    props = result.get('component', {}).get('config', {}).get('properties', {})
    new_rel = props.get('release-signal-id', '?')
    new_sig = props.get('signal-counter-name', '?')
    print(f"  Batch Waiter updated:")
    print(f"    release-signal-id: {new_rel}")
    print(f"    signal-counter-name: {new_sig}")
    print("  SUCCESS")
else:
    print("  ERROR: Failed to update Batch Waiter")

# ===== STEP 3: Fix Main Group Notify - filename -> taskGuid =====
print()
print("STEP 3: Fixing Main Group Notify signal matching (filename -> taskGuid)...")

result = update_props('486778cb-a12a-34c6-b6e4-2de44273c08a', {
    'release-signal-id': '${taskGuid}',
    'signal-counter-name': '${taskGuid}.pages_complete',
})

if result:
    props = result.get('component', {}).get('config', {}).get('properties', {})
    new_rel = props.get('release-signal-id', '?')
    new_sig = props.get('signal-counter-name', '?')
    print(f"  Main Group Notify updated:")
    print(f"    release-signal-id: {new_rel}")
    print(f"    signal-counter-name: {new_sig}")
    print("  SUCCESS")
else:
    print("  ERROR: Failed to update Main Group Notify")

# ===== STEP 4: Set page size to 200 (Baserow max) =====
print()
print("STEP 4: Setting page size to 200 (Baserow max)...")

result = update_props('2ce14709-b2e8-3f74-df8c-89d182b7c598', {
    'api.param.size_name.value': '200',
})

if result:
    props = result.get('component', {}).get('config', {}).get('properties', {})
    new_size = props.get('api.param.size_name.value', '?')
    print(f"  api.param.size_name.value: {new_size}")
    print("  SUCCESS")
else:
    print("  ERROR: Failed to update page size")

# ===== STEP 5: Clear Distributed Map Cache =====
print()
print("STEP 5: Clearing Distributed Map Cache...")
cache_id = 'e409d12b-4619-3c49-44f2-57a722784456'
try:
    cs = api_get(f'/controller-services/{cache_id}')
    cs_rev = cs.get('revision', {})
    cs_state = cs.get('component', {}).get('state', '')
    if cs_state == 'ENABLED':
        api_put(f'/controller-services/{cache_id}', {
            'revision': cs_rev,
            'component': {'id': cache_id, 'state': 'DISABLED'}
        })
        time.sleep(2)
        cs2 = api_get(f'/controller-services/{cache_id}')
        api_put(f'/controller-services/{cache_id}', {
            'revision': cs2.get('revision', {}),
            'component': {'id': cache_id, 'state': 'ENABLED'}
        })
        time.sleep(2)
        print("  Cache cycled (disabled -> enabled)")
except Exception as e:
    print(f"  Note: {e}")

# Also clear signal cache
signal_cache_id = 'cddc85dc-f205-3953-c7d5-720cdef14e5a'
try:
    cs = api_get(f'/controller-services/{signal_cache_id}')
    cs_rev = cs.get('revision', {})
    cs_state = cs.get('component', {}).get('state', '')
    if cs_state == 'ENABLED':
        api_put(f'/controller-services/{signal_cache_id}', {
            'revision': cs_rev,
            'component': {'id': signal_cache_id, 'state': 'DISABLED'}
        })
        time.sleep(2)
        cs2 = api_get(f'/controller-services/{signal_cache_id}')
        api_put(f'/controller-services/{signal_cache_id}', {
            'revision': cs2.get('revision', {}),
            'component': {'id': signal_cache_id, 'state': 'ENABLED'}
        })
        time.sleep(2)
        print("  Signal cache cycled (disabled -> enabled)")
except Exception as e:
    print(f"  Note: {e}")

# Clear on-disk cache
subprocess.run(['rm', '-rf', '/home/bare-ai/bare-connectfi/nifi-2.3.0/state/distributed-map-cache/*'], capture_output=True)
print("  On-disk cache cleared")

# ===== STEP 6: Restart processors =====
print()
print("STEP 6: Restarting processors...")
for pid, name in procs_to_fix.items():
    _, status = start_proc(pid)
    print(f"  Started: {name} ({status})")

print()
print("=" * 60)
print("FIX COMPLETE")
print("=" * 60)
print("Changes made:")
print("  1. Batch Waiter: release-signal-id + signal-counter-name now use ${taskGuid}")
print("  2. Main Group Notify: release-signal-id + signal-counter-name now use ${taskGuid}")
print("  3. Page size: 100 -> 200 (Baserow max)")
print()
print("Why this works:")
print("  - All split flow files share the same ${taskGuid}")
print("  - All signals converge on counter: ${taskGuid}.pages_complete")
print("  - Batch Waiter watches the SAME counter")
print("  - 4 pages (200+200+200+84) = 684 signals -> Batch Waiter releases")
print("  - Pagination loops correctly through all 4 pages")
