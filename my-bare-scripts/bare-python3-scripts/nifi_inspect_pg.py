#!/usr/bin/env python3
import json, subprocess

TOKEN = open('/tmp/nifi_jwt.txt').read().strip()
NIFI = 'https://localhost:8443/nifi-api'
PG_ID = '050150dc-43f9-3354-8801-0b065971999a'

def api(path):
    cmd = ['curl', '-sk', '-H', 'Authorization: Bearer ' + TOKEN, NIFI + path]
    r = subprocess.run(cmd, capture_output=True, text=True)
    try:
        return json.loads(r.stdout) if r.stdout.strip() else {}
    except:
        return {}

SEP = '=' * 90
print(SEP)
print('INSPECTING SUB-PG: ' + PG_ID)
print(SEP)

flow_data = api('/flow/process-groups/' + PG_ID)
flow = flow_data.get('processGroupFlow', {}).get('flow', {})

proc_names = {}
proc_status = {}
for p in flow.get('processors', []):
    pid = p['id']
    comp = p.get('component', {})
    proc_names[pid] = comp.get('name', '?')
    proc_status[pid] = {
        'name': comp.get('name', '?'),
        'state': comp.get('state', '?'),
        'type': comp.get('type', '?'),
        'validation_errors': comp.get('validationErrors', []),
        'properties': comp.get('properties', {})
    }

# PART 1: CONNECTIONS
print()
print(SEP)
print('PART 1: CONNECTIONS (sorted by queued FlowFiles, descending)')
print(SEP)

conns = []
for c in flow.get('connections', []):
    comp = c.get('component', {})
    src_id = comp.get('source', {}).get('id', '?')
    dst_id = comp.get('destination', {}).get('id', '?')
    src_name = proc_names.get(src_id, src_id[:8] + '...')
    dst_name = proc_names.get(dst_id, dst_id[:8] + '...')
    status = c.get('status', {})
    agg = status.get('aggregateSnapshot', {})
    conns.append({
        'id': c['id'],
        'source': src_name,
        'dest': dst_name,
        'dest_id': dst_id,
        'queued_count': int(agg.get('flowFilesQueued', 0)),
        'queued_bytes': int(agg.get('bytesQueued', 0)),
        'input_count': int(agg.get('flowFilesIn', 0)),
        'output_count': int(agg.get('flowFilesOut', 0)),
        'backpressure_pct': int(status.get('percentUseBytes', 0)),
        'name': comp.get('name', '')
    })

conns.sort(key=lambda x: x['queued_count'], reverse=True)

print('Total connections: ' + str(len(conns)))
print()
for i, c in enumerate(conns):
    qb = c['queued_bytes']
    if qb >= 1000000:
        qb_str = '{:.1f} MB'.format(qb/1000000)
    elif qb >= 1000:
        qb_str = '{:.1f} KB'.format(qb/1000)
    else:
        qb_str = str(qb) + ' B'
    
    bp_flag = ''
    if c['backpressure_pct'] > 0:
        bp_flag = '  BACKPRESSURE: {}%'.format(c['backpressure_pct'])
    
    marker = ' <-- BOTTLENECK' if i == 0 and c['queued_count'] > 0 else ''
    print('  #{} Q={:>6} ({:>10}){}{}'.format(i+1, c['queued_count'], qb_str, marker, bp_flag))
    print('      SRC: {}'.format(c['source'][:70]))
    print('      DST: {} (id: {}...)'.format(c['dest'][:70], c['dest_id'][:16]))
    print()

# PART 2: DESTINATION PROCESSOR STATUS
print(SEP)
print('PART 2: DESTINATION PROCESSOR STATUS (for bottleneck connection)')
print(SEP)
if conns and conns[0]['queued_count'] > 0:
    top = conns[0]
    dst_id = top['dest_id']
    dst_info = proc_status.get(dst_id, {})
    dst_processor = api('/processors/' + dst_id)
    dst_comp = dst_processor.get('component', {})
    dst_full_state = dst_comp.get('state', 'UNKNOWN')
    
    print('  Processor: ' + top['dest'])
    print('  ID:        ' + dst_id)
    print('  State:     ' + dst_full_state)
    print('  Type:      ' + dst_info.get('type', '?'))
    if dst_info.get('validation_errors'):
        print('  VALIDATION ERRORS: ' + str(dst_info['validation_errors']))
    if dst_full_state != 'RUNNING':
        print('  *** PROCESSOR IS NOT RUNNING! State = ' + dst_full_state + ' ***')
    else:
        print('  Processor is RUNNING (no obvious state issue)')
else:
    print('  No queued FlowFiles detected.')

# PART 3: NOTIFY PROCESSOR CONFIG
print()
print(SEP)
print('PART 3: NOTIFY PROCESSORS IN SUB-PG (full config)')
print(SEP)
for pid, ps in proc_status.items():
    if 'Notify' in ps.get('type', ''):
        props = ps.get('properties', {})
        print('  Name:   ' + ps['name'])
        print('  ID:     ' + pid)
        print('  State:  ' + ps['state'])
        print('  Type:   ' + ps['type'])
        print('  --- Key Properties ---')
        print('    release-signal-id:      ' + str(props.get('release-signal-id', 'N/A')))
        print('    signal-counter-name:    ' + str(props.get('signal-counter-name', 'N/A')))
        print('    signal-counter-delta:   ' + str(props.get('signal-counter-delta', 'N/A')))
        print('    distributed-cache-service: ' + str(props.get('distributed-cache-service', 'N/A')))
        print('    signal-buffer-count:    ' + str(props.get('signal-buffer-count', 'N/A')))
        print('    attribute-cache-regex:  ' + str(props.get('attribute-cache-regex', 'N/A')))
        print()

# Also WAIT processors
print(SEP)
print('PART 3b: WAIT PROCESSORS IN SUB-PG (full config)')
print(SEP)
for pid, ps in proc_status.items():
    if 'Wait' in ps.get('type', ''):
        props = ps.get('properties', {})
        print('  Name:   ' + ps['name'])
        print('  ID:     ' + pid)
        print('  State:  ' + ps['state'])
        print('  --- Key Properties ---')
        print('    release-signal-id:      ' + str(props.get('release-signal-id', 'N/A')))
        print('    signal-counter-name:    ' + str(props.get('signal-counter-name', 'N/A')))
        print('    target-signal-count:    ' + str(props.get('target-signal-count', 'N/A')))
        print('    distributed-cache-service: ' + str(props.get('distributed-cache-service', 'N/A')))
        print('    expiration-duration:    ' + str(props.get('expiration-duration', 'N/A')))
        print()

# PART 4: BULLETIN BOARD
print(SEP)
print('PART 4: BULLETIN BOARD')
print(SEP)
board = api('/flow/bulletin-board')
bulletins = board.get('bulletinBoard', {}).get('bulletins', [])
pg_frag = '050150dc'
found = 0
for b in bulletins:
    msg = b.get('message', '')
    src_name = b.get('sourceName', '')
    src_id = b.get('sourceId', '')
    level = b.get('level', 'INFO')
    ts = b.get('timestamp', '')
    group_id = b.get('groupId', '')
    
    if level in ('ERROR', 'WARN') or pg_frag in (src_id + group_id):
        found += 1
        print('  [{}] {} | source={}'.format(level, ts[:19], src_name[:55]))
        print('    groupId=' + group_id)
        print('    ' + msg[:250])
        print()

if found == 0:
    print('  No bulletins found matching this PG or with ERROR/WARN level.')
    print('  Total bulletins on board: ' + str(len(bulletins)))

print()
print(SEP)
print('INSPECTION COMPLETE')
print(SEP)
