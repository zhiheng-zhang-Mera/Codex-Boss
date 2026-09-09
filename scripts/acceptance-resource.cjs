const fs=require("node:fs");
const path=require("node:path");
const {randomUUID}=require("node:crypto");
const {CodexCliRuntime}=require("../dist-electron/electron/runtimes/codex/codex-cli-runtime");
const root=path.resolve(__dirname,"..","artifacts","resource-"+randomUUID());
fs.mkdirSync(root,{recursive:true});
const runtime=new CodexCliRuntime(root);
const marker="BOSS_S5_RESOURCE_OK";
async function call(jobId,role,prompt){const started=Date.now();const result=await runtime.execute({taskId:"resource",jobId,role,prompt,replaySafe:true,timeoutMs:180000});if(result.status!=="SUCCESS"||result.content!==marker)throw Error(jobId+" failed: "+JSON.stringify(result));return {jobId,durationMs:Date.now()-started,content:result.content};}
(async()=>{
 const optimizedStart=Date.now();const optimized=[await call("optimized","synthesis","Reply exactly "+marker)];const optimizedMs=Date.now()-optimizedStart;
 const baselineStart=Date.now();const baseline=[];baseline.push(await call("baseline-plan","planning","Plan this trivial response internally, but output exactly "+marker));baseline.push(await call("baseline-worker-a","research","Independently answer this trivial task; output exactly "+marker));baseline.push(await call("baseline-worker-b","research","Independently answer this trivial task; output exactly "+marker));const baselineMs=Date.now()-baselineStart;
 const report={schemaVersion:1,kind:"LIVE_PROVIDER_RESOURCE_COMPARISON",task:"Return one exact completion marker",runtime:"codex:cli",output:marker,optimized:{modelCalls:optimized.length,elapsedMs:optimizedMs,results:optimized},naiveAlwaysPlanAlwaysMulti:{modelCalls:baseline.length,elapsedMs:baselineMs,results:baseline},modelCallReductionPercent:(1-optimized.length/baseline.length)*100,limitations:"One bounded like-for-like task; elapsed time is sequential wall clock and not a population estimate.",status:"PASS",generatedAt:new Date().toISOString()};
 fs.writeFileSync(path.join(root,"result.json"),JSON.stringify(report,null,2));fs.writeFileSync(path.resolve(__dirname,"..","artifacts","latest-resource.json"),JSON.stringify({root,result:path.join(root,"result.json")},null,2));console.log(JSON.stringify({root,status:report.status,modelCallReductionPercent:report.modelCallReductionPercent,optimizedMs,baselineMs},null,2));
})().catch(error=>{console.error(error);process.exitCode=1;});
