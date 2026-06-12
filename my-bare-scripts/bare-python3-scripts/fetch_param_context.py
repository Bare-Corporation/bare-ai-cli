#!/usr/bin/env python3
"""Fetch ALL parameters from Bare-ConnectFi_MasterParameterContext and filter Bare-* names."""
import json, subprocess, sys

NIFI = 'https://localhost:8443/nifi-api'
TOKEN_FILE = '/tmp/nifi_jwt.txt'
TARGET = 'Bare-ConnectFi_MasterParameterContext'
PREFIX = 'Bare-'

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
        print('RAW: ' + r.stdout[:500])
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
data = curl_get(token, '/flow/parameter-contexts')
if not data:
    token = authenticate()
    if token:
        data = curl_get(token, '/flow/parameter-contexts')

if not data:
    print('FAILED to authenticate')
    sys.exit(1)

# Find target ID
target_id = None
for c in data.get('parameterContexts', []):
    if c.get('component', {}).get('name') == TARGET:
        target_id = c.get('id')
        break

if not target_id:
    print('Context not found')
    sys.exit(1)

# Fetch full context
pc = curl_get(token, '/parameter-contexts/' + target_id)
if not pc:
    print('FAILED to fetch parameter context')
    sys.exit(1)

params = pc['component']['parameters']
total = len(params)

# Filter Bare-*
bare_params = [p for p in params if p['parameter'].get('name', '').startswith(PREFIX)]

print('Context: ' + TARGET)
print('ID: ' + target_id)
print('Total parameters: ' + str(total))
print('Bare-* parameters: ' + str(len(bare_params)))
print()
print('{:<60} {:<65} {:<10} {}'.format('Name', 'Value', 'Sensitive', 'Description'))
print('-' + '-' * 59 + ' ' + '-' * 64 + ' ' + '-' * 9 + ' ' + '-' * 30)

for p in bare_params:
    param = p['parameter']
    name = param.get('name', '')
    value = param.get('value', '***SENSITIVE***')
    sensitive = '*** YES ***' if param.get('sensitive', False) else 'No'
    desc = param.get('description', '') or ''
    if len(value) > 62:
        value = value[:59] + '...'
    if len(desc) > 30:
        desc = desc[:27] + '...'
    print('{:<60} {:<65} {:<10} {}'.format(name, value, sensitive, desc))

print()
print('Done. ' + str(len(bare_params)) + ' Bare-* parameters extracted.')
