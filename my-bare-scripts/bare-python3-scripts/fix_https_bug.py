#!/usr/bin/env python3
"""Fix the Build Next Page URL processor - remove http->https upgrade"""
import json, subprocess, time

NIFI='https://localhost:8443/nifi-api'
with open('/tmp/nifi_jwt.txt') as f: TOKEN=f.read().strip()
def g(path):
    r=subprocess.run(['curl','-sk','-H','Authorization: Bearer '+TOKEN, NIFI+path],capture_output=True,text=True)
    return json.loads(r.stdout)
def put(path,body):
    r=subprocess.run(['curl','-sk','-X','PUT','-H','Authorization: Bearer '+TOKEN,'-H','Content-Type: application/json','-d',json.dumps(body), NIFI+path],capture_output=True,text=True)
    return json.loads(r.stdout)

TARGET='d6c08dc8-00bf-3944-a229-6a1fb998584d'

# Stop
proc=g('/processors/'+TARGET)
rev=proc['revision']
put('/processors/'+TARGET,{'revision':rev,'component':{'id':TARGET,'state':'STOPPED'}})
print('Stopped Build Next Page URL')
time.sleep(1)

# Get and show old value
proc=g('/processors/'+TARGET)
rev=proc['revision']
props=proc['component']['config']['properties']
old=props.get('invoke.http.url','?')
print('OLD: '+old)

# Fix
props['invoke.http.url']='${pagination.next.url}'
result=put('/processors/'+TARGET,{'revision':rev,'component':{'id':TARGET,'config':{'properties':props}}})
new=result.get('component',{}).get('config',{}).get('properties',{}).get('invoke.http.url','?')
print('NEW: '+new)

# Start
proc=g('/processors/'+TARGET)
rev=proc['revision']
put('/processors/'+TARGET,{'revision':rev,'component':{'id':TARGET,'state':'RUNNING'}})
print('Started')
print()
print('FIX: Removed replaceFirst(http:,https:) from next page URL builder')
