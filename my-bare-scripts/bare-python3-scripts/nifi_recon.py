import json, subprocess
token = open('/tmp/nifi_jwt.txt').read().strip()
NIFI = 'https://localhost:8443/nifi-api'

def api(path):
    r = subprocess.run(['curl', '-sk', '-H', 'Authorization: Bearer ' + token, NIFI + path], capture_output=True, text=True)
    return json.loads(r.stdout) if r.stdout.strip() else {}

# Part 1: Templates
print("=" * 60)
print("PART 1: TEMPLATES")
print("=" * 60)
resp = api('/flow/templates')
for t in resp.get('templates', []):
    print("ID:", t.get('id'))
    print("Name:", t.get('name'))
    print("Desc:", t.get('description', 'N/A')[:120])
    print()

# Part 2: Template Detail
TID = '2012c87c-00f1-3682-c267-94f5a48466d9'
print("=" * 60)
print("PART 2: TEMPLATE DETAIL", TID)
print("=" * 60)
detail = api('/templates/' + TID)
snippet = detail.get('template', {}).get('snippet', detail.get('snippet', {}))
for p in snippet.get('processors', []):
    print("PROC:", p.get('id'), p.get('name'), "->", p.get('type'))
for pg in snippet.get('processGroups', []):
    print("CHILD_PG:", pg.get('id'), pg.get('name'))
for c in snippet.get('connections', []):
    print("CONN:", c.get('id'), c.get('name'), c.get('source',{}).get('id'), "->", c.get('destination',{}).get('id'))
print("IN_PORTS:", [(p.get('id'), p.get('name')) for p in snippet.get('inputPorts', [])])
print("OUT_PORTS:", [(p.get('id'), p.get('name')) for p in snippet.get('outputPorts', [])])

# Part 3: App1 GenerateFlowFile Props
APP1_PG = '3bfb629f-c614-3cfa-ad93-34e9d6d2ad65'
APP1_GFF = '735a1019-b1c9-3850-7c36-18d93e879a7f'
print()
print("=" * 60)
print("PART 3: APP1 GenerateFlowFile Props")
print("=" * 60)
f1 = api('/flow/process-groups/' + APP1_PG)
for p in f1.get('processGroupFlow',{}).get('flow',{}).get('processors',[]):
    if p.get('id') == APP1_GFF:
        props = p.get('component',{}).get('properties',{})
        for k in sorted(props.keys()):
            print("  ", k, ":", props[k])

# Part 4: App2 GenerateFlowFile Props
APP2_PG = '70572fed-9cc8-3b2d-2b79-67cf71d52786'
APP2_GFF = '7724a15d-0b22-3dec-c630-03893124f53e'
print()
print("=" * 60)
print("PART 4: APP2 GenerateFlowFile Props")
print("=" * 60)
f2 = api('/flow/process-groups/' + APP2_PG)
for p in f2.get('processGroupFlow',{}).get('flow',{}).get('processors',[]):
    if p.get('id') == APP2_GFF:
        props = p.get('component',{}).get('properties',{})
        for k in sorted(props.keys()):
            print("  ", k, ":", props[k])

# Part 5: Root PGs
print()
print("=" * 60)
print("PART 5: ROOT PROCESS GROUPS")
print("=" * 60)
root = api('/flow/process-groups/root')
for pg in root.get('processGroupFlow',{}).get('flow',{}).get('processGroups',[]):
    print("PG:", pg.get('id'), pg.get('component',{}).get('name','?'))

print()
print("DONE")
