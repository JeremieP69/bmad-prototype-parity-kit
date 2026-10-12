import test from 'node:test';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
const cli = fileURLToPath(new URL('../mission.mjs', import.meta.url));
async function fixture(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(),'parity-mission-'));
  t.after(() => fs.rm(dir,{recursive:true,force:true}));
  const config = {viewports:[{name:'desktop',width:1440,height:900},{name:'small-desktop',width:1024,height:900},{name:'tablet',width:768,height:1024},{name:'mobile',width:390,height:844}],implementation:{sessions:{admin:{user:'private@example.test',password:'TOP_SECRET'}}},pairs:[{id:'A',proto:'reference.html#A',impl:'http://127.0.0.1:8000/login',baselineImages:{mobile:'mobile.png'}},{id:'B',proto:'reference.html#B',impl:'http://127.0.0.1:8000/b'}]};
  await fs.writeFile(path.join(dir,'reference.html'),'reference');
  await fs.writeFile(path.join(dir,'mobile.png'),'baseline');
  await fs.writeFile(path.join(dir,'parity.config.json'),JSON.stringify(config,null,2));
  await fs.writeFile(path.join(dir,'proto.config.json'),JSON.stringify({prototype:'reference.html',routes:['A','B']}));
  await fs.writeFile(path.join(dir,'MANIFEST.md'),'# Version 1\n| Route | Viewport |\n| A | desktop |\n| B | desktop |\n');
  await fs.writeFile(path.join(dir,'deviations.md'),'# Decisions\nGlobal decision retained.\n| Route | Decision |\n| A | keep A |\n| B | omit B |\n| UNKNOWN | keep unknown |\n| A* | keep wildcard |\n| A, B | keep ambiguous |\n');
  const engine = path.join(dir,'engine.mjs');
  await fs.writeFile(engine,`import fs from 'node:fs/promises'; import path from 'node:path';
const config=JSON.parse(await fs.readFile(process.argv[process.argv.indexOf('--config')+1],'utf8'));
if (!path.isAbsolute(config.pairs[0].proto.split('#')[0]) || !path.isAbsolute(config.pairs[0].baselineImages.mobile) || config.implementation.sessions.admin.password !== 'TOP_SECRET') process.exit(9);
const results=[];
for (const v of config.viewports) for (const p of config.pairs) {
if (p.viewports && !p.viewports.includes(v.name)) continue;
const composite=p.id+'.'+v.name+'.compare.png';
await fs.writeFile(path.join(config.outDir,composite),'PNG fixture '+p.id+v.name+(process.env.FAKE_IMAGE || ''));
results.push({id:p.id,viewport:v.name,status:process.env.FAKE_ERROR ? 'error' : 'close',mismatchPct:0,composite,error:'TOP_SECRET'});
}
await fs.writeFile(path.join(config.outDir,'parity-report.json'),JSON.stringify({results}));
await fs.writeFile(path.join(config.outDir,'parity-report.md'),'TOP_SECRET');
`);
  function call(command,extra=[],env={}) {
    const common= command === 'record-review' ? [] : ['--config',path.join(dir,'parity.config.json'),'--pairs','A','--out',path.join(dir,'runs'),'--engine',engine];
    const p=spawnSync(process.execPath,[cli,command,...common,...extra],{cwd:dir,encoding:'utf8',env:{...process.env,APP_ENV:'test',PARITY_SIMULATED_RUNTIME:'test-engine-v1',...env}});
    return {status:p.status,stdout:p.stdout,stderr:p.stderr,...(p.stdout ? {data:JSON.parse(p.stdout)} : {})};
  }
  async function review(run,verdict='PASS') {
    const capture=JSON.parse(await fs.readFile(path.join(run,'capture.json'),'utf8'));
    const file=path.join(dir,'verdicts.json');
    await fs.writeFile(file,JSON.stringify(capture.results.map(r => ({id:r.id,viewport:r.viewport,verdict,reason:'Visually inspected structure and layout',inspected:true}))));
    return call('record-review',['--run',run,'--reviewer','independent-reviewer','--author','implementer','--independent','yes','--verdicts',file]);
  }
  return {dir,call,review,config,engine};
}
test('context reduces routes, preserves conservative decisions and never exports session credentials',async t => {
  const {call}=await fixture(t), result=call('context'); assert.equal(result.status,0,result.stderr);
  const run=result.data.run;
  const cfg=JSON.parse(await fs.readFile(path.join(run,'parity.config.json'),'utf8'));
  assert.deepEqual(cfg.pairs.map(p => p.id),['A']); assert.equal(cfg.viewports.length,4);
  const deviations=await fs.readFile(path.join(run,'deviations.md'),'utf8');
  for(const text of ['Global decision','keep A','keep unknown','keep wildcard','keep ambiguous']) assert.ok(deviations.includes(text));
  assert.ok(!deviations.includes('omit B'));
  const all=(await Promise.all((await fs.readdir(run)).map(f => fs.readFile(path.join(run,f),'utf8')))).join('');
  assert.ok(!all.includes('TOP_SECRET'));assert.ok(!all.includes('private@example.test'));
  assert.ok(result.data.sourceBytes > result.data.outputBytes);
});
test('strict selection rejects empty, unknown, duplicate and ambiguous IDs',async t => {
  const {dir}=await fixture(t);
  for(const pairs of ['', 'Z','A,A','A,*','A,']) {
    const result=spawnSync(process.execPath,[cli,'context','--config',path.join(dir,'parity.config.json'),'--pairs',pairs],{encoding:'utf8'});
    assert.notEqual(result.status,0);
  }
});
test('fresh isolated captures preserve originals; explicit visual review alone enables candidates',async t => {
  const {call,review}=await fixture(t);
  const first=call('capture');assert.equal(first.status,0,first.stderr);
  assert.equal(first.data.comparisons.length,4);
  const run=first.data.run, before=await fs.readFile(path.join(run,'A.desktop.compare.png'));
  assert.equal((await review(run)).status,0);
  const second=call('capture',['--previous',run]);assert.equal(second.status,0,second.stderr);
  assert.notEqual(second.data.run,run);assert.ok(second.data.comparisons.every(r => r.visual === 'REUSE_CANDIDATE' && r.interactions === 'VERIFY_FRESH'));
  assert.deepEqual(await fs.readFile(path.join(run,'A.desktop.compare.png')),before);
  assert.ok(!(await fs.readdir(second.data.run)).includes('.engine-config.json'));
  assert.ok(!(await fs.readFile(path.join(second.data.run,'parity-report.json'),'utf8')).includes('TOP_SECRET'));
  assert.equal(second.data.globalVerdict,'NOT_ASSIGNED');
});
test('missing review, failed verdict or engine failure never enables reuse',async t => {
  const {call,review}=await fixture(t);
  const first=call('capture').data.run;
  assert.ok(call('capture',['--previous',first]).data.comparisons.every(r => r.visual === 'INSPECTION_REQUIRED'));
  assert.equal((await review(first,'FAIL')).status,0);
  assert.ok(call('capture',['--previous',first]).data.comparisons.every(r => r.visual === 'INSPECTION_REQUIRED'));
  const failed=call('capture',['--previous',first],{FAKE_ERROR:'1'});assert.equal(failed.status,2);
  assert.equal((await review(failed.data.run)).status,1);
});
test('altered image, report, review, config, deviations or engine invalidate reuse',async t => {
  for(const which of ['image','report','review','config','deviations','engine']) {
    const {call,review,dir,engine,config}=await fixture(t);
    const first=call('capture').data.run;assert.equal((await review(first)).status,0);
    const files={image:path.join(first,'A.desktop.compare.png'),report:path.join(first,'parity-report.json'),review:path.join(first,'review.json'),config:path.join(dir,'parity.config.json'),deviations:path.join(dir,'deviations.md'),engine};
    if(which === 'config') await fs.writeFile(files.config,JSON.stringify({...config,waitMs:500}));
    else await fs.appendFile(files[which],which === 'engine' ? '\n// version change' : ' ');
    const next=call('capture',['--previous',first]);assert.equal(next.status,0,next.stderr);
    assert.ok(next.data.comparisons.every(r => r.visual === 'INSPECTION_REQUIRED'),which);
  }
});
test('review requires independent identity, inspection and justification',async t => {
  const {call,dir}=await fixture(t), run=call('capture').data.run, file=path.join(dir,'invalid.json');
  await fs.writeFile(file,'[]');
  assert.equal(call('record-review',['--run',run,'--reviewer','same','--author','same','--independent','yes','--verdicts',file]).status,1);
  assert.equal(call('record-review',['--run',run,'--reviewer','reviewer','--author','author','--independent','yes','--verdicts',file]).status,1);
});

test('real-shaped duplicate IDs allow disjoint viewports and reject selected overlaps only',async t => {
  const {call,dir,config}=await fixture(t);
  const file=path.join(dir,'parity.config.json');
  config.pairs.push({...config.pairs[1]}); // Unselected historical ambiguity does not block A.
  config.pairs[0].viewports=['desktop','small-desktop'];
  config.pairs.push({...config.pairs[0],viewports:['tablet','mobile']});
  await fs.writeFile(file,JSON.stringify(config));
  const context=call('context');assert.equal(context.status,0,context.stderr);
  assert.deepEqual(context.data.pairs,['A']);
  const publicConfig=JSON.parse(await fs.readFile(path.join(context.data.run,'parity.config.json'),'utf8'));
  assert.equal(publicConfig.pairs.length,2);
  config.pairs.at(-1).viewports=['desktop','mobile'];
  await fs.writeFile(file,JSON.stringify(config));
  const overlap=call('context');assert.equal(overlap.status,1);
  assert.match(overlap.stderr,/overlapping pair\/viewport/);
});

test('context redacts fill credentials and sensitive URL parameters while preserving routing',async t => {
  const {dir,config,call}=await fixture(t);
  config.pairs[0].implSteps=[{fill:{selector:'input[type=password]',value:'FILL_SECRET'}}];
  config.pairs[0].impl='https://example.test/page?route=A&access_token=QUERY_SECRET#state=active&access_token=FRAGMENT_SECRET';
  await fs.writeFile(path.join(dir,'parity.config.json'),JSON.stringify(config));
  const result=call('context');assert.equal(result.status,0);
  const raw=await fs.readFile(path.join(result.data.run,'parity.config.json'),'utf8');
  for(const secret of ['FILL_SECRET','QUERY_SECRET','FRAGMENT_SECRET']) assert.ok(!raw.includes(secret));
  assert.ok(raw.includes('route=A'));assert.ok(raw.includes('state=active'));
});
test('fresh changed screenshots invalidate only changed pixels, with intact old evidence',async t => {
  const {call,review}=await fixture(t), first=call('capture').data.run;
  assert.equal((await review(first)).status,0);
  assert.ok(call('capture',['--previous',first],{FAKE_IMAGE:'changed'}).data.comparisons.every(r => r.visual === 'INSPECTION_REQUIRED'));
  assert.ok(call('capture',['--previous',first]).data.comparisons.every(r => r.visual === 'REUSE_CANDIDATE'));
});
test('reference contents, source path and runtime identity prevent reuse; unknown references fail closed',async t => {
  const {call,review,dir,config}=await fixture(t), first=call('capture').data.run;
  assert.equal((await review(first)).status,0);
  assert.ok(call('capture',['--previous',first],{PARITY_SIMULATED_RUNTIME:'test-engine-v2'}).data.comparisons.every(r => r.visual === 'INSPECTION_REQUIRED'));
  assert.ok(call('capture',['--previous',first],{PARITY_TOOLS_DIR:path.join(dir,'other-tools')}).data.comparisons.every(r => r.visual === 'INSPECTION_REQUIRED'));
  assert.equal(call('capture',['--previous',first],{PARITY_SIMULATED_RUNTIME:''}).data.reuseEligible,false);
  await fs.writeFile(path.join(dir,'mobile.png'),'different baseline');
  assert.ok(call('capture',['--previous',first]).data.comparisons.every(r => r.visual === 'INSPECTION_REQUIRED'));
  await fs.writeFile(path.join(dir,'mobile.png'),'baseline');
  await fs.appendFile(path.join(dir,'reference.html'),'changed');
  assert.ok(call('capture',['--previous',first]).data.comparisons.every(r => r.visual === 'INSPECTION_REQUIRED'));
  await fs.writeFile(path.join(dir,'reference.html'),'reference');
  await fs.rm(path.join(dir,'mobile.png'));
  const missing=call('capture',['--previous',first]);assert.equal(missing.status,0);assert.equal(missing.data.reuseEligible,false);
  assert.ok(missing.data.comparisons.every(r => r.visual === 'INSPECTION_REQUIRED'));
  // Same bytes copied under another canonical configuration path must invalidate context.
  await fs.writeFile(path.join(dir,'mobile.png'),'baseline');
  const copied=path.join(dir,'copied');await fs.mkdir(copied);
  for(const f of ['parity.config.json','proto.config.json','MANIFEST.md','deviations.md','reference.html','mobile.png']) await fs.copyFile(path.join(dir,f),path.join(copied,f));
  const result=spawnSync(process.execPath,[cli,'capture','--config',path.join(copied,'parity.config.json'),'--pairs','A','--engine',path.join(dir,'engine.mjs'),'--out',path.join(dir,'runs'),'--previous',first],{cwd:dir,encoding:'utf8',env:{...process.env,APP_ENV:'test',PARITY_SIMULATED_RUNTIME:'test-engine-v1'}});
  assert.equal(result.status,0,result.stderr);assert.ok(JSON.parse(result.stdout).comparisons.every(r => r.visual === 'INSPECTION_REQUIRED'));
});
test('correct-length reviews enforce each inspection guard and propagate approved decision',async t => {
  for(const change of ['false','missing','blank','decision','valid']) {
    const {call,dir}=await fixture(t), run=call('capture').data.run;
    const capture=JSON.parse(await fs.readFile(path.join(run,'capture.json'),'utf8'));
    const verdicts=capture.results.map(r => ({id:r.id,viewport:r.viewport,verdict:'PASS',reason:'Inspected all hotspots',inspected:true}));
    if(change === 'false') verdicts[0].inspected=false;
    if(change === 'missing') delete verdicts[0].inspected;
    if(change === 'blank') verdicts[0].reason='  ';
    if(['decision','valid'].includes(change)) verdicts[0].verdict='APPROVED_DEVIATION';
    if(change === 'valid') verdicts[0].decision='deviations.md#approved-A';
    const file=path.join(dir,'verdicts.json');await fs.writeFile(file,JSON.stringify(verdicts));
    const recorded=call('record-review',['--run',run,'--reviewer','reviewer','--author','author','--independent','yes','--verdicts',file]);
    assert.equal(recorded.status,change === 'valid' ? 0 : 1,change);
    if(change === 'valid') {
      const next=call('capture',['--previous',run]);
      assert.equal(next.data.comparisons[0].visual,'REUSE_CANDIDATE');
      assert.equal(next.data.comparisons[0].decision,'deviations.md#approved-A');
    }
  }
});
test('safe child failure categories reveal missing tooling but never raw secrets',async t => {
  const {call,engine}=await fixture(t);
  await fs.writeFile(engine,`console.error('playwright not found TOP_SECRET');process.exit(1);`);
  const result=call('capture');assert.equal(result.status,2);assert.equal(result.data.failure,'PLAYWRIGHT_UNAVAILABLE');
  assert.ok(!result.stdout.includes('TOP_SECRET'));assert.ok(!result.stderr.includes('TOP_SECRET'));
  const report=await fs.readFile(path.join(result.data.run,'parity-report.json'),'utf8');
  assert.ok(report.includes('PLAYWRIGHT_UNAVAILABLE'));assert.ok(!report.includes('TOP_SECRET'));
});
test('resolved Playwright metadata and explicit browser bytes control runtime reuse without simulation',async t => {
  const {call,review,dir}=await fixture(t);
  const tools=path.join(dir,'runtime-tools'), modules=path.join(tools,'node_modules');
  await fs.mkdir(path.join(modules,'playwright'),{recursive:true});
  await fs.mkdir(path.join(modules,'playwright-core'),{recursive:true});
  await fs.writeFile(path.join(tools,'package.json'),JSON.stringify({name:'fixture-tools'}));
  await fs.writeFile(path.join(modules,'playwright','package.json'),JSON.stringify({name:'playwright',version:'0.0.0-fixture',main:'index.js'}));
  await fs.writeFile(path.join(modules,'playwright','index.js'),'module.exports = {};');
  await fs.writeFile(path.join(modules,'playwright-core','package.json'),JSON.stringify({name:'playwright-core',version:'0.0.0-fixture'}));
  await fs.writeFile(path.join(modules,'playwright-core','browsers.json'),JSON.stringify({browsers:[{name:'chromium',revision:'fixture'}]}));
  const browser=path.join(tools,'browser');await fs.writeFile(browser,'browser revision one');
  const env={PARITY_SIMULATED_RUNTIME:'',PARITY_TOOLS_DIR:tools,PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH:browser};
  const first=call('capture',[],env);assert.equal(first.status,0,first.stderr);assert.equal(first.data.reuseEligible,true);
  const capture=JSON.parse(await fs.readFile(path.join(first.data.run,'capture.json'),'utf8'));
  assert.equal(capture.runtimeIdentity.known,true);assert.equal(capture.runtimeIdentity.simulated,undefined);
  const canonicalBrowser=await fs.realpath(browser);
  assert.ok(capture.runtimeIdentity.files.some(f => f.path === canonicalBrowser));
  assert.equal((await review(first.data.run)).status,0);
  const unchanged=call('capture',['--previous',first.data.run],env);assert.equal(unchanged.status,0,unchanged.stderr);
  assert.ok(unchanged.data.comparisons.every(r => r.visual === 'REUSE_CANDIDATE'));
  await fs.writeFile(browser,'browser revision two');
  const changed=call('capture',['--previous',first.data.run],env);assert.equal(changed.status,0,changed.stderr);
  assert.ok(changed.data.comparisons.every(r => r.visual === 'INSPECTION_REQUIRED'));
});
