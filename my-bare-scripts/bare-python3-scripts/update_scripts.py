#!/usr/bin/env python3
"""Update the supplier invoice flow processors with proper Groovy scripts."""
import json, subprocess, sys

NIFI_URL = "https://localhost:8443/nifi-api"
L5_ID = "8a111903-019e-1000-6700-95152e42db64"

# Processor IDs from the build
DYN_API_ID = "8a11197b-019e-1000-b1f2-5b63642a5a67"
TRANSFORMER_ID = "8a111a00-019e-1000-6e3a-ccf8f876a0af"

with open('/tmp/nifi_jwt.txt') as f:
    TOKEN = f.read().strip()

def api(method, path, data=None):
    cmd = ["curl", "-sk", "-H", "Authorization: Bearer " + TOKEN, "-H", "Content-Type: application/json", "-X", method]
    if data:
        cmd += ["-d", json.dumps(data)]
    cmd.append(NIFI_URL + path)
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.stdout.strip():
        try:
            return json.loads(result.stdout)
        except:
            print("  RAW: " + result.stdout[:200])
            return None
    return None

def update_processor(proc_id, properties):
    """Update processor properties with revision handling."""
    proc = api("GET", "/processors/" + proc_id)
    if not proc:
        print("  FAILED to get processor " + proc_id)
        return False
    rev = proc.get("revision", {}).get("version", 0)
    comp = proc.get("component", {})
    existing_props = comp.get("config", {}).get("properties", {})
    existing_props.update(properties)
    payload = {
        "revision": {"version": rev},
        "component": {
            "id": proc_id,
            "config": {"properties": existing_props}
        }
    }
    result = api("PUT", "/processors/" + proc_id, payload)
    if result:
        print("  Updated: " + comp.get("name", "?") + " rev " + str(rev) + " -> " + str(result.get("revision",{}).get("version","?")))
        return True
    print("  UPDATE FAILED for " + comp.get("name", "?"))
    return False

# ═══════════════════════════════════════════════════════════════════════════════

# 1. Extract Dynamic API Request Builder script from existing canvas
print("[*] Extracting Dynamic API Request Builder script from existing canvas...")
extract_cmd = ["grep", "-oP", '"groovyx-script-body":\s*"/\*[^"]*Dynamic API Request Builder[^"]*Full CRUD[^"]*"', 
               "/home/bare-ai/bare-connectfi/Bare-ConnectFi_Canvases/IMPL_Environment.json"]
# The script is too long to extract this way - let's find it differently

# Use Python to extract from JSON
import re
with open('/home/bare-ai/bare-connectfi/Bare-ConnectFi_Canvases/IMPL_Environment.json') as f:
    content = f.read()

# Find the script body
pattern = r'"groovyx-script-body":\s*"((?:[^"\]|\.)*Dynamic API Request Builder v1\.9[\s\S]*?Full CRUD[\s\S]*?)(?<!\)"'
# The script body is inside escaped JSON string - need to handle this differently

# Just search for the start position and extract manually
start_marker = "Dynamic API Request Builder v1.9 - Full CRUD"
idx = content.find(start_marker)
if idx > 0:
    # Go back to find the property start
    prop_start = content.rfind('"groovyx-script-body"', 0, idx)
    if prop_start > 0:
        # Find the opening quote after the colon
        colon = content.find(':', prop_start)
        quote_start = content.find('"', colon) + 1
        # Now we need to find the closing quote - but the script has escaped quotes
        # The script ends with a closing quote before the next property or comma
        # Strategy: look for '",' followed by next property pattern
        # Actually the script bodies are stored as JSON-escaped strings
        # Let's find the end by looking for the pattern after the script
        end_marker = '"schedulingPeriod"'
        end_idx = content.find(end_marker, idx)
        if end_idx > 0:
            # Go backwards from end_marker to find the closing quote
            close_quote = content.rfind('"', 0, end_idx)
            script_body = content[quote_start:close_quote]
            # Unescape JSON
            script_body = script_body.replace('"', '"').replace('
', '
').replace('	', '	').replace('', '')
            print("  Extracted Dynamic API script: " + str(len(script_body)) + " chars")
            with open('/tmp/dyn_api_script.groovy', 'w') as f:
                f.write(script_body)
            print("  Saved to /tmp/dyn_api_script.groovy")
        else:
            print("  Could not find end marker")
    else:
        print("  Could not find property start")
else:
    print("  Could not find start marker")

# 2. Write the Supplier Bill Transformer script
print("")
print("[*] Writing Supplier Bill Transformer script...")

TRANSFORMER = r"""/*
 * ==========================================================================================
 * NiFi Groovy Script: FreeAgent Supplier Bill to BaseRow Transformer (v1.0)
 * ==========================================================================================
 * Purpose:
 * Transforms FreeAgent /v2/bills JSON -> BaseRow Supplier Invoice payload.
 *
 * Mapping:
 *   freeAgentBillURL           <- FreeAgent bill URL
 *   Supplier Contact URL (freeAgent) <- FreeAgent contact URL  
 *   Invoice Reference          <- reference
 *   Invoice Date               <- dated_on
 *   Payment Due Date           <- due_on
 *   Invoice Paid Date          <- paid_on
 *   Status                     <- status
 *   Total Price (Ex VAT)       <- total_value (or total_value_ex_tax if present)
 *   Last Modified (FreeAgent)  <- updated_at
 *   Created At (FreeAgent)     <- created_at
 *   Connectify_Task-Object_DeveloperSummaryLogs <- "Created by Bare-ConnectFi IDK"
 *   Connectify_Task-Object_API-Body-Response    <- Raw JSON of the bill
 *   Connectify_Task-Object_In_Error?            <- false
 *   Connectify_Task-Object_API-Http-Response-Code <- (set by upstream InvokeHTTP)
 *
 * Contact Resolution (v1.0): Store FreeAgent contact URL as text.
 * A compliance log note is added for manual contact resolution.
 */

import org.apache.nifi.processor.io.StreamCallback
import groovy.json.JsonSlurper
import groovy.json.JsonOutput
import java.nio.charset.StandardCharsets

def REL_SUCCESS = context.getAvailableRelationships().find { it.name == 'success' }
def REL_FAILURE = context.getAvailableRelationships().find { it.name == 'failure' }

def flowFile = session.get()
if (!flowFile) return

try {
    // Read FlowFile content
    flowFile = session.write(flowFile, { inputStream, outputStream ->
        def text = inputStream.getText(StandardCharsets.UTF_8.name())
        def bill = new JsonSlurper().parseText(text)
        
        if (!bill) throw new Exception("No bill data found in FlowFile content")
        
        // Build BaseRow row payload
        def row = [:]
        
        // Identity and URLs
        row.put("freeAgentBillURL", bill.url ?: "")
        row.put("Supplier Contact URL (freeAgent)", bill.contact ?: "")
        
        // Invoice details
        row.put("Invoice Reference", bill.reference ?: "")
        row.put("Invoice Date", bill.dated_on ?: "")
        row.put("Payment Due Date", bill.due_on ?: "")
        row.put("Invoice Paid Date", bill.paid_on ?: "")
        row.put("Status", bill.status ?: "")
        
        // Financial
        // Prefer total_value_ex_tax if present, else use total_value
        def totalExVat = bill.total_value_ex_tax ?: bill.total_value
        row.put("Total Price (Ex VAT)", totalExVat ? totalExVat.toString() : "")
        
        // Timestamps
        row.put("Last Modified (FreeAgent)", bill.updated_at ?: "")
        row.put("Created At (FreeAgent)", bill.created_at ?: "")
        
        // Connectify metadata fields
        row.put("Connectify_Task-Object_DeveloperSummaryLogs", "Created by Bare-ConnectFi IDK: FreeAgent Supplier Bills Delta Import. taskId=${flowFile.getAttribute('taskId')}")
        row.put("Connectify_Task-Object_API-Body-Response", JsonOutput.toJson(bill))
        row.put("Connectify_Task-Object_In_Error?", false)
        row.put("Connectify_Task-Object_API-Http-Response-Code", flowFile.getAttribute("invoke.http.status.code") ?: "")
        
        // Compliance: flag contact for manual resolution
        def complianceNote = "Supplier contact stored as FreeAgent URL. Manual resolution may be required to link to Bare-Finance contact record."
        row.put("Compliance Log", complianceNote)
        
        outputStream.write(JsonOutput.toJson(row).getBytes(StandardCharsets.UTF_8))
        
    } as StreamCallback)
    
    session.transfer(flowFile, REL_SUCCESS)
    
} catch (e) {
    log.error("Supplier Bill Transformer Error", e)
    flowFile = session.putAttribute(flowFile, "error.reason", e.getMessage())
    session.transfer(flowFile, REL_FAILURE)
}
"""

with open('/tmp/transformer_script.groovy', 'w') as f:
    f.write(TRANSFORMER)
print("  Transformer script written (" + str(len(TRANSFORMER)) + " chars)")

# 3. Update the processors via NiFi API
print("")
print("[*] Updating Dynamic API Request Builder processor...")
if update_processor(DYN_API_ID, {"groovyx-script-body": open('/tmp/dyn_api_script.groovy').read()}):
    print("  SUCCESS: Dynamic API Builder script updated")

print("")
print("[*] Updating Supplier Bill Transformer processor...")
if update_processor(TRANSFORMER_ID, {"groovyx-script-body": TRANSFORMER}):
    print("  SUCCESS: Transformer script updated")

print("")
print("DONE: Scripts deployed to Level 5 processors")
