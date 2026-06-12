#!/usr/bin/env python3
"""Patch all non-compliant date fields to use UTC timezone."""
import json, urllib.request, time

# Auth
data = json.dumps({"email": "***REMOVED***", "password": "***REMOVED***"}).encode()
req = urllib.request.Request("http://100.64.0.19/api/user/token-auth/", data=data, headers={"Content-Type": "application/json"})
with urllib.request.urlopen(req) as r:
    TOKEN = json.loads(r.read())["token"]

# Load issues
with open("/tmp/bare_date_field_issues.json") as f:
    issues = json.load(f)

print("Loaded " + str(len(issues)) + " date fields to fix")
print()

fixed = 0
failed = 0

for i, issue in enumerate(issues):
    fid = issue["field_id"]
    fname = issue["field"]
    table = issue["table"]
    db = issue["database"]
    
    payload = json.dumps({"date_force_timezone": "UTC"}).encode()
    req = urllib.request.Request(
        "http://100.64.0.19/api/database/fields/" + str(fid) + "/",
        data=payload,
        headers={"Authorization": "JWT " + TOKEN, "Content-Type": "application/json"},
        method="PATCH"
    )
    
    try:
        with urllib.request.urlopen(req) as r:
            resp = json.loads(r.read())
            if "detail" in resp:
                print("[" + str(i+1) + "/" + str(len(issues)) + "] FAIL " + db + " :: " + table + " :: " + fname + " (id=" + str(fid) + ") - " + str(resp.get("detail")))
                failed += 1
            else:
                print("[" + str(i+1) + "/" + str(len(issues)) + "] OK   " + db + " :: " + table + " :: " + fname + " (id=" + str(fid) + ")")
                fixed += 1
    except Exception as e:
        print("[" + str(i+1) + "/" + str(len(issues)) + "] ERR  " + db + " :: " + table + " :: " + fname + " (id=" + str(fid) + ") - " + str(e))
        failed += 1
    
    # Small delay to avoid hammering
    time.sleep(0.05)

print()
print("============================================================")
print("  FIX COMPLETE")
print("  Fixed: " + str(fixed))
print("  Failed: " + str(failed))
print("============================================================")
