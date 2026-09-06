const fs=require("node:fs"),path=require("node:path"),http=require("node:http"),{randomUUID}=require("node:crypto");
const {app,BrowserWindow}=require("electron");
const {StateStore,providerSeed}=require("../dist-electron/electron/store");
const {ProviderViews}=require("../dist-electron/electron/provider-views");
const {ProviderAutomation}=require("../dist-electron/electron/provider-automation");
const {AccountSessionManager}=require("../dist-electron/electron/account-sessions");
const {WebRecovery}=require("../dist-electron/electron/commander/web-recovery");
const {RecoveryScheduler}=require("../dist-electron/electron/commander/recovery-scheduler");
const {BudgetManager}=require("../dist-electron/electron/commander/budget-manager");
const {TaskFinalizer}=require("../dist-electron/electron/commander/task-finalizer");
const root=path.resolve(__dirname,"..","artifacts","browser-crash-"+randomUUID());fs.mkdirSync(root,{recursive:true});
app.setPath("userData",root);app.setPath("sessionData",path.join(root,"sessions"));
const testSessionExpiry=process.argv.includes("--session-expiry");let sessionExpired=false;const testNetworkOutage=process.argv.includes("--network-outage");let networkDown=false;
let sends=0,automation,views,host;const evidence={kind:"CONTROLLED_ELECTRON_BROWSER_CRASH",status:"RUNNING",root};
const server=http.createServer((req,res)=>{
 if(networkDown){req.socket.destroy();return;}
 if(req.method==="POST"){sends++;req.resume();res.end("ok");return;}
 res.setHeader("Content-Type","text/html; charset=utf-8");
 if(sessionExpired){res.end("<!doctype html><html><body><h1>Sign in</h1></body></html>");return;}
 res.end("<!doctype html><html><body><textarea id=\"prompt-textarea\" aria-label=\"Prompt\"></textarea><button aria-label=\"Send\" onclick=\"fetch('/send',{method:'POST'});this.disabled=true\">Send</button>"+(sends ? '<div data-message-author-role="assistant">BOSS_BROWSER_CRASH_RECOVERED</div>' : '')+'</body></html>');
});
(async()=>{
 await app.whenReady();await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
 const provider={...providerSeed[0],url:"http://127.0.0.1:"+server.address().port+"/"};
 const store=new StateStore(path.join(root,"state.json"));const queue=new RecoveryScheduler(path.join(root,"queue.json"));
 host=new BrowserWindow({width:850,height:550,title:"Codex Boss browser crash acceptance",webPreferences:{nodeIntegration:false,contextIsolation:true}});
 const accounts=new AccountSessionManager(store);
 views=new ProviderViews(host,(id,open)=>store.setWindow(id,open),accounts,()=>{throw Error("No fixture downloads");});
 const view=views.open(provider,false);view.setBounds({x:0,y:0,width:850,height:500});await view.webContents.loadURL(provider.url+"c/fixture");
 const finalizer=new TaskFinalizer(store);
 const recovery=new WebRecovery(store,views,()=>automation,()=>provider,queue,new BudgetManager(path.join(root,"budget.json")));
 automation=new ProviderAutomation(store,views,()=>provider,()=>{},accounts,{},undefined,async id=>{await finalizer.finalize(id)},(run,strategy,retryAt)=>recovery.defer(run,strategy,retryAt));
 const task=store.createTask("Browser crash acceptance","Return BOSS_BROWSER_CRASH_RECOVERED",["chatgpt"]);
 await automation.dispatchTask(task.id);automation.dispose();
 const deadline=Date.now()+5000;while(!sends&&Date.now()<deadline)await new Promise(r=>setTimeout(r,50));
 if(sends!==1)throw Error("Expected exactly one initial send");
 const run=store.runsForTask(task.id)[0];if(!run.sessionUrl?.endsWith("/c/fixture"))throw Error("Original session was not recorded");
 const gone=new Promise(resolve=>view.webContents.once("render-process-gone",(_event,details)=>resolve(details)));
 view.webContents.forcefullyCrashRenderer();
 evidence.crash=await Promise.race([gone,new Promise((_,reject)=>setTimeout(()=>reject(Error("No renderer crash event")),5000))]);
 if(!view.webContents.isCrashed())throw Error("Renderer crash not confirmed");
 sessionExpired=testSessionExpiry;networkDown=testNetworkOutage;
 recovery.defer(run,"CAPTURE_EXISTING",1);await queue.runDue();
 if(testNetworkOutage){
  const pending=queue.list()[0];
  if(pending?.state!=="WAITING"||!pending.error||sends!==1)throw Error("Network outage did not create a retry deadline");
  evidence.networkError=pending.error;evidence.retryAt=pending.retryAt;networkDown=false;
  await new Promise(resolve=>setTimeout(resolve,Math.max(0,pending.retryAt-Date.now())+20));
  await queue.runDue();
 }
 if(testSessionExpiry){
  if(queue.list()[0]?.state!=="PAUSED"||sends!==1||store.finalResponseForTask(task.id))throw Error("Expired session did not pause safely");
  evidence.sessionExpiryPaused=true;sessionExpired=false;
  await views.get(provider.id).webContents.loadURL(run.sessionUrl);
  store.setTaskStatus(task.id,"running");if(queue.resumeTask(task.id)!==1)throw Error("User resume did not wake recovery");
  store.setRecoveryState(task.id,Date.now(),"Controlled user resume");
  await queue.runDue();
 }
 await automation.captureTask(task.id);automation.dispose();
 const final=store.finalResponseForTask(task.id);
 if(sends!==1||!final?.content.includes("BOSS_BROWSER_CRASH_RECOVERED"))throw Error("Recovery did not complete without duplicate send");
 evidence.status="PASS";evidence.sends=sends;evidence.taskId=task.id;evidence.final=final.content;evidence.sessionUrl=run.sessionUrl;
})().catch(error=>{evidence.status="FAILED";evidence.error=String(error)}).finally(()=>{
 automation?.dispose();views?.destroyAll();host?.destroy();server.close();
 fs.writeFileSync(path.join(root,"result.json"),JSON.stringify(evidence,null,2));console.log(JSON.stringify(evidence,null,2));app.exit(evidence.status==="PASS"?0:1);
});
setTimeout(()=>{if(evidence.status==="RUNNING"){evidence.status="FAILED";evidence.error="Acceptance timed out";fs.writeFileSync(path.join(root,"result.json"),JSON.stringify(evidence,null,2));app.exit(1)}},30000).unref();
