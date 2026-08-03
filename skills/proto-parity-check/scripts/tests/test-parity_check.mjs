import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs, resolveUrl, statusFor } from '../parity_check.mjs';

test('parseArgs reads pairs, strict flag and report name', () => {
  const args = parseArgs(['node', 'x', '--config', 'p.json', '--pairs', 'A,B', '--strict', '--report-name', 'story-12']);
  assert.equal(args.config, 'p.json');
  assert.equal(args.pairs, 'A,B');
  assert.equal(args.strict, true);
  assert.equal(args['report-name'], 'story-12');
});

test('parseArgs reads probe options', () => {
  const args = parseArgs(['node', 'x', '--config', 'p.json', '--probe', 'HOME', '--selector', '.el', '--viewport', 'mobile']);
  assert.equal(args.probe, 'HOME');
  assert.equal(args.selector, '.el');
  assert.equal(args.viewport, 'mobile');
});

test('resolveUrl keeps http/file urls and resolves relative paths', () => {
  assert.equal(resolveUrl('http://127.0.0.1:8000/app', '/tmp'), 'http://127.0.0.1:8000/app');
  assert.ok(resolveUrl('proto.html', '/tmp').startsWith('file:///'));
});

test('statusFor classifies against thresholds with defaults', () => {
  assert.equal(statusFor(0, {}), 'close');
  assert.equal(statusFor(5, {}), 'close');
  assert.equal(statusFor(5.1, {}), 'review');
  assert.equal(statusFor(15, {}), 'review');
  assert.equal(statusFor(15.1, {}), 'divergent');
  assert.equal(statusFor(9, { warnPct: 10, failPct: 20 }), 'close');
  assert.equal(statusFor(19, { warnPct: 10, failPct: 20 }), 'review');
  assert.equal(statusFor(21, { warnPct: 10, failPct: 20 }), 'divergent');
});

test('CLI executes through a symlinked path', (t) => {
  const tempDir = mkdtempSync(path.join(tmpdir(), 'proto-parity-check-cli-'));
  const target = fileURLToPath(new URL('../parity_check.mjs', import.meta.url));
  const link = path.join(tempDir, 'parity_check.mjs');
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
    assert.match(result.stdout, /Usage: node parity_check\.mjs/);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});
