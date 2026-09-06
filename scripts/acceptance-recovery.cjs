const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { randomUUID } = require('node:crypto');
const { ProviderApiClient } = require('../dist-electron/electron/provider-api');
const { ApiRuntime } = require('../dist-electron/electron/runtimes/native-api-runtime');
const { CodexCliRuntime } = require('../dist-electron/electron/runtimes/codex/codex-cli-runtime');
const { ExecutionSupervisor } = require('../dist-electron/electron/commander/execution-supervisor');
const { RecoveryScheduler } = require('../dist-electron/electron/commander/recovery-scheduler');
const { TaskLedger } = require('../dist-electron/electron/commander/task-ledger');
const { BudgetManager } = require('../dist-electron/electron/commander/budget-manager');
const root = path.resolve(__dirname, '..', 'artifacts', 'recovery-' + randomUUID());
fs.mkdirSync(root, { recursive: true });
const evidence = { generatedAt: new Date().toISOString(), api: 'NOT_RUN', cli: 'NOT_RUN' };
(async () => {
  let calls = 0;
  const server = http.createServer((req, res) => { let body = ''; req.on('data', c => body += c); req.on('end', () => {
    calls++; JSON.parse(body);
    if (calls === 1) { res.writeHead(429, { 'retry-after': '1', 'content-type': 'application/json' }); res.end(JSON.stringify({ error: 'rate limit injected' })); }
    else { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ choices: [{ message: { content: 'API_RECOVERY_OK' } }] })); }
  }); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = 'http://127.0.0.1:' + server.address().port;
    const client = new ProviderApiClient({ assertReady() {}, connection() { return { protocol: 'openai-compatible', baseUrl: address, model: 'controlled', apiKey: 'local-fixture' }; } });
    const runtime = new ApiRuntime('fixture', client);
    const ledger = new TaskLedger(path.join(root, 'tasks')); const queueFile = path.join(root, 'recovery.json');
    const queue = new RecoveryScheduler(queueFile); const budgets = new BudgetManager(path.join(root, 'budget.json'));
    const request = { taskId: 'api', jobId: 'answer', role: 'research', prompt: 'controlled test', replaySafe: true };
    const first = await new ExecutionSupervisor(ledger, undefined, undefined, queue, budgets).execute(request, [runtime]);
    if (first.failure?.code !== 'RATE_LIMITED' || !first.failure.retryAt) throw Error('HTTP retry deadline lost');
    await new Promise(resolve => setTimeout(resolve, 2100));
    const restored = new RecoveryScheduler(queueFile); const supervisor = new ExecutionSupervisor(new TaskLedger(ledger.root), undefined, undefined, restored, new BudgetManager(path.join(root, 'budget.json')));
    restored.register('runtime', async () => ({ done: (await supervisor.execute(request, [runtime])).status === 'SUCCESS' }));
    await restored.runDue();
    const final = await supervisor.execute(request, [runtime]);
    if (final.content !== 'API_RECOVERY_OK' || calls !== 2) throw Error('API recovery did not complete exactly once');
    evidence.api = { kind: 'CONTROLLED_INTEGRATION', httpRequests: calls, retryAfterPreserved: true, resumeSucceeded: true, duplicateCompletedCall: false };
  } finally { await new Promise(resolve => server.close(resolve)); }
  if (process.argv.includes('--live-cli')) {
    const runtime = new CodexCliRuntime(root);
    const result = await new ExecutionSupervisor(new TaskLedger(path.join(root, 'cli-tasks'))).execute({ taskId: 'cli', jobId: 'live-acceptance', role: 'research', prompt: 'Harmless software acceptance check. Do not use tools. Reply exactly BOSS_CLI_RECOVERY_OK', replaySafe: true, timeoutMs: 120000 }, [runtime]);
    evidence.cli = { kind: 'LIVE_PROVIDER', status: result.status, content: result.content, failure: result.failure };
    if (result.status !== 'SUCCESS' || !result.content?.includes('BOSS_CLI_RECOVERY_OK')) throw Error('Live CLI acceptance failed');
  }
  evidence.status = 'PASS';
})().catch(error => { evidence.status = 'FAILED'; evidence.error = String(error); process.exitCode = 1; }).finally(() => {
  fs.writeFileSync(path.join(root, 'result.json'), JSON.stringify(evidence, null, 2)); console.log(JSON.stringify({ root, evidence }, null, 2));
});
