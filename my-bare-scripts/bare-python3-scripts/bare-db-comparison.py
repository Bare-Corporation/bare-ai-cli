#!/usr/bin/env python3
"""Bare-AI Three-Database Comparison: bare-finance, bare-talent, bare-control."""
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

DATABASES = {"Bare-Finance": 2, "Bare-Control": 3, "Bare-Talent": 7}
SEP = "=" * 60
schemas = {}

for db_name, db_id in DATABASES.items():
    print()
    print(SEP)
    print("  FETCHING: " + db_name + " (ID=" + str(db_id) + ")")
    print(SEP)
    tables = api("/database/tables/database/" + str(db_id) + "/")
    schema = {}
    for t in tables:
        tid = t["id"]
        tname = t["name"]
        print("  Table [" + str(tid) + "] " + tname)
        fields = api("/database/fields/table/" + str(tid) + "/")
        field_list = []
        for f in fields:
            entry = {
                "id": f.get("id"), "name": f.get("name"), "type": f.get("type"),
                "order": f.get("order"), "read_only": f.get("read_only"),
                "description": f.get("description"),
            }
            if f.get("type") == "date":
                entry["date_format"] = f.get("date_format")
                entry["date_include_time"] = f.get("date_include_time")
                entry["date_time_format"] = f.get("date_time_format")
                entry["date_show_tzinfo"] = f.get("date_show_tzinfo")
                entry["date_force_timezone"] = f.get("date_force_timezone")
            field_list.append(entry)
        schema[tname] = {"table_id": tid, "field_count": len(field_list), "fields": field_list}
    schemas[db_name] = schema
    print("  => " + str(len(schema)) + " tables, " + str(sum(s["field_count"] for s in schema.values())) + " total fields")

for db_name, schema in schemas.items():
    fname = "/tmp/bare_" + db_name.lower().replace("-", "_") + "_schema.json"
    with open(fname, "w") as f:
        json.dump(schema, f, indent=2, default=str)
    print("Saved raw schema: " + fname)

print()
print(SEP)
print("  COMPARISON 1: TABLE NAMES")
print(SEP)

db_names = list(schemas.keys())
all_tables = {name: set(schemas[name].keys()) for name in db_names}

print()
print("  TABLE COUNTS:")
for name in db_names:
    print("    " + name + ": " + str(len(all_tables[name])) + " tables")

common_all = all_tables[db_names[0]] & all_tables[db_names[1]] & all_tables[db_names[2]]

print()
print("  TABLES COMMON TO ALL THREE: " + str(len(common_all)))
for t in sorted(common_all):
    print("    + " + t)

for name in db_names:
    others = set(db_names) - {name}
    other_tables = set()
    for o in others:
        other_tables |= all_tables[o]
    unique = all_tables[name] - other_tables
    if unique:
        print()
        print("  TABLES ONLY IN " + name + ": " + str(len(unique)))
        for t in sorted(unique):
            print("    - " + t)

for i, db1 in enumerate(db_names):
    for db2 in db_names[i+1:]:
        only1 = all_tables[db1] - all_tables[db2]
        only2 = all_tables[db2] - all_tables[db1]
        common = all_tables[db1] & all_tables[db2]
        print()
        print("  " + db1 + " vs " + db2 + ": Common=" + str(len(common)) + " Only-" + db1 + "=" + str(len(only1)) + " Only-" + db2 + "=" + str(len(only2)))
        if only1:
            print("    Only in " + db1 + ": " + str(sorted(only1)))
        if only2:
            print("    Only in " + db2 + ": " + str(sorted(only2)))

print()
print(SEP)
print("  COMPARISON 2: FIELD NAMES (common tables only)")
print(SEP)

field_mismatches = []

for tname in sorted(common_all):
    field_sets = {}
    field_types = {}
    for db_name in db_names:
        fields = schemas[db_name][tname]["fields"]
        field_sets[db_name] = {f["name"] for f in fields}
        field_types[db_name] = {f["name"]: f["type"] for f in fields}

    fields_common = field_sets[db_names[0]] & field_sets[db_names[1]] & field_sets[db_names[2]]

    has_mismatch = False
    for db_name in db_names:
        if field_sets[db_name] - fields_common:
            has_mismatch = True

    type_diffs = []
    for fname in sorted(fields_common):
        types = {db: field_types[db].get(fname) for db in db_names}
        if len(set(types.values())) > 1:
            type_diffs.append((fname, types))
            has_mismatch = True

    if has_mismatch:
        field_mismatches.append(tname)
        print()
        print("  TABLE: " + tname)
        for db_name in db_names:
            missing = field_sets[db_name] - fields_common
            if missing:
                print("    Fields missing from " + db_name + ": " + str(sorted(missing)))
        if type_diffs:
            print("    Type mismatches:")
            for fname, types in type_diffs:
                print("      " + fname + ":")
                for db, typ in types.items():
                    print("        " + db + ": " + str(typ))

if not field_mismatches:
    print()
    print("  + All common tables have identical field names and types.")
else:
    print()
    print("  " + str(len(field_mismatches)) + " of " + str(len(common_all)) + " common tables have field mismatches.")

print()
print(SEP)
print("  COMPARISON 3: DATE/TIME SETTINGS")
print("  Standard required: UTC | ISO format | 24-hour")
print(SEP)

date_field_issues = []
total_date_fields = 0

for db_name in db_names:
    print()
    print("  -- " + db_name + " --")
    db_has_issues = False
    for tname, tdata in schemas[db_name].items():
        for f in tdata["fields"]:
            if f["type"] == "date":
                total_date_fields += 1
                issues = []
                fmt = f.get("date_format")
                include_time = f.get("date_include_time")
                time_fmt = f.get("date_time_format")
                force_tz = f.get("date_force_timezone")

                if fmt != "ISO":
                    issues.append("date_format=" + str(fmt) + " (expected ISO)")
                if include_time and time_fmt != "24":
                    issues.append("date_time_format=" + str(time_fmt) + " (expected 24)")
                if force_tz != "UTC":
                    issues.append("date_force_timezone=" + str(force_tz) + " (expected UTC)")

                if issues:
                    db_has_issues = True
                    date_field_issues.append({
                        "database": db_name, "table": tname, "field": f["name"],
                        "field_id": f["id"], "date_format": fmt,
                        "date_include_time": include_time, "date_time_format": time_fmt,
                        "date_force_timezone": force_tz, "date_show_tzinfo": f.get("date_show_tzinfo"),
                        "issues": issues,
                    })
                    print("    X [" + tname + "] " + f["name"] + " (id=" + str(f["id"]) + ")")
                    for issue in issues:
                        print("       " + issue)
    if not db_has_issues:
        print("    + All date fields compliant.")

print()
print("  -- SUMMARY --")
print("  Total date fields across all databases: " + str(total_date_fields))
print("  Date fields with compliance issues: " + str(len(date_field_issues)))
print("  Date fields compliant: " + str(total_date_fields - len(date_field_issues)))

print()
print(SEP)
print("  FINAL VERDICT")
print(SEP)

table_issues = sum(len(all_tables[db] - common_all) for db in db_names)
print("  Table name mismatches: " + str(table_issues))
print("  Field name/type mismatches: " + str(len(field_mismatches)) + " tables affected")
print("  Date/time compliance issues: " + str(len(date_field_issues)))
print()

if table_issues == 0 and len(field_mismatches) == 0 and len(date_field_issues) == 0:
    print("  + ALL CLEAR: All three databases are fully aligned.")
else:
    print("  X ISSUES FOUND: See details above.")

with open("/tmp/bare_date_field_issues.json", "w") as f:
    json.dump(date_field_issues, f, indent=2, default=str)
print()
print("  Date field issues saved to: /tmp/bare_date_field_issues.json")
