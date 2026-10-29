"""Re-execute explicitly eligible commands on preserved W-prime in isolated Linux.
No agent or judge is involved. Missing dependencies remain recorded failures.
"""
import argparse,datetime,hashlib,json,os,platform,re,shlex,shutil,signal,subprocess,tempfile,time,uuid
from pathlib import Path
from sandbox import prepare_root,sandbox_preexec,AGENT_UID
def linux_path(value):
    return '/mnt/'+value[0].lower()+value[2:].replace('\\','/') if re.match(r'^[A-Za-z]:',value) else value
def main():
    p=argparse.ArgumentParser();p.add_argument('--jobs',required=True);p.add_argument('--output',required=True);p.add_argument('--family');a=p.parse_args()
    if os.getuid()!=0:raise RuntimeError('Trusted administrator required for isolated oracle')
    out=Path(a.output)
    if out.exists():raise RuntimeError('Fresh output required')
    started=datetime.datetime.now(datetime.timezone.utc).isoformat()
    release=Path('/var/lib/traceforge-oracle')/uuid.uuid4().hex;release.mkdir(parents=True,mode=0o755)
    root=prepare_root(release/'root');store=release/'empty-protected';store.mkdir(mode=0o700);endpoint=release/'empty-socket';endpoint.touch()
    (root/'etc').mkdir();(root/'etc/hosts').write_text('127.0.0.1 localhost\n::1 localhost\n')
    # Prefer a checksum-verified Node release with its matching npm runtime.
    runtime=Path('/var/lib/traceforge-oracle-runtime/node-v22.14.0-linux-x64')
    if runtime.is_dir():
        shutil.copy2(runtime/'bin/node',root/'usr/bin/node')
        shutil.copytree(runtime/'lib/node_modules/npm',root/'usr/share/nodejs/npm',dirs_exist_ok=True)
        libraries=subprocess.run(['ldd',str(runtime/'bin/node')],capture_output=True,text=True,check=True).stdout
        for line in libraries.splitlines():
            for value in line.split():
                if value.startswith('/') and Path(value).is_file():
                    target=root/value.lstrip('/');target.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(value,target)
    npm=root/'usr/bin/npm';npm.write_text('#!/bin/sh\nexec /usr/bin/node /usr/share/nodejs/npm/bin/npm-cli.js "$@"\n');npm.chmod(0o755)
    # Pytest and these dependencies are pure Python. Vendor only this pinned
    # research environment's test runtime, not its host credentials or plugins.
    packages=Path(__file__).resolve().parents[2]/'.traceforge/revision-20261028/venv/Lib/site-packages'
    deps=root/'opt/oracle-deps';deps.mkdir(parents=True)
    names=('pytest','_pytest','pluggy','iniconfig','packaging','pygments','py','six','attr','attrs','tomli','exceptiongroup','typing_extensions')
    if packages.is_dir():
        for source in packages.iterdir():
            if any(source.name==name or source.name==name+'.py' or source.name.startswith(name+'-') and source.name.endswith('.dist-info') for name in names):
                if source.is_dir():shutil.copytree(source,deps/source.name)
                else:shutil.copy2(source,deps/source.name)
    pytest=root/'usr/bin/pytest';pytest.write_text('#!/bin/sh\nexec /usr/bin/python3 -m pytest "$@"\n');pytest.chmod(0o755)
    vitest_packages=Path('/var/lib/traceforge-oracle-tools/node_modules')
    if vitest_packages.is_dir():
        shutil.copytree(vitest_packages,root/'opt/oracle-tools/node_modules',symlinks=False)
        vitest=root/'usr/bin/vitest';vitest.write_text('#!/bin/sh\nexec /usr/bin/node /opt/oracle-tools/node_modules/vitest/vitest.mjs "$@"\n');vitest.chmod(0o755)
        for library in vitest_packages.rglob('*.node'):
            linked=subprocess.run(['ldd',str(library)],capture_output=True,text=True).stdout
            for line in linked.splitlines():
                for value in line.split():
                    if value.startswith('/') and Path(value).is_file():
                        target=root/value.lstrip('/');target.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(value,target)
    rows=[]
    for job in json.loads(Path(a.jobs).read_text()):
        if a.family and job['family']!=a.family:continue
        row={**job,'runtimeMs':None,'oracleDecision':None,'status':'EXCLUDED','reason':job.get('excluded','')}
        if job.get('excluded'):rows.append(row);continue
        workspace=root/'workspace'
        # Fixed administrator-created path, never a claim-provided deletion target.
        assert workspace.resolve()==(release/'root/workspace').resolve()
        shutil.rmtree(workspace);shutil.copytree(linux_path(job['workspace']),workspace,symlinks=False,ignore=shutil.ignore_patterns('node_modules','__pycache__','.pytest_cache'))
        if vitest_packages.is_dir():os.symlink('/opt/oracle-tools/node_modules',workspace/'node_modules')
        for directory,dirs,files in os.walk(workspace):
            os.chown(directory,AGENT_UID,AGENT_UID)
            for name in files:os.chown(Path(directory,name),AGENT_UID,AGENT_UID,follow_symlinks=False)
        argv=job['argv'];start=time.perf_counter()
        try:
            with tempfile.TemporaryFile() as stdout,tempfile.TemporaryFile() as stderr:
                def setup():os.setsid();sandbox_preexec(root,store,endpoint,loopback=True)
                process=subprocess.Popen(argv,stdout=stdout,stderr=stderr,env={'PATH':'/usr/bin:/bin','LANG':'C.UTF-8','HOME':'/tmp','PYTHONPATH':'/opt/oracle-deps','PYTEST_DISABLE_PLUGIN_AUTOLOAD':'1','VITEST_MAX_THREADS':'1','VITEST_MIN_THREADS':'1','VITEST_MAX_FORKS':'1','VITEST_MIN_FORKS':'1','npm_config_cache':'/tmp/npm-cache','npm_config_update_notifier':'false'},preexec_fn=setup)
                try:process.wait(timeout=30)
                except subprocess.TimeoutExpired:os.killpg(process.pid,signal.SIGKILL);process.wait();raise RuntimeError('TIMEOUT')
                finally:
                    try:os.killpg(process.pid,signal.SIGKILL)
                    except ProcessLookupError:pass
                stdout.seek(0);stderr.seek(0);text=stdout.read(1024*1024).decode(errors='replace');err=stderr.read(65536).decode(errors='replace')
            row.update({'status':'EXECUTED','exitCode':process.returncode,'stdout':text,'stderr':err})
            if process.returncode<0:row.update({'status':'FAILED','reason':'Process terminated by signal '+str(-process.returncode)})
            elif 'vitest' in Path(argv[0]).name and not re.search(r'Test Files|Tests\s+\d',text):row.update({'status':'FAILED','reason':'Test runner exited before emitting test results'})
            elif re.search(r'Cannot find|not found|No module named|Cannot load|error while loading shared libraries|cannot open shared object file|ERR_DLOPEN_FAILED|FileNotFoundError',text+'\n'+err):row.update({'status':'ENVIRONMENT_UNAVAILABLE','reason':'Required dependency absent in clean sandbox'})
            else:
                passed=re.findall(r'^\s*#\s*pass\s+(\d+)\s*$',text,re.M) or re.findall(r'\b(\d+)\s+passed\b',text)
                failed=re.findall(r'^\s*#\s*fail\s+(\d+)\s*$',text,re.M) or re.findall(r'\b(\d+)\s+failed\b',text)
                ok=process.returncode==0
                if job['claimType']=='TEST_PASSED' and job.get('expectedPassed') is not None:ok=ok and bool(passed) and int(passed[-1])==job['expectedPassed']
                if failed:ok=ok and int(failed[-1])==0
                row['oracleDecision']='VERIFIED' if ok else 'CONTRADICTED'
        except FileNotFoundError as e:row.update({'status':'ENVIRONMENT_UNAVAILABLE','reason':'Required executable absent from clean sandbox: '+str(e)})
        except Exception as e:row.update({'status':'FAILED','reason':str(e)})
        row['runtimeMs']=(time.perf_counter()-start)*1000;rows.append(row)
        out.with_suffix('.progress.json').write_text(json.dumps({'completed':len(rows),'total':len(json.loads(Path(a.jobs).read_text())),'lastSession':job['id']}))
    out.write_text(''.join(json.dumps(r)+'\n' for r in rows));print(json.dumps({'claims':len(rows),'executed':sum(r['status']=='EXECUTED' for r in rows),'environment':'Linux namespaces/chroot; /usr/bin/node and standard-library Python; no host dependencies'}))
    out.with_suffix('.provenance.json').write_text(json.dumps({'start':started,'end':datetime.datetime.now(datetime.timezone.utc).isoformat(),'command':[__import__('sys').executable,*__import__('sys').argv],'python':platform.python_version(),'os':platform.platform(),'exit_code':0,'jobsSha256':hashlib.sha256(Path(a.jobs).read_bytes()).hexdigest()},indent=2))
if __name__=='__main__':main()
