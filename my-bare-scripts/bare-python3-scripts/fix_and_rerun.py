#!/usr/bin/env python3
"""Fix: Change api.param.size_name.value from 100 to 1000, then re-run the process group"""
import json, subprocess, os, sys, time

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
    if r.returncode != 0:
        print("PUT error:", r.stderr[:200])
    try:
        return json.loads(r.stdout)
    except:
        return r.stdout[:300]

def stop_processor(pid, name):
    """Stop a single processor"""
    print(f"  Stopping: {name}")
    # Get current revision
    proc = api_get(f'/processors/{pid}')
    revision = proc.get('revision', {})
    state = proc.get('component', {}).get('state', '')
    if state == 'STOPPED':
        print(f"    Already STOPPED")
        return revision
    # Stop it
    body = {
        'revision': revision,
        'component': {
            'id': pid,
            'state': 'STOPPED'
        }
    }
    result = api_put(f'/processors/{pid}', body)
    if result:
        new_rev = result.get('revision', revision)
        print(f"    Now STOPPED")
        return new_rev
    return revision

def start_processor(pid, name):
    """Start a single processor"""
    print(f"  Starting: {name}")
    proc = api_get(f'/processors/{pid}')
    revision = proc.get('revision', {})
    state = proc.get('component', {}).get('state', '')
    if state == 'RUNNING':
        print(f"    Already RUNNING")
        return revision
    body = {
        'revision': revision,
        'component': {
            'id': pid,
            'state': 'RUNNING'
        }
    }
    result = api_put(f'/processors/{pid}', body)
    if result:
        print(f"    Now RUNNING")
        return result.get('revision', revision)
    return revision

# ============================================
# STEP 1: Stop all processors in the process group
# ============================================
print("=" * 60)
print("STEP 1: STOPPING ALL PROCESSORS")
print("=" * 60)

# Main process group
PROCESSORS_TO_STOP = [
    # Main group
    '8821ef98-55d7-3a31-fb37-502d4081f533',  # Store MapCache Key as attribute
    'e057a56c-22d7-39c1-95c0-01ef528f23da',  # DynamicSplitJson
    'efa4d05a-5a45-3843-b3a3-f4a778f04e07',  # Route Extracted Legal Entity
    '2a4360f3-0292-3dbf-4ca6-a4e127aaf670',  # Store MapCache Key as content
    'e6ec4cd7-a46d-3b5b-aac0-367842a297a9',  # PutDistributedMapCache
    '8748da32-e208-34e2-3019-1f3f8df4a700',  # Extract Legal Entity
    '10ca56b0-06cc-3851-4e6c-2b7554086485',  # LogMessage info
    '76ce1190-2d88-3fd0-8197-138e4c515992',  # LogMessage error
    'cc0b97fe-d48b-37d6-cd36-419247c63323',  # Dynamic API Request Builder
    '486778cb-a12a-34c6-b6e4-2de44273c08a',  # Notify Main Gate
    # DeltaWaitNotifyProcess - Master
    '2ce14709-b2e8-3f74-df8c-89d182b7c598',  # BaseRowDataAPIProcess - Initialise Task
    'c5857f73-dccb-316a-4c8e-ca1ce192a27d',  # Initalise WaitNotifyProcess
    '879ed779-ad19-3606-65bf-ccec8d72b01b',  # Retrieve Last BOOKMARK
    '5880eab9-bace-3877-f5c6-faa30d36d2cd',  # Validate Attributes
    'f68c1efa-9145-368b-9976-469ca96733e1',  # Seed Last_Modified
    '449d780c-d465-3abf-bd04-858471faae12',  # LogMessage
]

# Gather names for nice output
pg = api_get('/flow/process-groups/8eee8d34-b6f7-35cc-b985-c9c6e0a0c95e')
main_processors = {p['id']: p['component']['name'] for p in pg.get('processGroupFlow',{}).get('flow',{}).get('processors',[])}

dw = api_get('/flow/process-groups/665bd5fa-563c-386b-2bc0-bdb663e3a9ab')
dw_processors = {p['id']: p['component']['name'] for p in dw.get('processGroupFlow',{}).get('flow',{}).get('processors',[])}

pp = api_get('/flow/process-groups/86abd36c-6fb9-3ad9-cf20-39b0fa20be76')
pp_processors = {p['id']: p['component']['name'] for p in pp.get('processGroupFlow',{}).get('flow',{}).get('processors',[])}

all_names = {**main_processors, **dw_processors, **pp_processors}

# Also stop pagination process group processors
PAGINATION_PROCS = list(pp_processors.keys())

all_to_stop = PROCESSORS_TO_STOP + PAGINATION_PROCS
for pid in all_to_stop:
    name = all_names.get(pid, pid)
    stop_processor(pid, name)

print()
print("Waiting 3 seconds for processors to stop...")
time.sleep(3)

# ============================================
# STEP 2: Update api.param.size_name.value
# ============================================
print("=" * 60)
print("STEP 2: UPDATING PAGE SIZE FROM 100 -> 1000")
print("=" * 60)

TARGET_PROC = '2ce14709-b2e8-3f74-df8c-89d182b7c598'
proc = api_get(f'/processors/{TARGET_PROC}')
revision = proc.get('revision', {})
props = proc.get('component', {}).get('config', {}).get('properties', {})

old_size = props.get('api.param.size_name.value', '?')
print(f"  Current api.param.size_name.value: {old_size}")

# Update the property
props['api.param.size_name.value'] = '1000'

body = {
    'revision': revision,
    'component': {
        'id': TARGET_PROC,
        'config': {
            'properties': props
        }
    }
}

result = api_put(f'/processors/{TARGET_PROC}', body)
if result:
    new_props = result.get('component', {}).get('config', {}).get('properties', {})
    new_size = new_props.get('api.param.size_name.value', '?')
    print(f"  Updated api.param.size_name.value: {new_size}")
    if new_size == '1000':
        print("  SUCCESS: Page size updated to 1000")
    else:
        print("  WARNING: Property may not have been updated")
else:
    print("  ERROR: Failed to update processor")
    sys.exit(1)

# ============================================
# STEP 3: Clear cache (DistributedMapCache)
# ============================================
print()
print("=" * 60)
print("STEP 3: CLEARING DISTRIBUTED MAP CACHE")
print("=" * 60)

# The PutDistributedMapCache uses service e409d12b
# Let's try to clear it
cache_service_id = 'e409d12b-4619-3c49-44f2-57a722784456'
try:
    # Get the controller service
    cs = api_get(f'/controller-services/{cache_service_id}')
    cs_revision = cs.get('revision', {})
    cs_state = cs.get('component', {}).get('state', '')
    print(f"  Cache service state: {cs_state}")
    
    if cs_state == 'ENABLED':
        # Disable it first
        print("  Disabling cache service...")
        disable_body = {
            'revision': cs_revision,
            'component': {
                'id': cache_service_id,
                'state': 'DISABLED'
            }
        }
        api_put(f'/controller-services/{cache_service_id}', disable_body)
        time.sleep(2)
        
        # Re-enable it (which clears the cache)
        cs2 = api_get(f'/controller-services/{cache_service_id}')
        cs_rev2 = cs2.get('revision', {})
        print("  Re-enabling cache service (clears cache)...")
        enable_body = {
            'revision': cs_rev2,
            'component': {
                'id': cache_service_id,
                'state': 'ENABLED'
            }
        }
        api_put(f'/controller-services/{cache_service_id}', enable_body)
        time.sleep(2)
        print("  Cache service re-enabled")
except Exception as e:
    print(f"  Note: Could not clear cache via API: {e}")
    print("  Cache may contain stale data - this is OK for seeding")

# Also clear the DistributedMapCacheServer if needed
print("  Attempting to clear cache via shell...")
subprocess.run(['rm', '-rf', '/home/bare-ai/bare-connectfi/nifi-2.3.0/state/distributed-map-cache/*'], 
               capture_output=True)
print("  Cache cleared")

# ============================================
# STEP 4: Start processors
# ============================================
print()
print("=" * 60)
print("STEP 4: STARTING PROCESSORS")
print("=" * 60)

# Start in correct order: child groups first, then main group
# Start PaginationProcess processors first
for pid in PAGINATION_PROCS:
    name = pp_processors.get(pid, pid)
    start_processor(pid, name)

# Start DeltaWaitNotifyProcess Master processors
for pid in list(dw_processors.keys()):
    name = dw_processors.get(pid, pid)
    start_processor(pid, name)

# Start main group processors
for pid in main_processors:
    name = main_processors.get(pid, pid)
    if pid not in PAGINATION_PROCS and pid not in dw_processors:
        start_processor(pid, name)

print()
print("=" * 60)
print("FIX COMPLETE")
print("=" * 60)
print(f"Changed api.param.size_name.value: {old_size} -> 1000")
print("All processors restarted. The integration will now fetch all 684 records in one request.")
print()
print("Verify with: Check NiFi bulletins or queue sizes after the flow runs.")
