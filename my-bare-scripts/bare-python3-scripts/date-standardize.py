#!/usr/bin/env python3
"""Apply UTC/ISO/naming standards to all date fields in both databases."""
import sys
sys.path.insert(0, '/home/bare-ai/bare-ai-cli/my-bare-scripts/bare-python3-scripts')
from patch_helper import api_get, patch

# Configuration
FIX_FORMAT_TO_ISO = True       # EU/US -> ISO
FIX_TZ_TO_UTC = True           # None -> UTC for created_on/last_modified
FIX_NAMES = True               # Created* -> Created_on, Last Modified* -> Last_modified
FIX_TYPES = True               # date -> created_on/last_modified where needed

results = {"format_fixes": 0, "tz_fixes": 0, "name_fixes": 0, "type_fixes": 0, "errors": 0}

def scan_and_fix(db_id, db_name):
    print("=== " + db_name + " (ID=" + str(db_id) + ") ===")
    tables = api_get("/database/tables/database/" + str(db_id) + "/")
    for t in tables:
        tid = t["id"]
        tname = t["name"]
        fields = api_get("/database/fields/table/" + str(tid) + "/")
        for f in fields:
            fname = f.get("name", "")
            ftype = f.get("type", "")
            fid = f.get("id")
            fmt = f.get("date_format", None)
            tz = f.get("date_force_timezone", None)
            inc_time = f.get("date_include_time", None)
            
            # Skip non-date fields
            if ftype not in ('date', 'created_on', 'last_modified'):
                continue
            
            patches = {}
            new_name = None
            
            # --- FORMAT FIX: EU/US -> ISO ---
            if FIX_FORMAT_TO_ISO and fmt in ('EU', 'US'):
                patches["date_format"] = "ISO"
            
            # --- TIMEZONE FIX: None -> UTC for created_on/last_modified ---
            if FIX_TZ_TO_UTC and tz is None and ftype in ('created_on', 'last_modified'):
                patches["date_force_timezone"] = "UTC"
            
            # Also fix tz for date types that include_time but have no tz
            if FIX_TZ_TO_UTC and tz is None and ftype == 'date' and inc_time is True:
                patches["date_force_timezone"] = "UTC"
            
            # --- NAME FIXES ---
            if FIX_NAMES:
                lower = fname.lower()
                # "Created Date" "Created Time" "Created" "Created At" -> "Created_on"
                if lower in ('created', 'created time', 'created date/time', 
                            'created date', 'created at', 'created time',
                            'date/time ticket created', 'date/time po / project created',
                            'created_date', 'opened date & time (gmt)'):
                    new_name = "Created_on"
                # "Last Modified*", "Updated*", "Lat Modified*" -> "Last_modified"
                elif any(kw in lower for kw in ['last modified', 'last updated', 'updated date', 'lat modified']):
                    new_name = "Last_modified"
                # "Created time" (case insensitive)
                elif lower == 'created time':
                    new_name = "Created_on"
            
            if new_name and new_name != fname:
                patches["name"] = new_name
            
            # --- TYPE FIXES ---
            if FIX_TYPES:
                # If name is Created_on and type is date -> created_on
                target_name = new_name if new_name else fname
                if target_name == "Created_on" and ftype == "date":
                    patches["type"] = "created_on"
                elif target_name == "Last_modified" and ftype == "date":
                    patches["type"] = "last_modified"
            
            if patches:
                desc = []
                if "date_format" in patches: 
                    desc.append("fmt:" + fmt + "->ISO")
                    results["format_fixes"] += 1
                if "date_force_timezone" in patches: 
                    desc.append("tz:None->UTC")
                    results["tz_fixes"] += 1
                if "name" in patches: 
                    desc.append("name:" + fname + "->" + patches["name"])
                    results["name_fixes"] += 1
                if "type" in patches: 
                    desc.append("type:" + ftype + "->" + patches["type"])
                    results["type_fixes"] += 1
                
                try:
                    patch("/database/fields/" + str(fid) + "/", patches)
                    print("  OK [" + str(fid) + "] " + tname + " | " + fname + " | " + ", ".join(desc))
                except Exception as e:
                    print("  FAIL [" + str(fid) + "] " + tname + " | " + fname + " | " + str(e)[:80])
                    results["errors"] += 1

scan_and_fix(2, "Bare-Finance")
print("")
scan_and_fix(3, "Bare-Control")

print("")
print("=== Date Standardization Complete ===")
print("Format fixes (EU/US -> ISO): " + str(results["format_fixes"]))
print("Timezone fixes (None -> UTC): " + str(results["tz_fixes"]))
print("Name fixes: " + str(results["name_fixes"]))
print("Type fixes: " + str(results["type_fixes"]))
print("Errors: " + str(results["errors"]))
