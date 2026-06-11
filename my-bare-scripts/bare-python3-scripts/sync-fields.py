#!/usr/bin/env python3
"""Steps 4-5: Rename fields and fix types in Bare-Control to match Bare-Finance."""
import sys, json
sys.path.insert(0, '/home/bare-ai/bare-ai-cli/my-bare-scripts/bare-python3-scripts')
from patch_helper import patch, api_get, api_post

print("Reloading Bare-Control schema...")
control = {}
tables_bc = api_get("/database/tables/database/3/")
for t in tables_bc:
    tid = t["id"]
    tname = t["name"]
    fields = api_get("/database/fields/table/" + str(tid) + "/")
    field_list = []
    for f in fields:
        field_list.append({"id": f.get("id"), "name": f.get("name"), "type": f.get("type")})
    control[tname] = {"table_id": tid, "fields": field_list}
print("Loaded " + str(len(control)) + " tables")

def fid(tname, fname):
    for f in control[tname]["fields"]:
        if f["name"] == fname:
            return f["id"]
    return None

# ============================================================
# STEP 4: Field Renames
# ============================================================
print("")
print("=== STEP 4: Field Renames ===")
renames = [
    ("Legal Entity", "Name", "Legal Entity Name"),
    ("Legal Entity", "Trading Name", "Legal Entity Trading Name"),
    ("Legal Entity", "Created", "Created_on"),
    ("Legal Entity", "Last Modified", "Last_modified"),
    ("Legal Entity", "Republic of Ireland Tax Registration Number", "Republic of Ireland Tax Registration #"),
    ("Legal Entity", "VAT NUMBER", "Vat Number"),
    ("Legal Entity", "VAT Registration Date", "vatRegistrationDate"),
    ("Legal Entity", "Legal Entity_ID", "Legal-Entity_id"),
    ("Legal Entity", "Country Code (from Country)", "Country ISO 2 Code (from Country)"),
    ("Legal Entity Bank Accounts", "Name", "Bank Account Name"),
    ("Stakeholder Account", "Stakeholder Name", "Stakeholder Account"),
    ("Stakeholder Account", "Status", "Stakeholder Status"),
    ("Stakeholder Account", "Stakeholder Industry", "Industry"),
    ("Stakeholder Account", "Internal or External Entity?", "Internal Company?"),
    ("Stakeholder - Representatives", "country", "Country"),
    ("Workers", "Primary Home Email Address", "Contact Email Address"),
    ("Workers", "Worker", "Worker Full Legal Name"),
    ("Workers", "Worker_GUID_Master", "Worker UUID"),
    ("Workers", "Worker Company Name", "Company Name"),
    ("Workers", "Worker Role(s)", "Consultant Primary Role"),
]

errors = []
for tname, old_name, new_name in renames:
    f_id = fid(tname, old_name)
    if f_id is None:
        print("NOT FOUND: " + tname + " / " + old_name)
        errors.append((tname, old_name))
        continue
    try:
        patch("/database/fields/" + str(f_id) + "/", {"name": new_name})
    except Exception as e:
        print("ERROR: " + tname + "/" + old_name + " -> " + str(e))
        errors.append((tname, old_name))

print("")
print("Renames done. Errors: " + str(len(errors)))
for e in errors:
    print("  FAILED: " + str(e))

# ============================================================
# STEP 5: Type Fixes
# ============================================================
print("")
print("=== STEP 5: Type Fixes ===")

control2 = {}
for t in tables_bc:
    tid = t["id"]
    tname = t["name"]
    fields = api_get("/database/fields/table/" + str(tid) + "/")
    field_list = []
    for f in fields:
        field_list.append({"id": f.get("id"), "name": f.get("name"), "type": f.get("type")})
    control2[tname] = {"table_id": tid, "fields": field_list}

def fid2(tname, fname):
    for f in control2[tname]["fields"]:
        if f["name"] == fname:
            return f["id"]
    return None

type_fixes = [
    ("Legal Entity", "Registered Address", "text"),
    ("Legal Entity", "Registration Number", "text"),
    ("Legal Entity Bank Accounts", "ADDRESS", "text"),
    ("Revenue Categories", "Category", "text"),
    ("Stakeholder Projects", "Notes", "text"),
    ("Stakeholder Projects", "Project Description", "text"),
    ("Workers", "Contact Email Address", "text"),
    ("Workers", "Day Rate", "text"),
]

errors2 = []
for tname, fname, new_type in type_fixes:
    f_id = fid2(tname, fname)
    if f_id is None:
        print("NOT FOUND: " + tname + " / " + fname)
        errors2.append((tname, fname))
        continue
    try:
        patch("/database/fields/" + str(f_id) + "/", {"type": new_type})
    except Exception as e:
        print("ERROR: " + tname + "/" + fname + " -> " + str(e))
        errors2.append((tname, fname))

print("")
print("Type fixes done. Errors: " + str(len(errors2)))
for e in errors2:
    print("  FAILED: " + str(e))

print("")
print("=== Summary ===")
print("Renames: " + str(len(renames) - len(errors)) + "/" + str(len(renames)) + " succeeded")
print("Type fixes: " + str(len(type_fixes) - len(errors2)) + "/" + str(len(type_fixes)) + " succeeded")
