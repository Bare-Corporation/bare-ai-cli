#!/usr/bin/env python3
"""Steps 6-7: Currency lookups + Unit of Measure Object formula field."""
import sys
sys.path.insert(0, '/home/bare-ai/bare-ai-cli/my-bare-scripts/bare-python3-scripts')
from patch_helper import api_get, api_post

# ============================================================
# STEP 6: Check for Country link_row in Legal Entity
# ============================================================
print("=== STEP 6: Currency Lookup Fields ===")
print("Checking Legal Entity fields for Country link_row...")

le_fields = api_get("/database/fields/table/67/")
link_row_id = None
country_field_id = None
for f in le_fields:
    name = f.get("name", "")
    ftype = f.get("type", "")
    fid_val = f.get("id")
    # Find any link_row or field referencing Country
    if ftype == "link_row":
        print("  LINK_ROW: " + str(fid_val) + " | " + name + " | " + ftype)
        # Check the link_row target table name
        lr_table_id = f.get("link_row_table_id")
        if lr_table_id:
            try:
                table_info = api_get("/database/tables/" + str(lr_table_id) + "/")
                print("    -> links to table: " + table_info.get("name", "?"))
                if "country" in table_info.get("name", "").lower():
                    link_row_id = fid_val
                    country_field_id = fid_val  # same field
            except:
                pass
    if "country" in name.lower() and ftype == "link_row":
        link_row_id = fid_val
        country_field_id = fid_val
        print("  FOUND Country link_row: field_id=" + str(link_row_id))

if link_row_id:
    print("")
    print("Creating Currency Code (from Country) lookup...")
    try:
        api_post("/database/fields/67/", {
            "name": "Currency Code (from Country)",
            "type": "lookup",
            "through_field_id": link_row_id,
            "target_field_name": "Currency Code"
        })
    except Exception as e:
        print("  ERROR: " + str(e))

    print("Creating Currency Symbol (from Country) lookup...")
    try:
        api_post("/database/fields/67/", {
            "name": "Currency Symbol (from Country)",
            "type": "lookup",
            "through_field_id": link_row_id,
            "target_field_name": "Currency Symbol"
        })
    except Exception as e:
        print("  ERROR: " + str(e))

    print("Creating Country ISO 3 Numeric (from Country) lookup...")
    try:
        api_post("/database/fields/67/", {
            "name": "Country ISO 3 Numeric (from Country)",
            "type": "lookup",
            "through_field_id": link_row_id,
            "target_field_name": "Country ISO 3 Numeric"
        })
    except Exception as e:
        print("  ERROR: " + str(e))
else:
    print("")
    print("NO link_row to Country found in BC Legal Entity.")
    print("Available fields:")
    for f in le_fields:
        print("  " + str(f["id"]) + " | " + f["name"] + " | " + f["type"])

# ============================================================
# STEP 7: Unit of Measure Object formula
# ============================================================
print("")
print("=== STEP 7: Unit of Measure Object Formula ===")

# Check what fields exist in BC Units of Measure (table 76)
uom_fields = api_get("/database/fields/table/76/")
print("BC Units of Measure fields:")
for f in uom_fields:
    print("  " + str(f["id"]) + " | " + f["name"] + " | " + f["type"])

# Check if formula field already exists
formula_exists = any(f["name"] == "Unit of Measure Object" for f in uom_fields)
if formula_exists:
    print("Unit of Measure Object already exists!")
else:
    # Get formula from BF - check what fields are available
    print("")
    print("Creating Unit of Measure Object formula field...")
    try:
        api_post("/database/fields/76/", {
            "name": "Unit of Measure Object",
            "type": "formula",
            "formula": "CONCAT(field('Unit of Measure'),'\u001f',field('Unit of Measure Category'))",
            "formula_type": "text"
        })
        print("Created.")
    except Exception as e:
        print("ERROR: " + str(e))
        # Try alternative field references
        try:
            api_post("/database/fields/76/", {
                "name": "Unit of Measure Object",
                "type": "formula",
                "formula": "concat(field('Unit of Measure'), ' - ', field('Unit of Measure Category'))",
                "formula_type": "text"
            })
            print("Created with alternate formula.")
        except Exception as e2:
            print("ERROR with alternate: " + str(e2))

print("")
print("=== Steps 6-7 Complete ===")
