const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { TaskLedger } = require('../dist-electron/electron/commander/task-ledger.js');
const { ExecutionSupervisor } = require('../dist-electron/electron/commander/execution-supervisor.js');
const { compileIntent } = require('../dist-electron/src/shared/task-ir.js');
const { execFileSync } = require('node:child_process');
(async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'boss-benchmark-'));
  try {
    let persisted = 0, recovered = 0, calls = 0;
    // Real independent Node processes reconstruct the ledger after the writer exits.
    const modulePath = require.resolve('../dist-electron/electron/commander/task-ledger.js');
    execFileSync(process.execPath, ['-e', `const {TaskLedger}=require(process.argv[1]); const ledger=new TaskLedger(process.argv[2]); for(let i=0;i<100;i++){ledger.create('case'+i,'objective');ledger.update('case'+i,'completed',s=>s.completedSteps.push('step'));}`, modulePath, root]);
    for (let i = 0; i < 100; i++) if (new TaskLedger(root).load('case'+i).completedSteps.includes('step')) persisted++;
    const runtime = (id, fail) => ({ id, kind: 'local', capabilities: { roles: ['coding'], supportsCancellation: true, supportsStreaming: false }, async execute(request) { calls++; if(fail) throw new Error('network failure'); return {runtimeId:id,jobId:request.jobId,status:'SUCCESS',content:'controlled evidence'}; } });
    const supervisor = new ExecutionSupervisor(new TaskLedger(root));
    for(let i=0;i<20;i++) if((await supervisor.execute({taskId:'recover'+i,jobId:'step',role:'coding',prompt:'test',replaySafe:true},[runtime('local:broken',true),runtime('local:healthy',false)])).status==='SUCCESS') recovered++;
    const prompts = ['git status','read file README.md','list files','explain this code','write a parser','summarize this answer','修复按钮','解释代码','查看 git 状态','读取文件 README.md'];
    const lightweight = prompts.filter(prompt=>['L0','L1'].includes(compileIntent(prompt).estimatedComplexity)).length;
    const report = { schemaVersion: 1, scope: 'CONTROLLED_LOCAL_BENCHMARK', generatedAt: new Date().toISOString(), persistence: { passed: persisted, cases: 100, method: 'separate writer process, normal exit, new ledger readers' }, recovery: { passed: recovered, cases: 20, method: 'injected network exception then compatible mock backend', observedWorkerCalls: calls }, routing: { L0orL1: lightweight, cases: prompts.length }, realProviderRecovery: 'NOT_RUN', machinePowerLoss: 'NOT_RUN', engineeringCompletionRates: 'NOT_RUN', semanticApplicationCoverage: 'NOT_RUN', modelSavingsAgainstLiveBaseline: null };
    fs.mkdirSync(path.join(__dirname,'../artifacts'), { recursive: true }); fs.writeFileSync(path.join(__dirname,'../artifacts/benchmark.json'), JSON.stringify(report,null,2));
    console.log(JSON.stringify(report,null,2)); if(persisted!==100||recovered!==20||lightweight!==prompts.length) process.exitCode=1;
  } finally { fs.rmSync(root,{recursive:true,force:true}); }
})().catch(error=>{console.error(error);process.exitCode=1;});
