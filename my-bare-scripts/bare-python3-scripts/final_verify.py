#!/usr/bin/env python3
"""Final verification of the fix"""
import json, subprocess

NIFI='https://localhost:8443/nifi-api'
with open('/tmp/nifi_jwt.txt') as f: TOKEN=f.read().strip()
def g(path):
    r=subprocess.run(['curl','-sk','-H','Authorization: Bearer '+TOKEN, NIFI+path],capture_output=True,text=True)
    return json.loads(r.stdout)

# Verify all 3 changes
bw=g('/processors/4687b8b5-fcbe-3282-213a-e5d721727c3b')
p=bw['component']['config']['properties']
ok1 = 'taskGuid' in p.get('release-signal-id','') and 'taskGuid' in p.get('signal-counter-name','')

mn=g('/processors/486778cb-a12a-34c6-b6e4-2de44273c08a')
p=mn['component']['config']['properties']
ok2 = 'taskGuid' in p.get('release-signal-id','') and 'taskGuid' in p.get('signal-counter-name','')

gf=g('/processors/2ce14709-b2e8-3f74-df8c-89d182b7c598')
p=gf['component']['config']['properties']
ok3 = p.get('api.param.size_name.value')=='200'

print('=' * 50)
print('FINAL VERIFICATION')
print('=' * 50)
print('Batch Waiter signal fix:   ' + ('PASS' if ok1 else 'FAIL'))
print('  release-signal-id: ' + str(p.get('release-signal-id','?'))[:60] if ok1 else '  FAILED')
print('  signal-counter-name: ' + str(p.get('signal-counter-name','?'))[:60] if ok1 else '')
print()
print('Main Notify signal fix:    ' + ('PASS' if ok2 else 'FAIL'))
p=mn['component']['config']['properties']
print('  release-signal-id: ' + p.get('release-signal-id','?')[:60])
print('  signal-counter-name: ' + p.get('signal-counter-name','?')[:60])
print()
print('Page size to 200:          ' + ('PASS' if ok3 else 'FAIL'))
print('  api.param.size_name.value: ' + p.get('api.param.size_name.value','?') if ok3 else '  FAILED')
print()
print('OVERALL: ' + ('ALL 3 FIXES VERIFIED CORRECT' if ok1 and ok2 and ok3 else 'ISSUES DETECTED'))

# Check SSL error history
print()
print('=' * 50)
print('SSL ERROR ANALYSIS')
print('=' * 50)
r=subprocess.run(['grep','-c','InvokeHTTP.*failed','/home/bare-ai/bare-connectfi/nifi-2.3.0/logs/nifi-app.log'],capture_output=True,text=True)
print('InvokeHTTP failures: ' + r.stdout.strip())

# First error timestamp
r=subprocess.run(['grep','InvokeHTTP.*failed','/home/bare-ai/bare-connectfi/nifi-2.3.0/logs/nifi-app.log'],capture_output=True,text=True)
lines=[l for l in r.stdout.splitlines() if l.strip()]
if lines:
    first_ts = lines[0].split(' ERROR')[0].strip() if ' ERROR' in lines[0] else '?'
    last_ts = lines[-1].split(' ERROR')[0].strip() if ' ERROR' in lines[-1] else '?'
    print('First failure: ' + first_ts)
    print('Last failure:  ' + last_ts)
    print('Total failures in log: ' + str(len(lines)))
print()
print('Note: SSL errors are from InvokeHTTP in Bare-IO_v2.1_Invoke_BaseRow group.')
print('These may be pre-existing or related to Baserow API TLS requirements.')
print('The Baserow API itself is reachable (curl test passed, returns 401 without auth).')
