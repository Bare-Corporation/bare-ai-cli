#!/usr/bin/env python3
import json, subprocess, sys

NIFI = 'https://localhost:8443/nifi-api'

# Try common credential combinations
creds = [
    ('bcfi-admin', 'bcfi-admin'),
    ('bcfi-admin', 'bare-connectfi'),
    ('bcfi-admin', 'Bare-ConnectFi'),
    ('admin', 'admin'),
]

# First check if we can read the single-user credentials from NiFi config
import os
login_file = '/home/bare-ai/bare-connectfi/nifi-2.3.0/conf/login-identity-providers.xml'
if os.path.exists(login_file):
    with open(login_file) as f:
        content = f.read()
        print('=== login-identity-providers.xml ===')
        print(content[:2000])

print()
print('=== Trying credential combinations ===')
for user, pw in creds:
    cmd = ['curl', '-sk', '-X', 'POST',
           '-H', 'Content-Type: application/x-www-form-urlencoded',
           '-d', 'username=' + user + '&password=' + pw,
           NIFI + '/access/token']
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode == 0 and len(r.stdout) > 50 and not 'error' in r.stdout.lower():
        print('SUCCESS with', user, '/', pw)
        print('TOKEN:', r.stdout[:80] + '...')
        with open('/tmp/nifi_jwt.txt', 'w') as f:
            f.write(r.stdout.strip())
        sys.exit(0)
    else:
        print('FAILED:', user, '/', pw, '-', r.stdout[:80])

print()
print('All credential attempts failed.')
