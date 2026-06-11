# patch_helper.py — shared helpers for all PATCH operations
import json, urllib.request

def get_jwt():
    data = json.dumps({'email':'admin@bare-table.com',
                       'password':'Test1234!Abcd'}).encode()
    req = urllib.request.Request('http://100.64.0.19/api/user/token-auth/',
        data=data, headers={'Content-Type':'application/json'})
    with urllib.request.urlopen(req) as r:
        return json.loads(r.read())['token']

TOKEN = get_jwt()
BASE = 'http://100.64.0.19/api'

def patch(path, payload):
    data = json.dumps(payload).encode()
    req = urllib.request.Request(BASE + path, data=data, method='PATCH',
        headers={'Authorization':'JWT ' + TOKEN,
                 'Content-Type':'application/json'})
    with urllib.request.urlopen(req) as r:
        result = json.loads(r.read())
    print('PATCH ' + path + ' -> ' + str(result.get('name', result.get('id', 'ok'))))
    return result

def api_get(path):
    req = urllib.request.Request(BASE + path,
        headers={'Authorization':'JWT ' + TOKEN})
    with urllib.request.urlopen(req) as r:
        return json.loads(r.read())

def api_post(path, payload):
    data = json.dumps(payload).encode()
    req = urllib.request.Request(BASE + path, data=data, method='POST',
        headers={'Authorization':'JWT ' + TOKEN,
                 'Content-Type':'application/json'})
    with urllib.request.urlopen(req) as r:
        result = json.loads(r.read())
    print('POST ' + path + ' -> ' + str(result.get('name', result.get('id', 'ok'))))
    return result
