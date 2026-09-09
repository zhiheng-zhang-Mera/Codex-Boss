const fs=require("node:fs"),path=require("node:path"),{randomUUID}=require("node:crypto"),{execFileSync}=require("node:child_process");
const {StateStore}=require("../dist-electron/electron/store");
const {MainCommander}=require("../dist-electron/electron/commander/main-commander");
const {TaskLedger}=require("../dist-electron/electron/commander/task-ledger");
const {RuntimeRegistry}=require("../dist-electron/electron/commander/runtime-registry");
const {BudgetManager}=require("../dist-electron/electron/commander/budget-manager");
const {RoleRouter}=require("../dist-electron/electron/commander/role-router");
const {Scheduler}=require("../dist-electron/electron/commander/scheduler");
const {ContextManager}=require("../dist-electron/electron/commander/context-manager");
const {ExecutionGate}=require("../dist-electron/electron/commander/execution-gate");
const {findVSCodeExecutable}=require("../dist-electron/electron/computer/computer-service");
const {WindowsUiaBackend}=require("../dist-electron/electron/computer/backends/windows-uia");
const root=path.resolve(__dirname,"..","artifacts","structured-"+randomUUID()),workspace=path.join(root,"Boss Structured Acceptance"),profile=path.join(root,"vscode-profile");
fs.mkdirSync(workspace,{recursive:true});fs.writeFileSync(path.join(workspace,"README.md"),"BOSS_STRUCTURED_FILE");
fs.writeFileSync(path.join(workspace,"terminal.log"),execFileSync(process.execPath,["-e","console.log('BOSS_TERMINAL_RESULT')"],{encoding:"utf8"}));
execFileSync("git",["init"],{cwd:workspace,stdio:"ignore"});
const evidence={kind:"CONTROLLED_STRUCTURED_APPS",root,workspace,profile,status:"RUNNING",steps:[]};
(async()=>{
 const executable=findVSCodeExecutable();if(!executable)throw Error("VS Code missing");
 const launcher=new WindowsUiaBackend({vscode:{executable,args:["--new-window","--disable-extensions","--user-data-dir",profile,"--extensions-dir",path.join(root,"extensions"),workspace]}});
 evidence.launch=await launcher.execute({name:"open_app",target:"vscode"},new AbortController().signal);
 if(evidence.launch.status!=="SUCCESS")throw Error("VS Code launch failed");
 await new Promise(r=>setTimeout(r,4000));
 const store=new StateStore(path.join(root,"state.json")),registry=new RuntimeRegistry(),budgets=new BudgetManager();
 const commander=new MainCommander(store,registry,new Scheduler(),new RoleRouter(registry,budgets),budgets,new ContextManager(),new ExecutionGate(),new TaskLedger(path.join(root,".boss","tasks")),undefined,undefined,{vscodeExecutable:executable,vscodeUserDataDir:profile});
 for(const [prompt,marker] of [["查看项目目录","README.md"],["读取终端日志 terminal.log","BOSS_TERMINAL_RESULT"],['desktop {"name":"read_page","target":"git:status"}',"README.md"],["查看 VS Code 状态","Process"]]){
  const task=commander.createTask({title:prompt,objective:prompt,providerIds:[]});
  await commander.executeDeterministic(task.id,workspace);
  const artifact=store.snapshot().artifacts.find(item=>item.taskId===task.id);
  if(!artifact?.content.includes(marker))throw Error("Missing structured evidence for "+prompt);
  evidence.steps.push({prompt,result:JSON.parse(artifact.content)});
 }
 evidence.status="PASS";
})().catch(error=>{evidence.status="FAILED";evidence.error=String(error);process.exitCode=1}).finally(()=>{fs.writeFileSync(path.join(root,"result.json"),JSON.stringify(evidence,null,2));console.log(JSON.stringify({root,workspace,status:evidence.status,error:evidence.error}));});
