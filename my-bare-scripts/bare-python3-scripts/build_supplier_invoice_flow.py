#!/usr/bin/env python3
"""
Build FreeAgent Supplier Invoice -> BaseRow integration on NiFi canvas.
Level 3, 4, 5 process groups + all processors inside Level 5.
"""
import json, subprocess, sys, time, uuid, tempfile, os

# Auth
with open('/tmp/nifi_jwt.txt') as f:
    TOKEN = f.read().strip()

NIFI = 'https://localhost:8443/nifi-api'
HEADERS = ['-sk', '-H', 'Authorization: Bearer ' + TOKEN, '-H', 'Content-Type: application/json']

def api(method, path, data=None):
    cmd = ['curl'] + HEADERS + ['-X', method]
    if data:
        cmd += ['-d', json.dumps(data)]
    cmd.append(NIFI + path)
    r = subprocess.run(cmd, capture_output=True, text=True)
    try:
        body = json.loads(r.stdout) if r.stdout.strip() else {}
    except:
        body = r.stdout
    return r.returncode, body

def pg_url(pg_id):
    return '/flow/process-groups/' + pg_id

def create_pg(parent_id, name, x, y):
    flow_def = {
        "flowContents": {
            "identifier": str(uuid.uuid4()),
            "name": name,
            "processors": [], "connections": [], "processGroups": [],
            "inputPorts": [], "outputPorts": [], "funnels": [], "remoteProcessGroups": []
        }
    }
    fd, tmpfile = tempfile.mkstemp(suffix='.json')
    with os.fdopen(fd, 'w') as f:
        json.dump(flow_def, f)
    
    cmd = ['curl', '-sk', '-H', 'Authorization: Bearer ' + TOKEN, '-X', 'POST',
           '-F', 'groupName=' + name, '-F', 'positionX=' + str(x), '-F', 'positionY=' + str(y),
           '-F', 'clientId=' + str(uuid.uuid4()), '-F', 'file=@' + tmpfile,
           NIFI + '/process-groups/' + parent_id + '/process-groups/upload']
    r = subprocess.run(cmd, capture_output=True, text=True)
    os.unlink(tmpfile)
    
    print('  Created PG: ' + name + ' (rc=' + str(r.returncode) + ')')
    
    # Extract ID from response
    if r.stdout:
        try:
            data = json.loads(r.stdout)
            if 'id' in data: return data['id']
            if 'processGroup' in data: return data['processGroup']['id']
        except: pass
    
    # Fallback: search parent's children
    time.sleep(2)
    _, flow_data = api('GET', pg_url(parent_id))
    if isinstance(flow_data, dict):
        flow = flow_data.get('processGroupFlow', {}).get('flow', {})
        for pg in flow.get('processGroups', []):
            if pg['component']['name'] == name:
                return pg['id']
    
    print('  WARNING: Could not extract PG ID for ' + name)
    return None

def get_revision(pg_id):
    _, data = api('GET', pg_url(pg_id))
    if isinstance(data, dict):
        pg = data.get('processGroupFlow', {}).get('processGroup', {})
        return pg.get('revision', {}).get('version', 0)
    return 0

def bind_parameter_context(pg_id):
    rev = get_revision(pg_id)
    payload = {
        "revision": {"version": rev},
        "component": {
            "id": pg_id,
            "parameterContext": {"id": "849adc0e-e8ba-33d2-73a9-4f47e4d670d8"}
        }
    }
    code, resp = api('PUT', '/process-groups/' + pg_id, payload)
    if code == 0:
        print('  Bound PG to master parameter context')
    else:
        print('  WARNING: Parameter context bind may need UI intervention')

def create_processor(pg_id, name, proc_type, x, y, config=None):
    payload = {
        "revision": {"version": 0},
        "component": {
            "type": proc_type,
            "name": name,
            "position": {"x": float(x), "y": float(y)}
        }
    }
    if config:
        payload["component"]["config"] = config
    
    code, resp = api('POST', '/process-groups/' + pg_id + '/processors', payload)
    if code == 0 and isinstance(resp, dict):
        pid = resp.get('id', '')
        print('    PROC: ' + name + ' [' + pid[:8] + ']')
        return pid
    else:
        print('    FAILED: ' + name + ' - ' + str(resp)[:200])
        return None

def create_connection(pg_id, source_id, dest_id, relationships):
    conn = {
        "revision": {"version": 0},
        "source": {"id": source_id, "type": "PROCESSOR", "groupId": pg_id},
        "destination": {"id": dest_id, "type": "PROCESSOR", "groupId": pg_id},
        "selectedRelationships": relationships
    }
    code, resp = api('POST', '/process-groups/' + pg_id + '/connections', conn)
    if code == 0:
        return resp.get('id', 'ok')
    else:
        print('    Connection failed: ' + str(resp)[:150])
        return None

# === BUILD ===
L2_ID = '75fab26a-e1bb-34fa-0375-4d52911a17f0'
FIRE_NEXT_TARGET = 'b4b13710-397e-38e3-bba5-d3aa2356d0e2'

print('[*] Building FreeAgent Supplier Invoice -> BaseRow Integration')
print()

# Step 1-3: Create process groups
print('[*] Creating L3...')
l3_id = create_pg(L2_ID, 'Level 3: Manage Supplier Invoices', 0, 0)
if not l3_id: sys.exit(1)
time.sleep(1)

print('[*] Creating L4...')
l4_id = create_pg(l3_id, 'Level 4: Supplier Invoicing', 0, 0)
if not l4_id: sys.exit(1)
time.sleep(1)

print('[*] Creating L5...')
l5_id = create_pg(l4_id, 'Level 5: Inbound - FreeAgent Bills Delta Sync', 0, 0)
if not l5_id: sys.exit(1)
time.sleep(1)

print('[*] Binding parameter context...')
bind_parameter_context(l5_id)
time.sleep(1)

# Step 5: Create processors
print('[*] Creating processors...')
procs = {}

GENFF_TEXT = "api.base_url = https://api.freeagent.com/v2
" + 
    "api.source_table_id = /bills
" + 
    "api.target_table_id = #{Base_Bare-Finance_SupplierInvoices_TableID}
" + 
    "api.delta.response_field = updated_at
" + 
    "api.param.sort_name.value = updated_since
" + 
    "api.filter.strategy = STANDARD
" + 
    "api.auth.method = Oauth2.0_Controller_Service
" + 
    "api.param.page_name = page
" + 
    "api.param.size_name = per_page
" + 
    "api.enable_sorting = true
" + 
    "api.scheduler.frequency = 300
" + 
    "api.seed.date = 2020-01-01T00:00:00.000Z
" + 
    "api.url.append_trailing_slash = false
" + 
    "paginationRequired? = yes
" + 
    "invoke.http.method = GET
" + 
    "taskId = TSK000000010a
" + 
    "taskGuid = SCN7x9KpQ2mVdL4zJ
" + 
    "dataType = FreeAgent Supplier Invoice Delta Sync"

VALIDATE_SCRIPT = """import org.apache.nifi.flowfile.FlowFile
def REL_SUCCESS = context.getAvailableRelationships().find { it.name == 'success' }
def REL_FAILURE = context.getAvailableRelationships().find { it.name == 'failure' }
FlowFile flowFile = session.get()
if (!flowFile) return
try {
    def freq = flowFile.getAttribute('api.scheduler.frequency')
    def freqNum = freq?.isInteger() ? freq.toInteger() : 0
    if (freqNum < 10 && freqNum > 0) throw new Exception('Delta extraction blocked: min 10s')
    if (flowFile.getAttribute('paginationRequired?') == 'yes') {
        if (!flowFile.getAttribute('api.param.page_name.value'))
            flowFile = session.putAttribute(flowFile, 'api.param.page_name.value', '1')
        if (!flowFile.getAttribute('api.param.size_name.value'))
            flowFile = session.putAttribute(flowFile, 'api.param.size_name.value', '100')
    }
    session.transfer(flowFile, REL_SUCCESS)
} catch (e) {
    log.error('[TSK000000010a] Validation: ' + e.getMessage())
    flowFile = session.putAttribute(flowFile, 'error.reason', e.getMessage())
    session.transfer(flowFile, REL_FAILURE)
}"""

DAPI_SCRIPT = """import java.net.URLEncoder
import groovy.json.JsonSlurper
import groovy.json.JsonBuilder
import org.apache.nifi.flowfile.FlowFile
def REL_SUCCESS = context.getAvailableRelationships().find { it.name == 'success' }
def REL_FAILURE = context.getAvailableRelationships().find { it.name == 'failure' }
FlowFile flowFile = session.get()
if (!flowFile) return
try {
    def baseUrl = flowFile.getAttribute('api.base_url')
    def tableId = flowFile.getAttribute('api.target_table_id') ?: flowFile.getAttribute('api.source_table_id')
    def startParam = flowFile.getAttribute('api.startingParameter') ?: ''
    def startParamVal = flowFile.getAttribute('api.startingParameter.value') ?: ''
    def filterStrategy = flowFile.getAttribute('api.filter.strategy') ?: 'JSON'
    def enableSorting = flowFile.getAttribute('api.enable_sorting') ?: 'true'
    def appendSlash = flowFile.getAttribute('api.url.append_trailing_slash') ?: 'false'
    def paramNamePage = flowFile.getAttribute('api.param.page_name') ?: 'page'
    def paramNameSize = flowFile.getAttribute('api.param.size_name') ?: 'per_page'
    def paramNameSort = flowFile.getAttribute('api.param.sort_name') ?: 'order_by'
    def httpMethod = flowFile.getAttribute('invoke.http.method') ?: 'GET'
    def isGet = httpMethod.equalsIgnoreCase('GET')
    def pageVal = flowFile.getAttribute('api.param.page_name.value') ?: '1'
    def sizeVal = flowFile.getAttribute('api.param.size_name.value') ?: '100'
    def deltaField = flowFile.getAttribute('api.param.sort_name.value')
    def lastModified = flowFile.getAttribute('api.last_modified')
    def taskId = flowFile.getAttribute('taskId')
    def cleanBase = baseUrl.endsWith('/') ? baseUrl[0..-2] : baseUrl
    def cleanTableId = tableId.startsWith('/') ? tableId[1..-1] : tableId
    if (cleanTableId.endsWith('/')) cleanTableId = cleanTableId[0..-2]
    def pathCore = cleanBase + '/' + cleanTableId
    if (appendSlash.equalsIgnoreCase('true')) { if (!pathCore.endsWith('/')) pathCore += '/' }
    else { if (pathCore.endsWith('/')) pathCore = pathCore[0..-2] }
    def finalFilterString = ''
    if (isGet) {
        if (lastModified && !lastModified.trim().isEmpty()) {
            if (!deltaField) throw new Exception('Missing Delta Field')
            def encoded = URLEncoder.encode(lastModified.trim(), 'UTF-8')
            finalFilterString = '&' + deltaField.trim() + '=' + encoded
        }
    }
    def paginationParams = ''
    if (isGet) paginationParams = '&' + paramNamePage + '=' + pageVal + '&' + paramNameSize + '=' + sizeVal
    def sortParam = ''
    if (isGet && deltaField && !deltaField.trim().isEmpty() && enableSorting.equalsIgnoreCase('true'))
        sortParam = '&' + paramNameSort + '=' + URLEncoder.encode(deltaField.trim(), 'UTF-8')
    def startQuery = startParam + startParamVal
    def paramString = paginationParams + sortParam + finalFilterString
    if (startQuery.isEmpty() && !paramString.isEmpty()) paramString = '?' + paramString[1..-1]
    def finalUrl = pathCore + startQuery + paramString
    log.info('[' + taskId + '] URL: ' + finalUrl)
    def authMethod = flowFile.getAttribute('api.auth.method')
    if (authMethod && authMethod.equalsIgnoreCase('Oauth2.0_Controller_Service')) {
        if (flowFile.getAttribute('authorization') != null)
            flowFile = session.removeAttribute(flowFile, 'authorization')
    }
    flowFile = session.putAttribute(flowFile, 'invoke.http.url', finalUrl)
    session.transfer(flowFile, REL_SUCCESS)
} catch (e) {
    log.error('[TSK000000010a] URL Error: ' + e.getMessage())
    flowFile = session.putAttribute(flowFile, 'error.reason', e.getMessage())
    session.transfer(flowFile, REL_FAILURE)
}"""

TRANSFORM_SCRIPT = """import org.apache.nifi.processor.io.StreamCallback
import groovy.json.JsonSlurper
import groovy.json.JsonOutput
import java.nio.charset.StandardCharsets
def REL_SUCCESS = context.getAvailableRelationships().find { it.name == 'success' }
def REL_FAILURE = context.getAvailableRelationships().find { it.name == 'failure' }
def flowFile = session.get()
if (!flowFile) return
try {
    flowFile = session.write(flowFile, { inputStream, outputStream ->
        def text = inputStream.getText(StandardCharsets.UTF_8.name())
        def bill = new JsonSlurper().parseText(text)
        def row = [:]
        row.put('freeAgentBillURL', bill.url ?: '')
        row.put('Supplier Contact URL (freeAgent)', bill.contact ?: '')
        row.put('Invoice Reference', bill.reference ?: '')
        row.put('Invoice Date', bill.dated_on ?: '')
        row.put('Payment Due Date', bill.due_on ?: '')
        row.put('Invoice Paid Date', bill.paid_on ?: '')
        row.put('Status', bill.status ?: '')
        row.put('Total Price (Ex VAT)', bill.total_value ? bill.total_value.toString() : '0')
        row.put('Last Modified (FreeAgent)', bill.updated_at ?: '')
        row.put('Created At (FreeAgent)', bill.created_at ?: '')
        row.put('Connectify_Task-Object_DeveloperSummaryLogs', 'TSK000000010a | ' + new java.util.Date().toString())
        row.put('Connectify_Task-Object_API-Body-Response', text)
        row.put('Connectify_Task-Object_In_Error?', false)
        row.put('Connectify_Task-Object_API-Http-Response-Code', '')
        outputStream.write(JsonOutput.toJson(row).getBytes(StandardCharsets.UTF_8))
    } as StreamCallback)
    flowFile = session.putAttribute(flowFile, 'invoke.http.method', 'POST')
    flowFile = session.putAttribute(flowFile, 'http.header.Content-Type', 'application/json')
    flowFile = session.putAttribute(flowFile, 'http.header.Accept', 'application/json')
    session.transfer(flowFile, REL_SUCCESS)
} catch (e) {
    log.error('[TSK000000010a] Transform Error: ' + e.getMessage())
    flowFile = session.putAttribute(flowFile, 'error.reason', e.getMessage())
    session.transfer(flowFile, REL_FAILURE)
}"""

# Create processors
procs['genff'] = create_processor(l5_id, 'TSK000000010a - GenerateFlowFile - FreeAgent Supplier Invoices',
    'org.apache.nifi.processors.standard.GenerateFlowFile', 0, 0,
    config={'schedulingPeriod': '300 sec', 'schedulingStrategy': 'TIMER_DRIVEN',
            'properties': {'Custom Text': GENFF_TEXT, 'File Size': '1 B', 'Batch Size': '1',
                           'Data Format': 'Text', 'Unique FlowFiles': 'false'}})

procs['validate'] = create_processor(l5_id, 'Validate Bare-Connectify Mandatory Attributes',
    'org.apache.nifi.processors.groovyx.ExecuteGroovyScript', 500, 0,
    config={'schedulingStrategy': 'TIMER_DRIVEN', 'properties': {'groovyx-script-body': VALIDATE_SCRIPT}})

procs['dynapi'] = create_processor(l5_id, 'NiFi Groovy Script: Dynamic API Request Builder v1.9 - Full CRUD',
    'org.apache.nifi.processors.groovyx.ExecuteGroovyScript', 1000, 0,
    config={'schedulingStrategy': 'TIMER_DRIVEN', 'properties': {'groovyx-script-body': DAPI_SCRIPT}})

procs['invoke_fa'] = create_processor(l5_id, 'InvokeHTTP - FreeAgent Bills API',
    'org.apache.nifi.processors.standard.InvokeHTTP', 1500, 0,
    config={'schedulingStrategy': 'TIMER_DRIVEN',
            'properties': {'HTTP Method': 'GET', 'Remote URL': '${invoke.http.url}',
                           'Connection Timeout': '30 sec', 'Read Timeout': '60 sec', 'Follow Redirects': 'true'}})

procs['route_http'] = create_processor(l5_id, 'FreeAgent_CentralRouter_HandleHTTP_Response',
    'org.apache.nifi.processors.standard.RouteOnAttribute', 2000, 0,
    config={'schedulingStrategy': 'TIMER_DRIVEN',
            'properties': {'routing-strategy': 'Route to Property name',
                           '2xx': '${invokehttp.status.code:ge(200):and(${invokehttp.status.code:lt(300)})}',
                           '4xx': '${invokehttp.status.code:ge(400):and(${invokehttp.status.code:lt(500)})}',
                           '5xx': '${invokehttp.status.code:ge(500)}',
                           'error': '${invokehttp.status.code:isEmpty()}'}})

procs['split'] = create_processor(l5_id, 'SplitJson - FreeAgent Bills Array',
    'org.apache.nifi.processors.standard.SplitJson', 2500, 0,
    config={'schedulingStrategy': 'TIMER_DRIVEN', 'properties': {'JsonPath Expression': '$.bills[*]'}})

procs['transform'] = create_processor(l5_id, 'NiFi Groovy Script: FreeAgent Supplier Bill to BaseRow Transformer',
    'org.apache.nifi.processors.groovyx.ExecuteGroovyScript', 3000, 0,
    config={'schedulingStrategy': 'TIMER_DRIVEN', 'properties': {'groovyx-script-body': TRANSFORM_SCRIPT}})

procs['upd_attr'] = create_processor(l5_id, 'UpdateAttribute - BaseRow Write Config',
    'org.apache.nifi.processors.attributes.UpdateAttribute', 3500, 0,
    config={'schedulingStrategy': 'TIMER_DRIVEN',
            'properties': {
                'api.base_url': '#{BaseRow API URL}',
                'api.target_table_id': '#{Base_Bare-Finance_SupplierInvoices_TableID}',
                'api.url.append_trailing_slash': 'true',
                'api.startingParameter': '?user_field_names=true',
                'authorization': 'Token #{NifiBareERP_PatToken_BaseRow}',
                'invoke.http.method': 'POST',
                'http.header.Content-Type': 'application/json',
                'http.header.Accept': 'application/json'
            }})

procs['invoke_br'] = create_processor(l5_id, 'InvokeHTTP - BaseRow Supplier Invoice Write',
    'org.apache.nifi.processors.standard.InvokeHTTP', 4000, 0,
    config={'schedulingStrategy': 'TIMER_DRIVEN',
            'properties': {'HTTP Method': 'POST', 'Remote URL': '${api.base_url}${api.target_table_id}/',
                           'Connection Timeout': '30 sec', 'Read Timeout': '30 sec',
                           'Content-Type': '${http.header.Content-Type}', 'Attributes to Send': '.*'}})

procs['route_br'] = create_processor(l5_id, 'BaseRow_CentralRouter_HandleHTTP_Response',
    'org.apache.nifi.processors.standard.RouteOnAttribute', 4500, 0,
    config={'schedulingStrategy': 'TIMER_DRIVEN',
            'properties': {'routing-strategy': 'Route to Property name',
                           '2xx': '${invokehttp.status.code:ge(200):and(${invokehttp.status.code:lt(300)})}',
                           '4xx': '${invokehttp.status.code:ge(400):and(${invokehttp.status.code:lt(500)})}',
                           '5xx': '${invokehttp.status.code:ge(500)}'}})

procs['log_success'] = create_processor(l5_id, 'LogMessage - Supplier Invoice Sync Success',
    'org.apache.nifi.processors.standard.LogMessage', 5000, 0,
    config={'schedulingStrategy': 'TIMER_DRIVEN',
            'properties': {'log-level': 'info', 'log-prefix': '[TSK000000010a] Supplier Invoice SUCCESS: '}})

procs['log_error'] = create_processor(l5_id, 'LogMessage - Supplier Invoice Sync Error',
    'org.apache.nifi.processors.standard.LogMessage', 4500, 400,
    config={'schedulingStrategy': 'TIMER_DRIVEN',
            'properties': {'log-level': 'error', 'log-prefix': '[TSK000000010a] ERROR: '}})

procs['log_fa_error'] = create_processor(l5_id, 'LogMessage - FreeAgent API Error',
    'org.apache.nifi.processors.standard.LogMessage', 2000, 400,
    config={'schedulingStrategy': 'TIMER_DRIVEN',
            'properties': {'log-level': 'error', 'log-prefix': '[TSK000000010a] FreeAgent API Error: '}})

print()
print('[*] Creating connections...')
time.sleep(2)

# Main flow connections
create_connection(l5_id, procs['genff'], procs['validate'], ['success'])
create_connection(l5_id, procs['validate'], procs['dynapi'], ['success'])
create_connection(l5_id, procs['validate'], procs['log_error'], ['failure'])
create_connection(l5_id, procs['dynapi'], procs['invoke_fa'], ['success'])
create_connection(l5_id, procs['dynapi'], procs['log_error'], ['failure'])
create_connection(l5_id, procs['invoke_fa'], procs['route_http'], ['Response', 'success'])
create_connection(l5_id, procs['route_http'], procs['split'], ['2xx'])
create_connection(l5_id, procs['route_http'], procs['log_fa_error'], ['4xx'])
create_connection(l5_id, procs['route_http'], procs['log_fa_error'], ['5xx'])
create_connection(l5_id, procs['route_http'], procs['log_fa_error'], ['error'])
create_connection(l5_id, procs['split'], procs['transform'], ['split'])
create_connection(l5_id, procs['split'], procs['log_error'], ['failure'])
create_connection(l5_id, procs['split'], procs['log_error'], ['original'])
create_connection(l5_id, procs['transform'], procs['upd_attr'], ['success'])
create_connection(l5_id, procs['transform'], procs['log_error'], ['failure'])
create_connection(l5_id, procs['upd_attr'], procs['invoke_br'], ['success'])
create_connection(l5_id, procs['invoke_br'], procs['route_br'], ['Response', 'success'])
create_connection(l5_id, procs['invoke_br'], procs['log_error'], ['failure'])
create_connection(l5_id, procs['route_br'], procs['log_success'], ['2xx'])
create_connection(l5_id, procs['route_br'], procs['log_error'], ['4xx'])
create_connection(l5_id, procs['route_br'], procs['log_error'], ['5xx'])

print()
print('=' * 60)
print('BUILD COMPLETE')
print('=' * 60)
print('L2: Process Accounts Payable & Expense Reimbursements')
print('  L3: Manage Supplier Invoices [' + str(l3_id) + ']')
print('    L4: Supplier Invoicing [' + str(l4_id) + ']')
print('      L5: Inbound - FreeAgent Bills Delta Sync [' + str(l5_id) + ']')
print()
print('Processors: ' + str(len(procs)) + ' created')
for k, v in procs.items():
    print('  ' + k + ': ' + str(v))
print()
print('Fire Next target: ' + FIRE_NEXT_TARGET)
print('  (Level 5: Bnk Statements & Trans Explanations)')
print()
print('MANUAL UI STEPS REQUIRED:')
print('  1. Verify flow visually in NiFi UI')
print('  2. Bind L5 to Bare-ConnectFi_MasterParameterContext')
print('  3. Clone Fire Next Integration PG to chain this flow')
print('  4. Start all processors')
