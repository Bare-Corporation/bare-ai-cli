#!/usr/bin/env python3
"""Fetch full schema for Bare-Finance and Bare-Control for comparison."""
import json, urllib.request

def get_jwt():
    data = json.dumps({"email": "***REMOVED***", "password": "***REMOVED***"}).encode()
    req = urllib.request.Request("http://100.64.0.19/api/user/token-auth/", data=data, headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req) as r:
        return json.loads(r.read())["token"]

TOKEN = get_jwt()
BASE = "http://100.64.0.19/api"

def api(path):
    req = urllib.request.Request(BASE + path, headers={"Authorization": "JWT " + TOKEN})
    with urllib.request.urlopen(req) as r:
        return json.loads(r.read())

def fetch_schema(db_id, db_name):
    print("=== " + db_name + " (ID=" + str(db_id) + ") ===")
    tables = api("/database/tables/database/" + str(db_id) + "/")
    schema = {}
    for t in tables:
        tid = t["id"]
        tname = t["name"]
        print("  [" + str(tid) + "] " + tname)
        fields = api("/database/fields/table/" + str(tid) + "/")
        field_list = []
        for f in fields:
            field_list.append({
                "id": f.get("id"),
                "name": f.get("name"),
                "type": f.get("type")
            })
        schema[tname] = {"table_id": tid, "fields": field_list}
    return schema

print("Fetching Bare-Finance schema...")
finance = fetch_schema(2, "Bare-Finance")

print("")
print("Fetching Bare-Control schema...")
control = fetch_schema(3, "Bare-Control")

# Save for later comparison
with open("/tmp/bf_finance_schema.json", "w") as f:
    json.dump(finance, f, indent=2, default=str)
with open("/tmp/bf_control_schema.json", "w") as f:
    json.dump(control, f, indent=2, default=str)

print("")
print("=== Summary ===")
print("Bare-Finance: " + str(len(finance)) + " tables")
print("Bare-Control: " + str(len(control)) + " tables")

# Quick comparison by table name
fin_tables = set(finance.keys())
ctl_tables = set(control.keys())
common = fin_tables & ctl_tables
only_fin = fin_tables - ctl_tables
only_ctl = ctl_tables - fin_tables

print("")
print("Common tables: " + str(len(common)))
if only_fin:
    print("Only in Bare-Finance: " + str(sorted(only_fin)))
if only_ctl:
    print("Only in Bare-Control: " + str(sorted(only_ctl)))

# Field comparison for common tables
print("")
print("=== Field-level comparison (common tables) ===")
mismatches = []
for tname in sorted(common):
    fin_fields = {f["name"]: f["type"] for f in finance[tname]["fields"]}
    ctl_fields = {f["name"]: f["type"] for f in control[tname]["fields"]}
    
    fin_set = set(fin_fields.keys())
    ctl_set = set(ctl_fields.keys())
    
    extra_in_fin = fin_set - ctl_set
    extra_in_ctl = ctl_set - fin_set
    type_diff = {n for n in (fin_set & ctl_set) if fin_fields[n] != ctl_fields[n]}
    
    if extra_in_fin or extra_in_ctl or type_diff:
        mismatches.append(tname)
        print("")
        print("  TABLE: " + tname)
        if extra_in_fin:
            print("    Fields only in Bare-Finance: " + str(sorted(extra_in_fin)))
        if extra_in_ctl:
            print("    Fields only in Bare-Control: " + str(sorted(extra_in_ctl)))
        if type_diff:
            print("    Type mismatches:")
            for n in sorted(type_diff):
                print("      " + n + ": Finance=" + fin_fields[n] + " vs Control=" + ctl_fields[n])

if not mismatches:
    print("  All common tables have identical fields. No mismatches.")
else:
    print("")
    print("  Total tables with mismatches: " + str(len(mismatches)) + " / " + str(len(common)))
