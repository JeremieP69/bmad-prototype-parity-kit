import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs, resolveUrl, routeUrl, normalizeRoutes } from '../capture_baselines.mjs';

test('parseArgs reads key/value pairs and boolean flags', () => {
  const args = parseArgs(['node', 'x', '--config', 'a.json', '--check-stale', '--routes', 'A,B']);
  assert.equal(args.config, 'a.json');
  assert.equal(args['check-stale'], true);
  assert.equal(args.routes, 'A,B');
});

test('resolveUrl keeps absolute urls and resolves relative paths to file urls', () => {
  assert.equal(resolveUrl('https://example.test/p', '/tmp'), 'https://example.test/p');
  assert.equal(resolveUrl('file:///x/y.html', '/tmp'), 'file:///x/y.html');
  assert.ok(resolveUrl('proto.html', '/tmp').startsWith('file:///'));
  assert.ok(resolveUrl('proto.html', '/tmp').endsWith('/tmp/proto.html'));
});

test('routeUrl builds hash, query and path navigation urls', () => {
  const base = { prototypeUrl: 'file:///p.html' };
  assert.equal(routeUrl({ ...base, navigation: { mode: 'hash' } }, 'HOME'), 'file:///p.html#HOME');
  assert.equal(routeUrl({ ...base, navigation: { mode: 'query' } }, 'HOME'), 'file:///p.html?route=HOME');
  assert.equal(
    routeUrl({ ...base, navigation: { mode: 'query', param: 'screen' } }, 'HOME'),
    'file:///p.html?screen=HOME'
  );
  assert.equal(
    routeUrl({ prototypeUrl: 'https://x.test/', navigation: { mode: 'path' } }, 'HOME'),
    'https://x.test/HOME'
  );
  assert.equal(routeUrl({ ...base, navigation: { mode: 'click' } }, 'HOME'), 'file:///p.html');
});

test('normalizeRoutes accepts strings and objects, preserving base and steps', () => {
  const routes = normalizeRoutes(['HOME', { id: 'HOME__MODAL', base: 'HOME', steps: [{ click: 'text=Open' }] }]);
  assert.deepEqual(routes[0], { id: 'HOME', steps: null });
  assert.equal(routes[1].id, 'HOME__MODAL');
  assert.equal(routes[1].base, 'HOME');
  assert.equal(routes[1].steps.length, 1);
});

test('CLI executes through a symlinked path', (t) => {
  const tempDir = mkdtempSync(path.join(tmpdir(), 'proto-design-source-cli-'));
  const target = fileURLToPath(new URL('../capture_baselines.mjs', import.meta.url));
  const link = path.join(tempDir, 'capture_baselines.mjs');
  try {
    try {
      symlinkSync(target, link);
    } catch (error) {
      if (['EPERM', 'EACCES', 'ENOSYS'].includes(error?.code)) {
        t.skip(`symlinks unavailable: ${error.code}`);
        return;
      }
      throw error;
    }
    const result = spawnSync(process.execPath, [link, '--help'], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Usage: node capture_baselines\.mjs/);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});
