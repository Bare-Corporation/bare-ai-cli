#!/usr/bin/env python3
"""Portable JSON backup of Bare-Finance & Bare-Control via Baserow API.

NOTE: Database API token (Token auth) only works for row CRUD endpoints.
For table listing (/database/tables/database/{id}/) use JWT user token.
JWT expires in ~10 mins — refresh at script start via token-auth endpoint.
"""
import json, os, urllib.request
from datetime import datetime, timezone

# Get fresh JWT at runtime
def get_jwt():
    data = json.dumps({"email": "admin@bare-table.com", "password": "Test1234!Abcd"}).encode()
    req = urllib.request.Request(
        "http://100.64.0.19/api/user/token-auth/",
        data=data,
        headers={"Content-Type": "application/json"}
    )
    with urllib.request.urlopen(req) as resp:
        return json.loads(resp.read())["token"]

TOKEN = get_jwt()
BASE = "http://100.64.0.19/api"
OUTDIR = os.path.expanduser("~/bare-table/database")

def api(path):
    req = urllib.request.Request(BASE + path, headers={"Authorization": "JWT " + TOKEN})
    with urllib.request.urlopen(req) as resp:
        return json.loads(resp.read())

def export_database(db_id, db_name, outfile):
    print("Exporting " + db_name + " (ID=" + str(db_id) + ")...")
    tables = api("/database/tables/database/" + str(db_id) + "/")
    print("  Found " + str(len(tables)) + " tables")
    for t in tables:
        print("    [" + str(t["id"]) + "] " + t["name"])

    result = {
        "exported_at": datetime.now(timezone.utc).isoformat(),
        "database_id": db_id,
        "database_name": db_name,
        "tables": {}
    }

    total_rows = 0
    for t in tables:
        tid = t["id"]
        tname = t["name"]
        print("  Fetching [" + str(tid) + "] " + tname + "...", end=" ", flush=True)
        try:
            data = api("/database/rows/table/" + str(tid) + "/?size=10000")
            rows = data.get("results", [])
            result["tables"][tname] = rows
            total_rows += len(rows)
            print(str(len(rows)) + " rows")
        except Exception as e:
            print("ERROR: " + str(e))
            result["tables"][tname] = []

    outpath = os.path.join(OUTDIR, outfile)
    os.makedirs(OUTDIR, exist_ok=True)
    with open(outpath, "w") as f:
        json.dump(result, f, indent=2, default=str)

    with open(outpath) as f:
        json.load(f)

    size = os.path.getsize(outpath)
    print("  -> " + outfile + ": " + str(size) + " bytes, " + str(len(tables)) + " tables, " + str(total_rows) + " total rows")
    return size, len(tables), total_rows

print("=== Bare-Finance API Export ===")
s1, t1, r1 = export_database(2, "Bare-Finance", "bare-finance-api-export.json")

print("")
print("=== Bare-Control API Export ===")
s2, t2, r2 = export_database(3, "Bare-Control", "bare-control-api-export.json")

print("")
print("=== Summary ===")
print("Bare-Finance: " + str(s1) + " bytes, " + str(t1) + " tables, " + str(r1) + " rows")
print("Bare-Control: " + str(s2) + " bytes, " + str(t2) + " tables, " + str(r2) + " rows")
print("Total: " + str(s1 + s2) + " bytes, " + str(t1 + t2) + " tables, " + str(r1 + r2) + " rows")
