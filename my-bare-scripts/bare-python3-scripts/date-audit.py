#!/usr/bin/env python3
"""Find all date/time fields and ensure UTC, ISO format, correct naming."""
import sys
sys.path.insert(0, '/home/bare-ai/bare-ai-cli/my-bare-scripts/bare-python3-scripts')
from patch_helper import api_get, patch

DATE_TYPES = {'date', 'created_on', 'last_modified', 'datetime', 'created_time', 'updated_time'}

def scan_db(db_id, db_name):
    print("=== " + db_name + " (ID=" + str(db_id) + ") ===")
    tables = api_get("/database/tables/database/" + str(db_id) + "/")
    findings = []
    for t in tables:
        tid = t["id"]
        tname = t["name"]
        fields = api_get("/database/fields/table/" + str(tid) + "/")
        for f in fields:
            fname = f.get("name", "")
            ftype = f.get("type", "")
            fid = f.get("id")
            if ftype in DATE_TYPES:
                findings.append((tid, tname, fid, fname, ftype))
                # Check date settings
                date_include_time = f.get("date_include_time", None)
                date_format = f.get("date_format", None)
                date_force_timezone = f.get("date_force_timezone", None)
                print("  [" + str(tid) + "] " + tname + " | " + fname + " | " + ftype +
                      " | include_time=" + str(date_include_time) +
                      " | format=" + str(date_format) +
                      " | tz=" + str(date_force_timezone))
    return findings

print("Scanning Bare-Finance...")
fin = scan_db(2, "Bare-Finance")
print("")
print("Scanning Bare-Control...")
ctl = scan_db(3, "Bare-Control")

print("")
print("=== Summary ===")
print("Bare-Finance date fields: " + str(len(fin)))
print("Bare-Control date fields: " + str(len(ctl)))
