#!/usr/bin/env python3
"""Apply all 4 fixes to process group d93427a9 (TSK000000008d)"""
import json, subprocess, time

NIFI='https://localhost:8443/nifi-api'
with open('/tmp/nifi_jwt.txt') as f: TOKEN=f.read().strip()
def g(path):
    r=subprocess.run(['curl','-sk','-H','Authorization: Bearer '+TOKEN, NIFI+path],capture_output=True,text=True)
    return json.loads(r.stdout)
def put(path,body):
    r=subprocess.run(['curl','-sk','-X','PUT','-H','Authorization: Bearer '+TOKEN,'-H','Content-Type: application/json','-d',json.dumps(body), NIFI+path],capture_output=True,text=True)
    return json.loads(r.stdout)

fixes = [
    # (processor_id, name, property_updates_dict)
    ('87d216cd-0f89-3aea-8c9c-8304db037061', 'Build Next Page URL', {
        'invoke.http.url': '${pagination.next.url}'
    }),
    ('f8bddb24-dc66-38df-c283-126e1a37834d', 'Batch Waiter', {
        'release-signal-id': '${taskGuid}',
        'signal-counter-name': '${taskGuid}.pages_complete'
    }),
    ('f7d16f93-06cf-3a65-90ac-232efec944a4', 'Main Group Notify', {
        'release-signal-id': '${taskGuid}',
        'signal-counter-name': '${taskGuid}.pages_complete'
    }),
    ('11479ebd-b2bc-3efa-80b6-fb811f9fea85', 'GenerateFlowFile', {
        'api.param.size_name.value': '200'
    }),
]

for pid, name, updates in fixes:
    # Stop
    proc=g('/processors/'+pid)
    rev=proc['revision']
    put('/processors/'+pid,{'revision':rev,'component':{'id':pid,'state':'STOPPED'}})
    time.sleep(0.5)
    
    # Get fresh revision
    proc=g('/processors/'+pid)
    rev=proc['revision']
    props=proc['component']['config']['properties']
    
    # Show old values
    for k in updates:
        old=props.get(k,'?')
        print(name+': '+k+' = '+str(old)[:80])
    
    # Apply updates
    for k,v in updates.items():
        props[k]=v
    
    result=put('/processors/'+pid,{'revision':rev,'component':{'id':pid,'config':{'properties':props}}})
    
    # Show new values
    new_props=result.get('component',{}).get('config',{}).get('properties',{})
    for k in updates:
        new_val=new_props.get(k,'?')
        ok='OK' if new_val==updates[k] else 'FAIL'
        print('  -> '+k+' = '+str(new_val)[:80]+' ['+ok+']')
    
    # Start
    proc=g('/processors/'+pid)
    rev=proc['revision']
    put('/processors/'+pid,{'revision':rev,'component':{'id':pid,'state':'RUNNING'}})
    print()

print('ALL 4 FIXES APPLIED to TSK000000008d')
print('  1. Build Next Page URL: removed http->https upgrade')
print('  2. Batch Waiter: filename -> taskGuid')
print('  3. Main Group Notify: filename -> taskGuid')  
print('  4. Page size: 100 -> 200')
