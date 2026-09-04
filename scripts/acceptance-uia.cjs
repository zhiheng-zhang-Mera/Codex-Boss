const fs=require('node:fs');
const path=require('node:path');
const {spawn}=require('node:child_process');
const {randomUUID}=require('node:crypto');
const {SemanticRuntime}=require('../dist-electron/electron/computer/semantic-runtime');
const {WindowsUiaBackend}=require('../dist-electron/electron/computer/backends/windows-uia');
const root=path.resolve(__dirname,'..','artifacts','uia-'+randomUUID());fs.mkdirSync(root,{recursive:true});
const ready=path.join(root,'ready.json');
let childPid;
const runtime=new SemanticRuntime([new WindowsUiaBackend({fixture:{executable:'powershell.exe',args:['-NoProfile','-STA','-File',path.join(__dirname,'acceptance-uia-fixture.ps1'),'-ReadyFile',ready]}})],path.join(root,'pending.json'));
const evidence={kind:'CONTROLLED_NATIVE_UIA',root,status:'RUNNING',steps:[]};
(async()=>{
  const opened=await runtime.execute({name:'open_app',target:'fixture'}); evidence.steps.push({action:{name:'open_app',target:'fixture'},result:opened});
  if(opened.status!=='SUCCESS')throw Error('Fixture launch failed'); childPid=opened.evidence.processId;
  const deadline=Date.now()+15000;
  while(!fs.existsSync(ready)&&Date.now()<deadline)await new Promise(r=>setTimeout(r,100));
  if(!fs.existsSync(ready))throw Error('Fixture did not open');
  const info=JSON.parse(fs.readFileSync(ready,'utf8').replace(/^\uFEFF/,''));
  if(info.pid!==childPid)throw Error('Fixture process identity changed');
  const target=(extra={})=>'uia:'+JSON.stringify({processId:info.pid,windowTitle:info.title,...extra});
  const input=target({automationId:'acceptanceInput'});
  for(const action of [{name:'focus_window',target:target()},{name:'find_control',target:input},{name:'enter_text',target:input,value:'BOSS_UIA_TYPED'},{name:'verify_state',target:input,value:'BOSS_UIA_TYPED'},{name:'click_control',target:target({automationId:'acceptanceButton'})},{name:'wait_for_state',target:target({automationId:'lateInput'}),value:'BOSS_UIA_LATE',timeoutMs:10000},{name:'wait_for_state',target:input,value:'BOSS_UIA_CLICKED',timeoutMs:10000}]){
    const result=await runtime.execute(action);evidence.steps.push({action,result});
    if(result.status!=='SUCCESS')throw Error(action.name+': '+JSON.stringify(result));
  }
  evidence.status='PASS';
})().catch(error=>{evidence.status='FAILED';evidence.error=String(error);process.exitCode=1}).finally(()=>{if(childPid){try{process.kill(childPid)}catch{}}fs.writeFileSync(path.join(root,'result.json'),JSON.stringify(evidence,null,2));console.log(JSON.stringify(evidence,null,2));});
