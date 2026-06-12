#!/usr/bin/env python3
import json, base64, time, subprocess

# Read token
with open('/tmp/nifi_jwt.txt') as f:
    token = f.read().strip()

# Decode JWT payload
payload_b64 = token.split('.')[1]
payload_b64 += '=' * (4 - len(payload_b64) % 4)
payload = json.loads(base64.urlsafe_b64decode(payload_b64))
print("=== JWT Payload ===")
print(json.dumps(payload, indent=2))
print("")
print(f"Token exp: {payload['exp']} ({time.strftime('%Y-%m-%d %H:%M:%S', time.gmtime(payload['exp']))} UTC)")
print(f"Current:   {int(time.time())} ({time.strftime('%Y-%m-%d %H:%M:%S', time.gmtime())} UTC)")
print(f"Status: {'VALID' if payload['exp'] > time.time() else 'EXPIRED'}")

# Test token
print("")
print("=== Testing API Access ===")
r = subprocess.run([
    'curl', '-sk', '-H', f'Authorization: Bearer {token}',
    'https://localhost:8443/nifi-api/flow/about'
], capture_output=True, text=True)
try:
    d = json.loads(r.stdout)
    print(f"NiFi version: {d.get('about',{}).get('version','?')}")
    print("Authenticated: YES")
except:
    print(f"Auth failed: {r.stdout[:200]}")
