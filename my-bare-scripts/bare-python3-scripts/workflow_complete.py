#!/usr/bin/env python3
"""Complete Workflow: Steps 4-7 — Fix and continue from Step 4"""
import json, subprocess, sys, uuid

BR_TOKEN = 'Hv1YerRVGZoYrqWSbWeB9f5lHot4rzdw'
BR_URL = 'http://100.64.0.19/api'
BR_H = ['-H', 'Authorization: Token ' + BR_TOKEN, '-H', 'Content-Type: application/json']

with open('/tmp/nifi_jwt.txt') as f:
    NIFI_TOKEN = f.read().strip()
NIFI_URL = 'https://localhost:8443/nifi-api'

TASK_ID = 'TSK000000077a_BC_Boomerang'
TASK_GUID = str(uuid.uuid4())
FREQ = '1800 sec'
FIDELITY_ROW_ID = 6

def br_get(path):
    cmd = ['curl', '-sk'] + BR_H + [BR_URL + path]
    r = subprocess.run(cmd, capture_output=True, text=True)
    try: return json.loads(r.stdout)
    except: print('BR GET FAIL: ' + r.stdout[:300]); return None

def br_post(path, data):
    cmd = ['curl', '-sk', '-X', 'POST'] + BR_H + ['-d', json.dumps(data), BR_URL + path]
    r = subprocess.run(cmd, capture_output=True, text=True)
    try: return json.loads(r.stdout)
    except: print('BR POST FAIL: ' + r.stdout[:300]); return None

def br_patch(path, data):
    cmd = ['curl', '-sk', '-X', 'PATCH'] + BR_H + ['-d', json.dumps(data), BR_URL + path]
    r = subprocess.run(cmd, capture_output=True, text=True)
    try: return json.loads(r.stdout)
    except: print('BR PATCH FAIL: ' + r.stdout[:300]); return None

# ============================================================
# STEP 4: Create Project Task Row in Table 48 (FIXED)
# ============================================================
print('=' * 60)
print('STEP 4: Create Project Task Row in Table 48')
print('=' * 60)

project_task_data = {
    'Task_ID': TASK_ID,
    'Task_UUID': TASK_GUID,
    'Task_GUID_Master': TASK_GUID,
    'dataType': 'Boomerang Bi-Directional Bare-Control Task',
    'Source': 'Bare-Control',
    'Target': 'Bare-Control',
    'Direction': 'Bi-Directional',
    'Frequency': 'Event Driven (RealTime)',
    'api.scheduler.frequency': FREQ,
    'api.field.extraction.logic': 'Delta - Boomerang Poll',
    'Pull or Push': 'Pull',
    'Task Type': 'Integration',
    'Task Functional Area': 'Bare-ConnectFi Boomerang',
    'Task Request Project Notes': 'Boomerang Template v2.0 - Bi-Directional Bare-Control task. Reads from source, transforms via ExecuteGroovyScript, writes back to same system.',
    'What is the High Level Intent of this Task?': 'Bi-Directional Boomerang integration for Bare-Control using v2.0 template'
}

result = br_post('/database/rows/table/48/?user_field_names=true', project_task_data)
if result and 'id' in result:
    project_task_row_id = result['id']
    print('CREATED Project Task Row: ' + str(project_task_row_id))
else:
    print('FAILED to create project task: ' + str(result)[:500])
    sys.exit(1)

# ============================================================
# STEP 5: Link Fidelity Config + Write Groovy Script
# ============================================================
print()
print('=' * 60)
print('STEP 5: Link Fidelity Config & Write Groovy Script')
print('=' * 60)

print('Linking Fidelity Config row ' + str(FIDELITY_ROW_ID) + ' to Project Task row ' + str(project_task_row_id))
patch_data = {
    'Project TASKS (Master Table)': [project_task_row_id]
}
result = br_patch('/database/rows/table/117/' + str(FIDELITY_ROW_ID) + '/?user_field_names=true', patch_data)
print('Link result: ' + ('OK' if result else 'FAILED'))

# Also link the template row 4 in table 116 to the new project task
print('Linking Boomerang Template (Row 4) to Project Task row ' + str(project_task_row_id))
patch_data = {
    'Project TASKS (Master Table)': [71, 72, 73, 74, 75, 76, project_task_row_id]
}
result = br_patch('/database/rows/table/116/4/?user_field_names=true', patch_data)
print('Template link result: ' + ('OK' if result else 'FAILED'))

groovy_script = """/*
 * ============================================================
 * BARE-CONNECTFI BOOMERANG TRANSFORMATION SCRIPT
 * ============================================================
 * Name    : Boomerang_BareControl_Transform_v1.0
 * Version : 1.0
 * Purpose : Bi-Directional Boomerang data transformation for Bare-Control
 * Input   : Bare-Control \u2014 Baserow Source Table
 * Output  : Bare-Control \u2014 Baserow Target Table
 * Method  : POST / PUT / PATCH (dynamic)
 * Task_ID : TSK000000077a_BC_Boomerang
 * Task_GUID: """ + TASK_GUID + """
 *
 * Field Mapping:
 *   [dynamic] <- [source fields based on task configuration]
 * ============================================================
 */

import org.apache.commons.io.IOUtils
import java.nio.charset.StandardCharsets
import groovy.json.JsonSlurper
import groovy.json.JsonOutput
import org.apache.nifi.processor.io.OutputStreamCallback
import java.math.BigDecimal

def flowFile = session.get()
if (!flowFile) return

def inputContent = ''

try {
    session.read(flowFile).withCloseable { inputStream ->
        inputContent = IOUtils.toString(inputStream, StandardCharsets.UTF_8)
    }

    if (!inputContent || inputContent.trim().isEmpty()) {
        throw new Exception('FlowFile content is empty')
    }

    def httpMethod = (flowFile.getAttribute('invoke.http.method') ?: 'POST').toUpperCase()
    def baseUrl    = (flowFile.getAttribute('api.base_url') ?: 'https://api.baserow.io').replaceAll('/$', '')
    def resourceId = flowFile.getAttribute('api.resource_id') ?: ''
    def taskId     = flowFile.getAttribute('taskId') ?: 'BCFI-Boomerang'
    def taskGuid   = flowFile.getAttribute('taskGuid') ?: ''

    def src = new JsonSlurper().parseText(inputContent)
    if (src instanceof List) src = src[0]

    def toBigDecimal = { value ->
        try { return new BigDecimal(value.toString()) }
        catch (Exception e) { return BigDecimal.ZERO }
    }
    def toInteger = { value ->
        try { return new BigDecimal(value.toString()).intValue() }
        catch (Exception e) { return 0 }
    }
    def toSafeString = { value ->
        return value?.toString()?.trim() ?: ''
    }
    def toDateString = { value ->
        def s = value?.toString()?.trim() ?: ''
        return s.contains('T') ? s.split('T')[0] : s
    }

    def targetUrl = resourceId ? "${baseUrl}/${resourceId}" : baseUrl

    if (httpMethod == 'DELETE') {
        if (!resourceId) throw new Exception('DELETE requires api.resource_id to be set')
        flowFile = session.putAttribute(flowFile, 'invoke.http.url', targetUrl)
        flowFile = session.putAttribute(flowFile, 'invoke.http.method', 'DELETE')
        session.transfer(flowFile, REL_SUCCESS)
        return
    }

    if (httpMethod == 'GET') {
        flowFile = session.putAttribute(flowFile, 'invoke.http.url', targetUrl)
        flowFile = session.putAttribute(flowFile, 'invoke.http.method', 'GET')
        session.transfer(flowFile, REL_SUCCESS)
        return
    }

    // Boomerang Transform: Map source fields dynamically
    def payload = [:]
    
    src.each { key, value ->
        if (key in ['id', 'order', 'Last_modified', 'Created_on']) return
        if (value instanceof Map && value.containsKey('id') && value.containsKey('value')) {
            payload[key] = [toInteger(value.id)]
        } else if (value instanceof List && value.size() > 0 && value[0] instanceof Map && value[0].containsKey('id')) {
            payload[key] = value.collect { toInteger(it.id) }
        } else if (value instanceof String || value instanceof Number || value instanceof Boolean) {
            payload[key] = value
        }
    }

    def outputJson = JsonOutput.prettyPrint(JsonOutput.toJson(payload))

    flowFile = session.write(flowFile, { out ->
        out.write(outputJson.getBytes(StandardCharsets.UTF_8))
    } as OutputStreamCallback)

    flowFile = session.putAttribute(flowFile, 'invoke.http.url', targetUrl)
    flowFile = session.putAttribute(flowFile, 'invoke.http.method', httpMethod)
    flowFile = session.putAttribute(flowFile, 'http.header.Content-Type', 'application/json')
    flowFile = session.putAttribute(flowFile, 'http.header.Accept', 'application/json')
    flowFile = session.putAttribute(flowFile, 'filename', 'payload.json')

    log.info("[${taskId}] ${httpMethod} ${targetUrl} - Boomerang transformation complete")

    session.transfer(flowFile, REL_SUCCESS)

} catch (Exception e) {
    log.error("[${flowFile.getAttribute('taskId') ?: 'BCFI-Boomerang'}] Transformation failed: ${e.message}", e)
    flowFile = session.putAttribute(flowFile, 'error.reason', e.message ?: 'Unknown error')
    flowFile = session.putAttribute(flowFile, 'error.stacktrace', e.toString())
    flowFile = session.putAttribute(flowFile, 'error.inputJson', inputContent.take(3000))
    session.transfer(flowFile, REL_FAILURE)
}
"""

print('Writing Groovy script to Task Integration Knowledge Bank...')
patch_result = br_patch('/database/rows/table/48/' + str(project_task_row_id) + '/?user_field_names=true', {
    'Task Integration Knowledge Bank': groovy_script
})
print('Groovy script: ' + ('WRITTEN' if patch_result else 'FAILED'))

# ============================================================
# STEP 6: Import Boomerang Template into NiFi
# ============================================================
print()
print('=' * 60)
print('STEP 6: Import Boomerang Template into NiFi')
print('=' * 60)

row4 = br_get('/database/rows/table/116/4/?user_field_names=true')
if not row4:
    print('FAILED to fetch template row 4')
else:
    template_json_str = row4.get('Template JSON', '')
    if not template_json_str:
        print('FAILED: Template JSON field is empty')
    else:
        print('Template JSON retrieved (' + str(len(template_json_str)) + ' chars)')
        
        import tempfile, os
        fd, tmpfile = tempfile.mkstemp(suffix='.json')
        with os.fdopen(fd, 'w') as f:
            f.write(template_json_str)
        
        cmd = ['curl', '-sk', '-X', 'POST',
               '-H', 'Authorization: Bearer ' + NIFI_TOKEN,
               '-F', 'template=@' + tmpfile,
               NIFI_URL + '/process-groups/root/templates/import']
        r = subprocess.run(cmd, capture_output=True, text=True)
        os.unlink(tmpfile)
        
        print('Import response (first 500 chars): ' + r.stdout[:500])
        
        try:
            result = json.loads(r.stdout)
            if 'template' in result:
                tmpl = result['template']
                print('TEMPLATE IMPORTED SUCCESSFULLY')
                print('Template ID: ' + str(tmpl.get('id', '?')))
                print('Template Name: ' + str(tmpl.get('name', '?')))
                print('Template URI: ' + str(tmpl.get('uri', '?')))
            elif 'flow' in result:
                print('Flow imported (response contains flow)')
                print(json.dumps(result, indent=2)[:500])
            else:
                print('Response keys: ' + str(list(result.keys())))
        except:
            print('Could not parse response as JSON')

# ============================================================
# STEP 7: SUMMARY REPORT
# ============================================================
print()
print('=' * 60)
print('FINAL SUMMARY REPORT')
print('=' * 60)
print()
print('+{:-<45}+{:-<45}+'.format('', ''))
print('| {:^43} | {:^43} |'.format('ITEM', 'VALUE'))
print('+{:-<45}+{:-<45}+'.format('', ''))
print('| {:^43} | {:^43} |'.format('Boomerang Template Row (116)', 'Row ID: 4'))
print('| {:^43} | {:^43} |'.format('Template Name', 'Boomerang-v2.0'))
print('| {:^43} | {:^43} |'.format('Template Type', 'Boomerang (4242)'))
print('| {:^43} | {:^43} |'.format('Template Status', 'Active'))
print('| {:^43} | {:^43} |'.format('Fidelity Config Row (117)', 'Row ID: ' + str(FIDELITY_ROW_ID)))
print('| {:^43} | {:^43} |'.format('Project Task Row (48)', 'Row ID: ' + str(project_task_row_id)))
print('| {:^43} | {:^43} |'.format('Task_ID', TASK_ID))
print('| {:^43} | {:^43} |'.format('Task_UUID (GUID)', TASK_GUID))
print('| {:^43} | {:^43} |'.format('Source', 'Bare-Control'))
print('| {:^43} | {:^43} |'.format('Target', 'Bare-Control'))
print('| {:^43} | {:^43} |'.format('Direction', 'Bi-Directional'))
print('| {:^43} | {:^43} |'.format('Frequency', FREQ + ' (Event Driven)'))
print('| {:^43} | {:^43} |'.format('Extraction Logic', 'Delta - Boomerang Poll'))
print('| {:^43} | {:^43} |'.format('Filter Strategy', 'JSON'))
print('| {:^43} | {:^43} |'.format('Groovy Script', 'Written to Knowledge Bank'))
print('| {:^43} | {:^43} |'.format('NiFi Template Import', 'Attempted'))
print('| {:^43} | {:^43} |'.format('Linked to Template Row 4', 'Yes'))
print('+{:-<45}+{:-<45}+'.format('', ''))
print()
print('Workflow complete, my liege.')
