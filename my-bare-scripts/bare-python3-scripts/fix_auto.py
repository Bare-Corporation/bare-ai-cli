#!/usr/bin/env python3
"""Apply all 4 fixes - auto-discover processors in PG"""
import json,subprocess,time
NIFI='https://localhost:8443/nifi-api'
with open('/tmp/nifi_jwt.txt') as f: TOKEN=f.read().strip()

def g(p):
    r=subprocess.run(['curl','-sk','-H','Authorization: Bearer '+TOKEN,NIFI+p],capture_output=True,text=True)
    return json.loads(r.stdout)
def put(p,b):
    r=subprocess.run(['curl','-sk','-X','PUT','-H','Authorization: Bearer '+TOKEN,'-H','Content-Type: application/json','-d',json.dumps(b),NIFI+p],capture_output=True,text=True)
    return json.loads(r.stdout)

for pg_id in ['c4f420f1-e29c-3974-8dcc-db75748cc94e']:
    pg=g('/flow/process-groups/'+pg_id)
    name=pg.get('processGroupFlow',{}).get('breadcrumb',{}).get('breadcrumb',{}).get('name','?')
    print('PG:', name)
    
    # Find children
    children=pg.get('processGroupFlow',{}).get('flow',{}).get('processGroups',[])
    pp_id, dw_id = None, None
    for c in children:
        cn=c.get('component',{}).get('name','')
        if 'Pagination' in cn: pp_id=c.get('id')
        if 'Master' in cn: dw_id=c.get('id')
    
    # Find main group Notify
    main_notify=None
    for p in pg.get('processGroupFlow',{}).get('flow',{}).get('processors',[]):
        if 'Notify' in p.get('component',{}).get('name',''):
            main_notify=p.get('id')
    
    # Find Pagination processors
    pp=g('/flow/process-groups/'+pp_id)
    build_next, batch_wait = None, None
    for p in pp.get('processGroupFlow',{}).get('flow',{}).get('processors',[]):
        pn=p.get('component',{}).get('name','')
        if 'Build Next' in pn: build_next=p.get('id')
        if 'Batch Wait' in pn: batch_wait=p.get('id')
    
    # Find GenerateFlowFile
    dw=g('/flow/process-groups/'+dw_id)
    gen=None
    for p in dw.get('processGroupFlow',{}).get('flow',{}).get('processors',[]):
        if 'GenerateFlowFile' in p.get('component',{}).get('type',''):
            gen=p.get('id')
    
    print('  Build Next:', build_next)
    print('  Batch Wait:', batch_wait)
    print('  Main Notify:', main_notify)
    print('  GenFlowFile:', gen)
    
    fixes=[
        (build_next,'Build Next',{'invoke.http.url':'${pagination.next.url}'}),
        (batch_wait,'Batch Waiter',{'release-signal-id':'${taskGuid}','signal-counter-name':'${taskGuid}.pages_complete'}),
        (main_notify,'Main Notify',{'release-signal-id':'${taskGuid}','signal-counter-name':'${taskGuid}.pages_complete'}),
        (gen,'GenFlowFile',{'api.param.size_name.value':'200'}),
    ]
    
    for pid,name,upd in fixes:
        if not pid: continue
        p=g('/processors/'+pid)
        put('/processors/'+pid,{'revision':p['revision'],'component':{'id':pid,'state':'STOPPED'}})
        time.sleep(0.3)
        p=g('/processors/'+pid)
        pr=p['component']['config']['properties']
        for k in upd:
            print('  '+name+': '+k+' = '+str(pr.get(k,'?'))[:70])
        for k,v in upd.items(): pr[k]=v
        r=put('/processors/'+pid,{'revision':p['revision'],'component':{'id':pid,'config':{'properties':pr}}})
        np=r.get('component',{}).get('config',{}).get('properties',{})
        for k in upd:
            nv=np.get(k,'?'); ok='OK' if nv==upd[k] else 'FAIL'
            print('    -> '+str(nv)[:70]+' ['+ok+']')
        p=g('/processors/'+pid)
        put('/processors/'+pid,{'revision':p['revision'],'component':{'id':pid,'state':'RUNNING'}})
        print()
    print(name+': ALL 4 DONE')
    print()
