#!/usr/bin/env python3
"""Dump ALL parameters from Bare-ConnectFi_MasterParameterContext."""
import json, subprocess, sys

NIFI = 'https://localhost:8443/nifi-api'
TOKEN_FILE = '/tmp/nifi_jwt.txt'

def read_token():
    with open(TOKEN_FILE) as f:
        return f.read().strip()

def curl_get(token, path):
    cmd = ['curl', '-sk', '-H', 'Authorization: Bearer ' + token, NIFI + path]
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode != 0:
        return None
    try:
        return json.loads(r.stdout)
    except:
        print('RAW:', r.stdout[:1000])
        return None

def authenticate():
    for user, pw in [('bcfi-admin', 'NewPassword123!'), ('bcfi-admin', 'bcfi-admin')]:
        cmd = ['curl', '-sk', '-X', 'POST',
               '-H', 'Content-Type: application/x-www-form-urlencoded',
               '-d', 'username=' + user + '&password=' + pw,
               NIFI + '/access/token']
        r = subprocess.run(cmd, capture_output=True, text=True)
        if r.returncode == 0 and len(r.stdout) > 50 and 'error' not in r.stdout.lower():
            token = r.stdout.strip()
            with open(TOKEN_FILE, 'w') as f:
                f.write(token)
            return token
    return None

# Auth
token = read_token()
# First fetch the parameter contexts list to find the target ID
data = curl_get(token, '/flow/parameter-contexts')
if not data:
    token = authenticate()
    if token:
        data = curl_get(token, '/flow/parameter-contexts')

if not data:
    print('FAILED to get parameter contexts')
    sys.exit(1)

target_id = None
for c in data.get('parameterContexts', []):
    pc = c.get('component', {})
    if pc.get('name') == 'Bare-ConnectFi_MasterParameterContext':
        target_id = c.get('id')
        break

if not target_id:
    print('Context not found')
    sys.exit(1)

# Now fetch the specific parameter context by ID
pc_data = curl_get(token, '/parameter-contexts/' + target_id)
if not pc_data:
    print('FAILED to get specific parameter context')
    sys.exit(1)

# Dump the full structure
print(json.dumps(pc_data, indent=2))
