"""Independent Python JSON-RPC MCP consumer; no OpenCode or Node MCP SDK."""
import json,os,sys,time,urllib.request,urllib.error
from pathlib import Path
url,fixtures,out=sys.argv[1:];token=os.environ['TF_EXPERIMENT_MCP_TOKEN'];transcripts=[];counter=0
def rpc(method,params,notification=False,authenticated=True):
    global counter
    counter+=1;body={'jsonrpc':'2.0','method':method,'params':params}
    if not notification:body['id']=counter
    headers={'Content-Type':'application/json','Accept':'application/json, text/event-stream','MCP-Protocol-Version':'2025-11-25'}
    if authenticated:headers['Authorization']='Bearer '+token
    start=time.perf_counter()
    try:
        with urllib.request.urlopen(urllib.request.Request(url,json.dumps(body).encode(),headers),timeout=30) as r:status=r.status;raw=r.read().decode()
    except urllib.error.HTTPError as e:status=e.code;raw=e.read().decode()
    parsed=json.loads(raw) if raw else None
    transcripts.append({'request':body,'httpStatus':status,'response':parsed,'latencyMs':(time.perf_counter()-start)*1000})
    return parsed,status
init,status=rpc('initialize',{'protocolVersion':'2025-11-25','capabilities':{},'clientInfo':{'name':'independent-python-review-consumer','version':'1.0'}})
assert status==200 and init['result']['protocolVersion']=='2025-11-25'
rpc('notifications/initialized',{},True)
tools,status=rpc('tools/list',{});assert status==200 and len(tools['result']['tools'])==3
_,status=rpc('tools/list',{},authenticated=False);assert status==401
def tool(name,args):
    result,status=rpc('tools/call',{'name':name,'arguments':args})
    assert status==200 and 'error' not in result and not result['result'].get('isError'),str(result)
    return json.loads(result['result']['content'][0]['text'])
rows=[]
for f in json.loads(Path(fixtures).read_text()):
    try:
        envelope=tool('traceforge_get_claim_record',{'promptId':f['id']})
        digest=tool('traceforge_workspace_digest',{'path':f['workspace']})['sha256']
        began=time.perf_counter();actual=tool('traceforge_check_claim_record',{'envelope':envelope,'artifactDigest':digest})
        rows.append({'id':f['id'],'condition':f['condition'],'expected':f['expected'],'actual':actual['decision'],'agreement':actual['decision']==f['expected'],'latencyMs':(time.perf_counter()-began)*1000})
    except Exception as e:rows.append({'id':f['id'],'condition':f['condition'],'error':str(e),'agreement':False})
Path(out,'transcripts.jsonl').write_text(''.join(json.dumps(x)+'\n' for x in transcripts));Path(out,'client-results.json').write_text(json.dumps(rows,indent=2))
if any(not r['agreement'] for r in rows):sys.exit(1)
