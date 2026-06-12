#!/usr/bin/env python3
"""Apply all 4 fixes to TSK000000009c"""
import json,subprocess,time
NIFI='https://localhost:8443/nifi-api'
with open('/tmp/nifi_jwt.txt') as f: TOKEN=f.read().strip()
def g(p):
    r=subprocess.run(['curl','-sk','-H','Authorization: Bearer '+TOKEN,NIFI+p],capture_output=True,text=True)
    return json.loads(r.stdout)
def put(p,b):
    r=subprocess.run(['curl','-sk','-X','PUT','-H','Authorization: Bearer '+TOKEN,'-H','Content-Type: application/json','-d',json.dumps(b),NIFI+p],capture_output=True,text=True)
    return json.loads(r.stdout)

fixes=[
('175b6183-adeb-32a6-6ef4-4359da13fe5b','Build Next Page URL',{'invoke.http.url':'${pagination.next.url}'}),
('6deb4bcd-d843-3dae-7ba3-6e1e60ebe6ee','Batch Waiter',{'release-signal-id':'${taskGuid}','signal-counter-name':'${taskGuid}.pages_complete'}),
('48949360-db51-31cb-08b2-ad04129ff5d2','Main Notify',{'release-signal-id':'${taskGuid}','signal-counter-name':'${taskGuid}.pages_complete'}),
('03c2e7e5-952e-31b8-c9bd-bf0428109970','GenerateFlowFile',{'api.param.size_name.value':'200'}),
]

for pid,name,upd in fixes:
    p=g('/processors/'+pid)
    put('/processors/'+pid,{'revision':p['revision'],'component':{'id':pid,'state':'STOPPED'}})
    time.sleep(0.3)
    p=g('/processors/'+pid)
    pr=p['component']['config']['properties']
    for k in upd:
        old=pr.get(k,'?')
        print(name+': '+k+' = '+str(old)[:70])
    for k,v in upd.items(): pr[k]=v
    r=put('/processors/'+pid,{'revision':p['revision'],'component':{'id':pid,'config':{'properties':pr}}})
    np=r.get('component',{}).get('config',{}).get('properties',{})
    for k in upd:
        nv=np.get(k,'?')
        print('  -> '+str(nv)[:70]+' ['+('OK' if nv==upd[k] else 'FAIL')+']')
    p=g('/processors/'+pid)
    put('/processors/'+pid,{'revision':p['revision'],'component':{'id':pid,'state':'RUNNING'}})
    print()
print('TSK000000009c: ALL 4 FIXES DONE')
