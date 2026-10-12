import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const engine = fileURLToPath(new URL('../parity_check.mjs', import.meta.url));
const mission = fileURLToPath(new URL('../mission.mjs', import.meta.url));

test('capture, probe and portable mission launch the explicitly fingerprinted browser', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ppk-browser-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const pkg = path.join(dir, 'node_modules/playwright');
  await fs.mkdir(pkg, { recursive: true });
  await fs.writeFile(path.join(pkg, 'index.js'), `exports.chromium = { launch: async options => {
    require('node:fs').writeFileSync(process.env.LAUNCH_RECORD, JSON.stringify(options));
    throw new Error('intentional stop before opening browser');
  }};`);
  const config = path.join(dir, 'parity.config.json');
  await fs.writeFile(config, JSON.stringify({viewports:[{name:'desktop',width:1440,height:900}],pairs:[{id:'HOME',proto:'reference.html#HOME',impl:'http://127.0.0.1:8000/'}]}));
  await fs.writeFile(path.join(dir, 'proto.config.json'), JSON.stringify({routes:['HOME']}));
  await fs.writeFile(path.join(dir, 'MANIFEST.md'), '# reference');
  await fs.writeFile(path.join(dir, 'deviations.md'), '# decisions');
  const browser = path.join(dir, 'explicit-browser');
  const record = path.join(dir, 'launch.json');
  const env = {...process.env, PARITY_TOOLS_DIR:dir, PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH:browser, LAUNCH_RECORD:record};
  for (const [script, args] of [
    [engine, ['--config',config,'--pairs','HOME']],
    [engine, ['--config',config,'--probe','HOME','--selector','body']],
    [mission, ['capture','--config',config,'--pairs','HOME','--out',path.join(dir,'runs')]],
  ]) {
    await fs.rm(record, {force:true});
    const result = spawnSync(process.execPath, [script, ...args], {cwd:dir,env,encoding:'utf8'});
    assert.notEqual(result.status, 0, 'fixture intentionally stops at browser launch');
    assert.deepEqual(JSON.parse(await fs.readFile(record,'utf8')), {headless:true, executablePath:browser});
  }
});
