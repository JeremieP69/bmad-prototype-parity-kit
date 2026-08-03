#!/usr/bin/env node
// Capture per-route baseline screenshots + rendered DOM from a browser-renderable
// prototype. Config schema: ../references/proto-config-schema.md
// Requires Node >= 18 and playwright resolvable from: $PARITY_TOOLS_DIR,
// the current project, or this script's directory.

import fs from 'node:fs/promises';
import { readFileSync, realpathSync } from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

export function loadPlaywright() {
  const candidates = [
    process.env.PARITY_TOOLS_DIR && path.join(process.env.PARITY_TOOLS_DIR, 'package.json'),
    path.join(process.cwd(), 'package.json'),
    path.join(path.dirname(fileURLToPath(import.meta.url)), 'package.json'),
  ].filter(Boolean);
  for (const from of candidates) {
    try {
      return createRequire(from)('playwright');
    } catch (error) {
      if (error?.code !== 'MODULE_NOT_FOUND') throw error;
    }
  }
  throw new Error(
    'playwright not found. Install it once with:\n' +
    '  npm install playwright\n' +
    'in your project, or in a tools dir exported as PARITY_TOOLS_DIR.'
  );
}

export function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) { args[key] = true; continue; }
    args[key] = next;
    i += 1;
  }
  return args;
}

export function resolveUrl(base, configDir) {
  if (/^(https?|file):\/\//.test(base)) return base;
  return pathToFileURL(path.resolve(configDir, base)).href;
}

export function routeUrl(config, routeId) {
  const mode = config.navigation?.mode || 'hash';
  const base = config.prototypeUrl;
  if (mode === 'hash') return `${base}#${routeId}`;
  if (mode === 'query') {
    const param = config.navigation.param || 'route';
    const sep = base.includes('?') ? '&' : '?';
    return `${base}${sep}${param}=${encodeURIComponent(routeId)}`;
  }
  if (mode === 'path') return `${base.replace(/\/$/, '')}/${routeId}`;
  return base; // click mode: navigate via steps
}

export function normalizeRoutes(routes) {
  return routes.map((r) => (typeof r === 'string' ? { id: r, steps: null } : r));
}

export function isDirectExecution(argvPath, moduleUrl = import.meta.url) {
  if (!argvPath) return false;
  try {
    return realpathSync(argvPath) === realpathSync(fileURLToPath(moduleUrl));
  } catch {
    return false;
  }
}

async function protoHash(url) {
  if (url.startsWith('file://')) {
    const filePath = fileURLToPath(url.split('#')[0]);
    return crypto.createHash('sha256').update(readFileSync(filePath)).digest('hex').slice(0, 16);
  }
  try {
    const res = await fetch(url);
    return crypto.createHash('sha256').update(Buffer.from(await res.arrayBuffer())).digest('hex').slice(0, 16);
  } catch {
    return 'unhashed-remote';
  }
}

export async function settle(page, config) {
  if (config.readySelector) {
    await page.waitForSelector(config.readySelector, { timeout: 15000 });
  }
  await page.waitForTimeout(config.waitMs ?? 1000);
}

async function captureRoute(browser, config, route, outDir, manifestRows) {
  for (const viewport of config.viewports) {
    const context = await browser.newContext({
      viewport: { width: viewport.width, height: viewport.height },
      deviceScaleFactor: 1,
    });
    const page = await context.newPage();
    try {
      await page.goto(routeUrl(config, route.base || route.id), { waitUntil: 'load', timeout: 30000 });
      if (route.steps) {
        await settle(page, config);
        for (const step of route.steps) {
          if (step.click) await page.click(step.click, { timeout: 10000 });
          if (step.fill) await page.fill(step.fill.selector, step.fill.value, { timeout: 10000 });
          if (step.hover) await page.hover(step.hover, { timeout: 10000 });
          if (step.scrollTo) {
            await page.locator(step.scrollTo).first().scrollIntoViewIfNeeded({ timeout: 10000 });
          }
          if (step.waitMs) await page.waitForTimeout(step.waitMs);
        }
      }
      await settle(page, config);

      const pngPath = path.join(outDir, 'baselines', `${route.id}.${viewport.name}.png`);
      await page.screenshot({ path: pngPath, fullPage: (route.fullPage ?? config.fullPage) !== false });

      const rendered = await page.evaluate((rootSelector) => {
        const root = document.querySelector(rootSelector) || document.body;
        const clone = root.cloneNode(true);
        clone.querySelectorAll('script').forEach((node) => node.remove());
        return clone.outerHTML;
      }, config.renderedRootSelector || 'body');
      const htmlPath = path.join(outDir, 'rendered', `${route.id}.${viewport.name}.html`);
      await fs.writeFile(
        htmlPath,
        `<!-- Rendered DOM captured from prototype route ${route.id} (${viewport.name}). Generated file: do not edit. -->\n<!DOCTYPE html>\n${rendered}\n`,
        'utf8'
      );

      const size = await page.evaluate(() => ({
        w: document.documentElement.scrollWidth,
        h: document.documentElement.scrollHeight,
      }));
      manifestRows.push({ route: route.id, viewport: viewport.name, size, ok: true });
      process.stdout.write(`captured ${route.id} ${viewport.name} (${size.w}x${size.h})\n`);
    } catch (error) {
      manifestRows.push({ route: route.id, viewport: viewport.name, ok: false, error: String(error.message || error) });
      process.stderr.write(`FAILED ${route.id} ${viewport.name}: ${error.message || error}\n`);
    } finally {
      await context.close();
    }
  }
}

function manifestMarkdown(hash, config, rows) {
  const lines = [
    '# Design Source Manifest',
    '',
    `- Prototype: \`${config.prototypeUrl}\``,
    `- Prototype content hash: \`${hash}\``,
    `- Captured: ${new Date().toISOString()}`,
    `- Viewports: ${config.viewports.map((v) => `${v.name} ${v.width}x${v.height}`).join(', ')}`,
    '',
    '| Route | Viewport | Rendered size | Baseline | Rendered HTML | Status |',
    '|---|---|---|---|---|---|',
  ];
  for (const row of rows) {
    const status = row.ok ? 'ok' : `FAILED: ${row.error}`;
    const size = row.size ? `${row.size.w}x${row.size.h}` : '-';
    lines.push(
      `| ${row.route} | ${row.viewport} | ${size} | baselines/${row.route}.${row.viewport}.png | rendered/${row.route}.${row.viewport}.html | ${status} |`
    );
  }
  lines.push('');
  return lines.join('\n');
}

async function checkStale(config, outDir) {
  const currentHash = await protoHash(config.prototypeUrl);
  let recordedHash = null;
  try {
    const manifest = await fs.readFile(path.join(outDir, 'MANIFEST.md'), 'utf8');
    recordedHash = manifest.match(/Prototype content hash: `([^`]+)`/)?.[1] ?? null;
  } catch {
    // no manifest yet
  }
  if (!recordedHash) {
    console.log('no-manifest: design source has never been extracted for this config.');
    return 3;
  }
  if (currentHash === 'unhashed-remote') {
    console.log('unknown: remote prototype could not be hashed - ask the user whether it changed.');
    return 4;
  }
  if (currentHash === recordedHash) {
    console.log(`fresh: prototype hash ${currentHash} matches the manifest.`);
    return 0;
  }
  console.log(`stale: prototype hash ${currentHash} differs from manifest hash ${recordedHash} - re-run the capture.`);
  return 3;
}

async function main() {
  const args = parseArgs(process.argv);
  if (!args.config || args.help) {
    console.log('Usage: node capture_baselines.mjs --config proto.config.json [--routes A,B,C] [--check-stale]');
    process.exit(args.help ? 0 : 1);
  }
  const configPath = path.resolve(args.config);
  const configDir = path.dirname(configPath);
  const config = JSON.parse(await fs.readFile(configPath, 'utf8'));
  config.prototypeUrl = resolveUrl(config.prototype, configDir);

  if (args['check-stale']) {
    process.exit(await checkStale(config, path.resolve(configDir, config.outDir || '.')));
  }

  let routes = normalizeRoutes(config.routes || []);
  if (args.routes) {
    const wanted = new Set(String(args.routes).split(','));
    routes = routes.filter((r) => wanted.has(r.id));
    const missing = [...wanted].filter((id) => !routes.some((r) => r.id === id));
    if (missing.length) throw new Error(`Routes not in config: ${missing.join(', ')}`);
  }
  if (!routes.length) throw new Error('No routes to capture.');

  const outDir = path.resolve(configDir, config.outDir || '.');
  await fs.mkdir(path.join(outDir, 'baselines'), { recursive: true });
  await fs.mkdir(path.join(outDir, 'rendered'), { recursive: true });

  const hash = await protoHash(config.prototypeUrl);
  const { chromium } = loadPlaywright();
  const browser = await chromium.launch({ headless: true });
  const manifestRows = [];
  try {
    for (const route of routes) {
      await captureRoute(browser, config, route, outDir, manifestRows);
    }
  } finally {
    await browser.close();
  }

  await fs.writeFile(path.join(outDir, 'MANIFEST.md'), manifestMarkdown(hash, config, manifestRows), 'utf8');
  const failed = manifestRows.filter((r) => !r.ok);
  console.log(`\n${manifestRows.length - failed.length}/${manifestRows.length} captures ok. Manifest: ${path.join(outDir, 'MANIFEST.md')}`);
  if (failed.length) process.exit(2);
}

if (isDirectExecution(process.argv[1])) {
  main().catch((error) => {
    console.error(error.message || error);
    process.exit(1);
  });
}
