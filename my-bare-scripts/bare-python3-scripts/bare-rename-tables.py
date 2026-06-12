import json, urllib.request, time

# Auth
data = json.dumps({"email": "***REMOVED***", "password": "***REMOVED***"}).encode()
req = urllib.request.Request("http://100.64.0.19/api/user/token-auth/", data=data, headers={"Content-Type": "application/json"})
with urllib.request.urlopen(req) as r:
    TOKEN = json.loads(r.read())["token"]

RENAMES = [
    # Bare-Control (DB=3)
    (70, "Corporation Organizations", "Corporate Organization"),
    # Bare-Talent (DB=7) — remove suffixes + align with Bare-Finance master names
    (158, "Corporate Organization Hierarchy (Master Table)", "Corporate Organization"),
    (159, "Job Catalogue (Master Table)", "Job Catalogue"),
    (160, "Position Restrictions (Master Table)", "Position Restrictions"),
    (161, "Job Requisitions (Master Table)", "Job Requisitions"),
    (163, "Candidates (Master Table)", "Candidates"),
    (164, "Job Applications (Master Table)", "Job Applications"),
    (165, "Workers (Master Table)", "Workers"),
    (166, "Timesheet Entries (Master Table)", "Timesheet Entries"),
    (167, "Timesheet Reports (Master Table) (Rev.S)", "Timesheet Reports (Rev.S)"),
    (168, "Expense Entries (Master Table)", "Expenses"),
    (169, "Expense Reports (Master Table)", "Expense Reports"),
    (170, "Signed NDAs (Master Table)", "Signed NDAs"),
    (171, "Bank Holidays Tracker (Master Table) (Metadata)", "Bank Holidays Tracker"),
    (172, "Projects (Sync Table)", "Stakeholder Projects"),
    (173, "Time or Expense Related - Sales Orders (Sync Table)", "Stakeholder Customer Sales Orders"),
    (174, "All Service / Product Lines (Synce Table)", "Service / Product"),
    (177, "Financial Organizations Hierarchy (Cost Centers) (Sync Table)", "Financial Organizations"),
    (178, "Stakeholder - Acc (SyncTable)", "Stakeholder Account"),
    (179, "Stakeholder - Representatives (SyncTable)", "Stakeholder - Representatives"),
    (187, "Solar Settings Table", "Solar_Settings"),
    (190, "List of Countries (ISO 3166-1) (Sync Table)", "Country (ISO 3166-1)"),
]

print("=== TABLE RENAME OPERATION ===")
print("Bare-Finance is the MASTER for table names.")
print("Total renames: " + str(len(RENAMES)))
print()

ok = 0
fail = 0
skipped = 0

for tid, old_name, new_name in RENAMES:
    payload = json.dumps({"name": new_name}).encode()
    req = urllib.request.Request(
        "http://100.64.0.19/api/database/tables/" + str(tid) + "/",
        data=payload,
        headers={"Authorization": "JWT " + TOKEN, "Content-Type": "application/json"},
        method="PATCH"
    )
    try:
        with urllib.request.urlopen(req) as r:
            resp = json.loads(r.read())
            if "detail" in resp:
                print("FAIL [" + str(tid) + "] " + old_name + " -> " + new_name + " | " + str(resp.get("detail")))
                fail += 1
            else:
                print("OK   [" + str(tid) + "] " + old_name)
                print("     -> " + new_name)
                ok += 1
    except Exception as e:
        print("ERR  [" + str(tid) + "] " + old_name + " -> " + new_name + " | " + str(e))
        fail += 1
    time.sleep(0.06)

print()
print("============================================================")
print("  RENAME COMPLETE")
print("  OK: " + str(ok) + "  Failed: " + str(fail) + "  Skipped: " + str(skipped))
print("============================================================")
