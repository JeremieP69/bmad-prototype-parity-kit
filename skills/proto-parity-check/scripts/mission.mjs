#!/usr/bin/env node
// Native-only wrapper: the installed parity engine remains the capture authority.
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const VERSION = 2;
const sensitive = /session|login|password|passwd|secret|token|cookie|authorization|credential|storageState|user(name)?|email|api[_-]?key/i;
const hash = value => createHash('sha256').update(value).digest('hex');
const json = value => JSON.stringify(value, null, 2) + '\n';
const read = p => fs.readFile(p, 'utf8');
const readJson = async p => JSON.parse(await read(p));
const digest = async p => hash(await fs.readFile(p));
function ensure(condition, message) { if (!condition) throw new Error(message); }
function args(argv) {
  const [command, ...rest] = argv;
  const options = {};
  for (let i = 0; i < rest.length; i += 2) {
    ensure(/^--[a-z-]+$/.test(rest[i]) && rest[i + 1] && !rest[i + 1].startsWith('--'), 'Options require explicit values');
    const key = rest[i].slice(2);
    ensure(!Object.hasOwn(options, key), 'Duplicate option');
    options[key] = rest[i + 1];
  }
  const allowed = command === 'record-review' ? ['run', 'reviewer', 'author', 'verdicts', 'independent'] : ['config', 'proto-config', 'manifest', 'deviations', 'pairs', 'out', 'engine', 'previous'];
  ensure(['context', 'capture', 'record-review'].includes(command), 'Use context, capture or record-review');
  ensure(Object.keys(options).every(k => allowed.includes(k)), 'Unknown option');
  return { command, options };
}
// Remove authentication containers entirely, and redact other credential-like keys.
function publicConfig(value, key = '') {
  if (sensitive.test(key)) return '[redacted]';
  if (key === 'fill' && value && typeof value === 'object') return { ...publicConfig(value), value:'[redacted]' };
  if (Array.isArray(value)) return value.map(v => publicConfig(v));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k,v]) => [k, publicConfig(v,k)]));
  if (typeof value === 'string' && /^https?:\/\//.test(value)) {
    const url = new URL(value); url.username = ''; url.password = '';
    for (const name of [...url.searchParams.keys()]) if (sensitive.test(name)) url.searchParams.set(name,'[redacted]');
    url.hash = url.hash.replace(/([?&#]|^)([^=&#]+)=([^&#]*)/g, (all,sep,name) => sensitive.test(decodeURIComponent(name)) ? `${sep}${name}=[redacted]` : all);
    return url.href;
  }
  return value;
}
// Only discard unambiguously scoped table rows. Prose, wildcard/multiple/unknown scopes survive.
function filterMarkdown(text, selected, known) {
  return text.split('\n').filter(line => {
    if (!line.trim().startsWith('|')) return true;
    const first = line.split('|')[1].trim().replace(/^`|`$/g, '');
    return !known.has(first) || selected.has(first);
  }).join('\n');
}
async function load(options) {
  ensure(options.config && options.pairs, '--config and --pairs are mandatory');
  const configPath = path.resolve(options.config), base = path.dirname(configPath);
  const paths = { config: configPath, proto: path.resolve(options['proto-config'] || path.join(base, 'proto.config.json')), manifest: path.resolve(options.manifest || path.join(base, 'MANIFEST.md')), deviations: path.resolve(options.deviations || path.join(base, 'deviations.md')) };
  for (const key of Object.keys(paths)) paths[key] = await fs.realpath(paths[key]);
  const source = Object.fromEntries(await Promise.all(Object.entries(paths).map(async ([k,p]) => [k, await read(p)])));
  const config = JSON.parse(source.config), proto = JSON.parse(source.proto);
  const ids = options.pairs.split(',').map(s => s.trim());
  ensure(ids.every(id => /^[A-Za-z0-9_-]+$/.test(id)) && new Set(ids).size === ids.length, 'Empty or ambiguous --pairs');
  ensure(Array.isArray(config.pairs), 'Invalid pairs');
  ensure(ids.every(id => config.pairs.some(p => p.id === id)), 'Requested pair is absent from configuration');
  ensure(Array.isArray(config.viewports) && config.viewports.length && config.viewports.every(v => /^[A-Za-z0-9_-]+$/.test(v.name) && v.width > 0 && v.height > 0) && new Set(config.viewports.map(v => v.name)).size === config.viewports.length, 'Invalid viewports');
  const pairs = config.pairs.filter(p => ids.includes(p.id));
  const combinations = new Set();
  for (const p of pairs) for (const v of config.viewports) {
    if (p.viewports && !p.viewports.includes(v.name)) continue;
    const key = `${p.id}.${v.name}`;
    ensure(!combinations.has(key), 'Invalid overlapping pair/viewport definitions');
    combinations.add(key);
  }
  for (const p of pairs) ensure(!p.viewports || (p.viewports.length && p.viewports.every(v => config.viewports.some(x => x.name === v))), 'Invalid pair viewport restriction');
  const selected = new Set(ids);
  // Pair IDs can name states while the prototype hash names its canonical route.
  for (const p of pairs) {
    selected.add(p.id.split('__')[0]);
    const route = p.proto?.split('#')[1]; if (route) selected.add(route);
  }
  const known = new Set([...config.pairs.map(p => p.id), ...(proto.routes || []).map(r => typeof r === 'string' ? r : r?.id).filter(Boolean)]);
  const subsetProto = { ...proto, routes: (proto.routes || []).filter(r => typeof r === 'string' ? selected.has(r) : !r?.id || selected.has(r.id)) };
  return { config, pairs, base, paths, source, publicFiles: {
    'parity.config.json': json(publicConfig({ ...config, pairs })),
    'proto.config.json': json(publicConfig(subsetProto)),
    'MANIFEST.md': filterMarkdown(source.manifest, selected, known),
    'deviations.md': filterMarkdown(source.deviations, selected, known),
  } };
}
async function createRun(options, loaded) {
  const root = path.resolve(options.out || 'tools/parity/runs');
  await fs.mkdir(root, { recursive: true });
  const run = path.join(root, new Date().toISOString().replaceAll(':','-') + '-' + randomUUID());
  await fs.mkdir(run, { mode: 0o700 });
  for (const [name, content] of Object.entries(loaded.publicFiles)) await fs.writeFile(path.join(run,name), content, { mode: 0o600 });
  const sources = Object.fromEntries(Object.entries(loaded.paths).map(([k,p]) => [k, { path:p, sha256: hash(loaded.source[k]), bytes:Buffer.byteLength(loaded.source[k]) }]));
  const summary = { version:VERSION, sources, pairs:[...new Set(loaded.pairs.map(p => p.id))], sourceBytes:Object.values(sources).reduce((n,s) => n+s.bytes,0), outputBytes:Object.values(loaded.publicFiles).reduce((n,s) => n+Buffer.byteLength(s),0) };
  await fs.writeFile(path.join(run,'context.json'), json(summary));
  return run;
}
async function seal(run, files) {
  const hashes = Object.fromEntries(await Promise.all(files.map(async f => [f, await digest(path.join(run,f))])));
  await fs.writeFile(path.join(run,'integrity.json'), json(hashes), { flag:'wx' });
}
async function validate(run, review = false) {
  const integrity = await readJson(path.join(run,'integrity.json'));
  ensure(['capture.json','parity-report.json','context.json','parity.config.json','proto.config.json','MANIFEST.md','deviations.md'].every(f => integrity[f]), 'Missing integrity entry');
  for (const [file, expected] of Object.entries(integrity)) {
    ensure(path.basename(file) === file && await digest(path.join(run,file)) === expected, 'Evidence integrity failure');
  }
  const capture = await readJson(path.join(run,'capture.json'));
  ensure(capture.version === VERSION && capture.complete && capture.results.length > 0, 'Incomplete or incompatible capture');
  for (const result of capture.results) ensure(integrity[result.composite] && result.imageHash === integrity[result.composite], 'Missing image integrity entry');
  if (!review) return capture;
  const raw = await read(path.join(run,'review.json'));
  ensure(hash(raw) === (await read(path.join(run,'review.sha256'))).trim(), 'Review integrity failure');
  const verdict = JSON.parse(raw);
  ensure(verdict.version === VERSION && verdict.captureHash === integrity['capture.json'] && verdict.independent === true && verdict.reviewer !== verdict.author, 'Invalid review provenance');
  return { capture, verdict };
}
async function recordReview(options) {
  ensure(options.run && options.reviewer && options.author && options.verdicts && options.independent === 'yes' && options.reviewer.trim() !== options.author.trim(), 'Explicit independent reviewer and distinct author required');
  const run = path.resolve(options.run), capture = await validate(run);
  const verdicts = await readJson(path.resolve(options.verdicts));
  ensure(Array.isArray(verdicts) && verdicts.length === capture.results.length, 'One explicit verdict per comparison required');
  const seen = new Set();
  for (const v of verdicts) {
    const key = `${v.id}.${v.viewport}`;
    ensure(!seen.has(key) && capture.results.some(r => r.id === v.id && r.viewport === v.viewport) && ['PASS','FAIL','APPROVED_DEVIATION'].includes(v.verdict) && typeof v.reason === 'string' && v.reason.trim().length > 0 && v.inspected === true, 'Invalid, duplicate or uninspected verdict');
    ensure(v.verdict !== 'APPROVED_DEVIATION' || (typeof v.decision === 'string' && v.decision.trim()), 'Approved deviation requires decision reference');
    seen.add(key);
  }
  const review = { version:VERSION, reviewer:options.reviewer.trim(), author:options.author.trim(), independent:true, created:new Date().toISOString(), captureHash:await digest(path.join(run,'capture.json')), verdicts, interactions:'NOT_REUSED: verify real navigation and gestures for this mission' };
  const raw = json(review);
  await fs.writeFile(path.join(run,'review.json'),raw,{flag:'wx'});
  await fs.writeFile(path.join(run,'review.sha256'),hash(raw)+'\n',{flag:'wx'});
  console.log(json({run, recorded:true, interactions:review.interactions}));
}
function absoluteReference(value, base) {
  if (!value || /^(https?:\/\/|file:\/\/)/.test(value)) return value;
  const at = value.indexOf('#');
  return path.resolve(base, at < 0 ? value : value.slice(0,at)) + (at < 0 ? '' : value.slice(at));
}

function failureCategory(message = '') {
  if (/playwright not found|cannot find module.*playwright/i.test(message)) return 'PLAYWRIGHT_UNAVAILABLE';
  if (/executable doesn.t exist|browser.*not found|failed to launch|browserType.launch/i.test(message)) return 'BROWSER_UNAVAILABLE';
  if (/ERR_CONNECTION|ECONNREFUSED|ENOTFOUND/i.test(message)) return 'SERVER_UNAVAILABLE';
  if (/timeout|timed out/i.test(message)) return 'CAPTURE_TIMEOUT';
  if (/Unknown session|authentication|unauthorized|login/i.test(message)) return 'AUTHENTICATION_FAILURE';
  if (/ENOENT|no such file/i.test(message)) return 'REFERENCE_UNAVAILABLE';
  return 'ENGINE_FAILURE';
}
async function artifactIdentity(value, base, baseline = false) {
  try {
    if (!value || /^https?:\/\//.test(value)) return { known:false };
    let file;
    if (baseline) file = path.resolve(base,value);
    else if (value.startsWith('file://')) {
      file = fileURLToPath(new URL(value));
      const marker = `${path.sep}_bmad-output${path.sep}`;
      const index = file.indexOf(marker);
      if (index >= 0) file = path.resolve(process.cwd(),file.slice(index+1));
    } else file = path.resolve(base,value.split('#')[0]);
    file = await fs.realpath(file);
    return { known:true, path:file, sha256:await digest(file) };
  } catch { return { known:false }; }
}
async function referenceIdentity(loaded) {
  const references = [];
  for (const p of loaded.pairs) for (const v of loaded.config.viewports) {
    if (p.viewports && !p.viewports.includes(v.name)) continue;
    const baseline = p.baselineImages?.[v.name] ?? p.baselineImage?.replaceAll('{viewport}',v.name);
    references.push({id:p.id,viewport:v.name,...await artifactIdentity(baseline || p.proto?.replaceAll('{viewport}',v.name),loaded.base,Boolean(baseline))});
  }
  return references;
}
async function executionIdentity(options, engine, toolsDir) {
  const selectedTools = await fs.realpath(toolsDir).catch(() => toolsDir);
  if (options.engine && process.env.APP_ENV === 'test' && process.env.PARITY_SIMULATED_RUNTIME) {
    return { known:true, simulated:true, toolsDir:selectedTools, identity:process.env.PARITY_SIMULATED_RUNTIME };
  }
  for (const from of [path.join(toolsDir,'package.json'),path.join(process.cwd(),'package.json'),path.join(path.dirname(engine),'package.json')]) {
    try {
      const require = createRequire(from);
      require('playwright');
      // Default headless launch may select a different executable than chromium.executablePath().
      if (!process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH) return {known:false,toolsDir:selectedTools};
      const packageFile = await fs.realpath(require.resolve('playwright/package.json'));
      const coreRequire = createRequire(packageFile);
      const coreFile = await fs.realpath(coreRequire.resolve('playwright-core/package.json'));
      const browser = await fs.realpath(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH);
      const entry = await fs.realpath(require.resolve('playwright'));
      const files = [packageFile,entry,coreFile,path.join(path.dirname(coreFile),'browsers.json'),browser];
      return { known:true, toolsDir:selectedTools, files:await Promise.all(files.map(async file => ({path:file,sha256:await digest(file)}))) };
    } catch (error) { if (error?.code !== 'MODULE_NOT_FOUND') return {known:false,toolsDir:selectedTools}; }
  }
  return {known:false,toolsDir:selectedTools};
}

async function capture(options, loaded, run) {
  const engine = path.resolve(options.engine || fileURLToPath(new URL('./parity_check.mjs', import.meta.url)));
  const toolsDir = path.resolve(process.env.PARITY_TOOLS_DIR || 'tools/parity');
  const runtimeIdentity = await executionIdentity(options,engine,toolsDir);
  const references = await referenceIdentity(loaded);
  const reuseEligible = runtimeIdentity.known && references.every(r => r.known);
  const engineHash = await digest(engine), wrapperHash = await digest(fileURLToPath(import.meta.url));
  const selectedConfig = { ...loaded.config, outDir:run, pairs:loaded.pairs.map(p => ({ ...p,
    proto:absoluteReference(p.proto,loaded.base), impl:absoluteReference(p.impl,loaded.base),
    ...(p.baselineImage ? { baselineImage:path.resolve(loaded.base,p.baselineImage) } : {}),
    ...(p.baselineImages ? { baselineImages:Object.fromEntries(Object.entries(p.baselineImages).map(([k,v]) => [k,path.resolve(loaded.base,v)])) } : {}),
  })) };
  const expected = loaded.config.viewports.flatMap(v => loaded.pairs.filter(p => !p.viewports || p.viewports.includes(v.name)).map(p => ({id:p.id,viewport:v.name})));
  const configPath = path.join(run,'.engine-config.json');
  await fs.writeFile(configPath,json(selectedConfig),{mode:0o600,flag:'wx'});
  let code, stderr = '';
  try {
    code = await new Promise((resolve,reject) => {
      const child = spawn(process.execPath,[engine,'--config',configPath,'--pairs',[...new Set(loaded.pairs.map(p => p.id))].join(',')], { cwd:process.cwd(), env:{...process.env, PARITY_TOOLS_DIR:toolsDir}, stdio:['ignore','ignore','pipe'] });
      child.stderr.on('data',chunk => { if (stderr.length < 65536) stderr += chunk.toString().slice(0,65536-stderr.length); });
      child.on('error',reject); child.on('close',resolve);
    });
  } finally { await fs.rm(configPath,{force:true}); }
  // Never expose raw engine errors, which may contain login/session values.
  let report;
  try { report = await readJson(path.join(run,'parity-report.json')); } catch { report = {results:[]}; }
  await fs.rm(path.join(run,'parity-report.md'),{force:true});
  const results = [];
  for (const item of expected) {
    const matches = (report.results || []).filter(r => r.id === item.id && r.viewport === item.viewport);
    const r = matches[0], composite = `${item.id}.${item.viewport}.compare.png`;
    let imageHash = null;
    try { imageHash = await digest(path.join(run,composite)); } catch { /* Missing images block reuse. */ }
    const valid = matches.length === 1 && ['close','review','divergent'].includes(r?.status) && r.composite === composite && Number.isFinite(r.mismatchPct) && imageHash;
    results.push({...item,status:valid ? r.status : 'error', ...(valid ? {} : {failure:failureCategory(r?.error || stderr)}), mismatchPct:valid ? r.mismatchPct : null,composite,imageHash,hotspots:valid && Array.isArray(r.hotspots) ? r.hotspots.filter(b => ['yStart','yEnd','pct'].every(k => Number.isFinite(b[k]))).map(({yStart,yEnd,pct}) => ({yStart,yEnd,pct})) : []});
  }
  const complete = code === 0 && results.every(r => r.status !== 'error') && report.results?.length === expected.length;
  await fs.writeFile(path.join(run,'parity-report.json'),json({results, note:'Mechanical signal only; errors require inspection.'}));
  const failure = complete ? null : failureCategory(stderr || (report.results || []).find(r => r.error)?.error);
  const contextHash = hash(json({ paths:loaded.paths, references, runtimeIdentity, sources:Object.fromEntries(Object.entries(loaded.source).map(([k,v]) => [k,hash(v)])), engineHash,wrapperHash,cwd:process.cwd(),runtime:process.version,chromium:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || 'playwright-default' }));
  let previous;
  if (options.previous) { try { previous = await validate(path.resolve(options.previous),true); } catch { /* Fail closed. */ } }
  const comparisons = results.map(r => {
    const old = previous?.capture.results.find(o => o.id === r.id && o.viewport === r.viewport);
    const verdict = previous?.verdict.verdicts.find(v => v.id === r.id && v.viewport === r.viewport);
    const candidate = Boolean(complete && reuseEligible && previous?.capture.reuseEligible && previous?.capture.contextHash === contextHash && old?.imageHash === r.imageHash && ['PASS','APPROVED_DEVIATION'].includes(verdict?.verdict));
    return {id:r.id,viewport:r.viewport,mechanical:r.status,visual:candidate ? 'REUSE_CANDIDATE' : 'INSPECTION_REQUIRED', ...(candidate ? {previous:path.resolve(options.previous),verdict:verdict.verdict,reason:verdict.reason,...(verdict.decision ? {decision:verdict.decision} : {})} : {}), interactions:'VERIFY_FRESH'};
  });
  await fs.writeFile(path.join(run,'capture.json'),json({version:VERSION,complete,failure,reuseEligible,references,runtimeIdentity,contextHash,engineHash,wrapperHash,results,comparisons,globalVerdict:'NOT_ASSIGNED'}));
  await seal(run,['context.json',...Object.keys(loaded.publicFiles),'parity-report.json','capture.json',...results.filter(r => r.imageHash).map(r => r.composite)]);
  console.log(json({run,complete,failure,reuseEligible,comparisons,globalVerdict:'NOT_ASSIGNED'}));
  if (!complete) process.exitCode = 2;
}
async function main() {
  const {command,options} = args(process.argv.slice(2));
  if (command === 'record-review') return recordReview(options);
  const loaded = await load(options), run = await createRun(options,loaded);
  if (command === 'capture') await capture(options,loaded,run);
  else console.log(json({run,...await readJson(path.join(run,'context.json'))}));
}
main().catch(error => { console.error('Parity mission failed: ' + (/^(Options|Duplicate|Use |Unknown option|--config|Empty or|Invalid |Requested pair|Explicit |One explicit|Approved deviation|Missing integrity|Evidence integrity|Incomplete or|Review integrity|Missing image)/.test(error.message) ? error.message : 'Unable to process inputs or evidence; inspect source files locally.')); process.exitCode = 1; });
