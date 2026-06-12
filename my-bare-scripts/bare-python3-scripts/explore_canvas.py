#!/usr/bin/env python3
"""Explore NiFi canvas hierarchy to find FreeAgent and BaseRow integrations."""
import json, subprocess

# Read token - last non-empty line
with open('/tmp/nifi_token.txt') as f:
    lines = [l.strip() for l in f.readlines() if l.strip()]
    token = lines[-1]

def curl(url):
    cmd = ['curl', '-sk', '-H', 'Authorization: Bearer ' + token, url]
    result = subprocess.run(cmd, capture_output=True, text=True)
    return json.loads(result.stdout)

def get_child_pgs(pg_id, depth=0):
    indent = "  " * depth
    try:
        data = curl('https://localhost:8443/nifi-api/flow/process-groups/' + pg_id)
        pg_info = data['processGroupFlow']['processGroup']
        name = pg_info['component']['name']
        print(indent + "PG: " + name + " (ID: " + pg_id + ")")
        
        flow = data['processGroupFlow']['flow']
        for child in flow.get('processGroups', []):
            get_child_pgs(child['id'], depth + 1)
        
        for proc in flow.get('processors', []):
            pname = proc['component']['name']
            ptype = proc['component']['type']
            short = ptype.split('.')[-1] if '.' in ptype else ptype
            print(indent + "  PROC: " + pname + " (" + short + ")")
            
            if 'GenerateFlowFile' in ptype:
                props = proc['component'].get('properties', {})
                ct = props.get('Custom Text', '')
                if ct:
                    print(indent + "    CustomText: " + ct[:300])
        
        for port in flow.get('inputPorts', []):
            print(indent + "  INPUT-PORT: " + port['component']['name'])
        for port in flow.get('outputPorts', []):
            print(indent + "  OUTPUT-PORT: " + port['component']['name'])
            
    except Exception as e:
        print(indent + "ERROR at " + pg_id + ": " + str(e))

root = curl('https://localhost:8443/nifi-api/flow/process-groups/root')
root_pg_id = root['processGroupFlow']['processGroup']['id']
print("Root PG: " + root_pg_id)

for child in root['processGroupFlow']['flow'].get('processGroups', []):
    get_child_pgs(child['id'], 0)
