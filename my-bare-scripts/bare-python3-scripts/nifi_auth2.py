#!/usr/bin/env python3
import json, subprocess

NIFI = 'https://localhost:8443/nifi-api'

cmd = ['curl', '-sk', '-X', 'POST',
       '-H', 'Content-Type: application/x-www-form-urlencoded',
       '-d', 'username=bcfi-admin&password=YourPasswordHere',
       NIFI + '/access/token']
r = subprocess.run(cmd, capture_output=True, text=True)
print('RC:', r.returncode)
print('Response:', r.stdout[:200])
if r.returncode == 0 and len(r.stdout) > 50:
    token = r.stdout.strip()
    # Verify the token works
    cmd2 = ['curl', '-sk', '-H', 'Authorization: Bearer ' + token, NIFI + '/flow/process-groups/root']
    r2 = subprocess.run(cmd2, capture_output=True, text=True)
    try:
        data = json.loads(r2.stdout)
        pg = data.get('processGroupFlow', {}).get('processGroup', {})
        if pg.get('id'):
            print('TOKEN VALID - Root PG:', pg.get('id'))
            with open('/tmp/nifi_jwt.txt', 'w') as f:
                f.write(token)
            print('Token saved to /tmp/nifi_jwt.txt')
        else:
            print('Token accepted but PG data empty:', r2.stdout[:200])
    except:
        print('Token accepted but parse failed:', r2.stdout[:200])
