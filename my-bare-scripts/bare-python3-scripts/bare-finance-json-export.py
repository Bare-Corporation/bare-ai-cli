#!/usr/bin/env python3
"""Portable JSON backup of Bare-Finance database via Baserow API."""
import json, sys, os, urllib.request, urllib.error
from datetime import datetime, timezone

TOKEN = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ0b2tlbl90eXBlIjoiYWNjZXNzIiwiZXhwIjoxNzgxMjAwMTA3LCJpYXQiOjE3ODExOTk1MDcsImp0aSI6IjMxZmQ5MGExYjIwOTRmMWFhNjFmZTg1ODU4YmYyZWRjIiwidXNlcl9pZCI6IjEifQ.THD3JzakajCFzrk5ie6K9GvI1GzUtS0CwE4umzh9tr0"
BASE = "http://100.64.0.19/api"
OUTDIR = os.path.expanduser("~/bare-table/database")
os.makedirs(OUTDIR, exist_ok=True)

def api(path):
    req = urllib.request.Request(f"{BASE}{path}", headers={"Authorization": f"JWT {TOKEN}"})
    with urllib.request.urlopen(req) as resp:
        return json.loads(resp.read())

print("[Step 4-alt] Exporting all Bare-Finance tables via API...")

# Get all tables in database 2
tables = api("/database/tables/database/2/")
print(f"Found {len(tables)} tables:")
for t in tables:
    print(f"  [{t['id']}] {t['name']}")

export = {
    "exported_at": datetime.now(timezone.utc).isoformat(),
    "database_id": 2,
    "database_name": "Bare-Finance",
    "tables": {}
}

for t in tables:
    tid = t['id']
    tname = t['name']
    print(f"  Fetching [{tid}] {tname}...", end=" ", flush=True)
    try:
        data = api(f"/database/rows/table/{tid}/?size=10000")
        rows = data.get("results", [])
        export["tables"][tname] = rows
        print(f"{len(rows)} rows")
    except Exception as e:
        print(f"ERROR: {e}")
        export["tables"][tname] = []

outpath = os.path.join(OUTDIR, "bare-finance-api-export.json")
with open(outpath, "w") as f:
    json.dump(export, f, indent=2, default=str)

# Validate
with open(outpath) as f:
API export complete: {os.path.getsize(outpath):,} bytes, {len(tables)} tables")
print(f"File: {outpath}")
size = os.path.getsize(outpath)
count = len(tables)
print("API export complete: " + str(size) + " bytes, " + str(count) + " tables")
print("File: " + outpath)
