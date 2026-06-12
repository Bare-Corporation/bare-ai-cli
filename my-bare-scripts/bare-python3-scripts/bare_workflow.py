#!/usr/bin/env python3
"""Bare-ConnectFi Workflow: Boomerang Template -> Task Creation -> NiFi Import"""
import json, subprocess, sys, uuid, os

BASEROW_URL = 'http://100.64.0.19/api'
BASEROW_TOKEN = 'Hv1YerRVGZoYrqWSbWeB9f5lHot4rzdw'
AUTH_H = 'Authorization: Token ' + BASEROW_TOKEN
CT_H = 'Content-Type: application/json'

def baserow_get(path):
    cmd = ['curl', '-sk', '-H', AUTH_H, '-H', CT_H, BASEROW_URL + path]
    r = subprocess.run(cmd, capture_output=True, text=True)
    try:
        return json.loads(r.stdout)
    except:
        print('Baserow GET failed: ' + r.stdout[:500])
        return None

def baserow_post(path, data):
    cmd = ['curl', '-sk', '-X', 'POST', '-H', AUTH_H, '-H', CT_H, '-d', json.dumps(data), BASEROW_URL + path]
    r = subprocess.run(cmd, capture_output=True, text=True)
    try:
        return json.loads(r.stdout)
    except:
        print('Baserow POST failed: ' + r.stdout[:500])
        return None

# ============ STEP 1: Find Boomerang template in Table 116 ============
print('=' * 70)
print('STEP 1: Query Table 116 for Boomerang template')
print('=' * 70)

print()
print('Fetching table 116 fields...')
fields_data = baserow_get('/database/fields/table/116/')
if fields_data:
    field_names = [f.get('name', '?') for f in fields_data]
    print('Fields in Table 116: ' + ', '.join(field_names))
else:
    print('WARNING: Could not fetch fields for table 116')

print()
print('Fetching all rows from table 116...')
rows_data = baserow_get('/database/rows/table/116/?user_field_names=true')
if not rows_data:
    print('FAILED to fetch rows from table 116')
    sys.exit(1)

rows = rows_data.get('results', [])
print('Total rows in Table 116: ' + str(len(rows)))

boomerang_rows = []
source_target_rows = []
for row in rows:
    row_id = row.get('id')
    template_type = row.get('Template Type', row.get('template_type', row.get('Type', '')))
    name = row.get('Name', row.get('name', row.get('Template Name', '')))
    
    print('  Row ' + str(row_id) + ': Name="' + str(name) + '" Type="' + str(template_type) + '"')
    
    if 'boomerang' in str(template_type).lower():
        boomerang_rows.append(row)
    if 'source-target' in str(template_type).lower() or 'bidirectional' in str(template_type).lower():
        source_target_rows.append(row)

print()
if boomerang_rows:
    print('FOUND BOOMERANG ROW(S):')
    for r in boomerang_rows:
        print('  Row ID: ' + str(r.get('id')))
        for k, v in r.items():
            if k not in ['id', 'order']:
                print('    ' + str(k) + ': ' + str(v))
elif source_target_rows:
    print('Only found Source-Target Bidirectional rows. Filtering for Boomerang...')
    filtered = baserow_get('/database/rows/table/116/?user_field_names=true&search=Boomerang')
    if filtered and filtered.get('results'):
        for r in filtered['results']:
            name = r.get('Name', r.get('name', '?'))
            print('  Row ID: ' + str(r.get('id')) + ' Name: ' + str(name))
    else:
        print('  No Boomerang rows found even with search filter.')
else:
    print('No Boomerang or Source-Target rows found. Dumping all rows:')
    for r in rows:
        print('  Row ' + str(r.get('id')) + ': ' + json.dumps(r)[:300])
