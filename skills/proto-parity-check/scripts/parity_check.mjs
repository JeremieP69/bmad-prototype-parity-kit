#!/usr/bin/env node
// Compare prototype routes against implementation URLs: captures both sides,
// produces side-by-side composite PNGs with a diff heatmap panel and a
// mismatch percentage per pair/viewport. The percentage is a triage signal;
// final judgment is made by reviewing the composites.
// Requires Node >= 18 and playwright (see capture_baselines.mjs resolution rules).

import fs from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

function loadPlaywright() {
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

export function isDirectExecution(argvPath, moduleUrl = import.meta.url) {
  if (!argvPath) return false;
  try {
    return realpathSync(argvPath) === realpathSync(fileURLToPath(moduleUrl));
  } catch {
    return false;
  }
}

async function login(page, loginConfig) {
  await page.goto(loginConfig.url, { waitUntil: 'load', timeout: 30000 });
  await page.fill(loginConfig.userSelector || 'input[type="email"], input[name*="email" i], input[name*="user" i]', loginConfig.user);
  await page.fill(loginConfig.passwordSelector || 'input[type="password"]', loginConfig.password);
  await page.click(loginConfig.submitSelector || 'button[type="submit"], input[type="submit"]');
  await page.waitForLoadState('load');
  await page.waitForTimeout(500);
}

// Steps reach states that have no directly addressable URL (wizard flows,
// role-guarded screens, overlays, hover reveals, anchor scrolls):
// [{ "click": "sel" }, { "fill": { "selector": "sel", "value": "v" } },
//  { "hover": "sel" }, { "scrollTo": "sel" }, { "waitMs": 500 }]
async function runSteps(page, steps) {
  for (const step of steps || []) {
    if (step.goto) await page.goto(step.goto, { waitUntil: 'load', timeout: 30000 });
    if (step.check) await page.locator(step.check).check({ force: true, timeout: 10000 });
    if (step.click) await page.click(step.click, { timeout: 10000 });
    if (step.fill) await page.fill(step.fill.selector, step.fill.value, { timeout: 10000 });
    if (step.hover) await page.hover(step.hover, { timeout: 10000 });
    if (step.scrollTo) {
      await page.locator(step.scrollTo).first().scrollIntoViewIfNeeded({ timeout: 10000 });
    }
    if (step.waitMs) await page.waitForTimeout(step.waitMs);
  }
}

async function capture(page, url, options) {
  await page.goto(url, { waitUntil: 'load', timeout: 30000 });
  await runSteps(page, options.steps);
  if (options.readySelector) await page.waitForSelector(options.readySelector, { timeout: 15000 });
  await page.waitForTimeout(options.waitMs ?? 1000);
  for (const selector of options.collapse || []) {
    await page.locator(selector).evaluateAll((nodes) => nodes.forEach((node) => {
      node.style.setProperty('display', 'none', 'important');
    }));
  }
  const maskLocators = (options.mask || []).map((selector) => page.locator(selector));
  if (options.screenshotSelector) {
    return page.locator(options.screenshotSelector).first().screenshot({ mask: maskLocators, maskColor: '#FF00FF' });
  }
  return page.screenshot({ fullPage: options.fullPage !== false, mask: maskLocators, maskColor: '#FF00FF' });
}

// Runs inside a blank browser page: pads both images to a common size, counts
// mismatching pixels, and returns a composite [proto | impl | diff] as a data URL.
async function diffAndCompose(page, protoPng, implPng, labels) {
  return page.evaluate(async ({ protoB64, implB64, labels }) => {
    const load = (b64) => new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = `data:image/png;base64,${b64}`;
    });
    const [proto, impl] = await Promise.all([load(protoB64), load(implB64)]);
    const w = Math.max(proto.width, impl.width);
    const h = Math.max(proto.height, impl.height);

    const draw = (img) => {
      const canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      ctx.fillStyle = '#f0f0f0';
      ctx.fillRect(0, 0, w, h);
      ctx.drawImage(img, 0, 0);
      return ctx;
    };
    const protoCtx = draw(proto);
    const implCtx = draw(impl);
    const protoData = protoCtx.getImageData(0, 0, w, h).data;
    const implData = implCtx.getImageData(0, 0, w, h).data;

    const diffCanvas = document.createElement('canvas');
    diffCanvas.width = w; diffCanvas.height = h;
    const diffCtx = diffCanvas.getContext('2d', { willReadFrequently: true });
    const diffImage = diffCtx.createImageData(w, h);
    const tolerance = 24;
    let mismatch = 0;
    const total = w * h;
    const bandHeight = Math.max(150, Math.ceil(h / 16));
    const bandCount = Math.ceil(h / bandHeight);
    const bandMismatch = new Array(bandCount).fill(0);
    for (let i = 0; i < total * 4; i += 4) {
      const delta = Math.max(
        Math.abs(protoData[i] - implData[i]),
        Math.abs(protoData[i + 1] - implData[i + 1]),
        Math.abs(protoData[i + 2] - implData[i + 2])
      );
      if (delta > tolerance) {
        mismatch += 1;
        bandMismatch[Math.floor(i / 4 / w / bandHeight)] += 1;
        diffImage.data[i] = 220; diffImage.data[i + 1] = 30; diffImage.data[i + 2] = 30; diffImage.data[i + 3] = 255;
      } else {
        const gray = 255 - Math.round((protoData[i] + protoData[i + 1] + protoData[i + 2]) / 3 / 8);
        diffImage.data[i] = gray; diffImage.data[i + 1] = gray; diffImage.data[i + 2] = gray; diffImage.data[i + 3] = 255;
      }
    }
    diffCtx.putImageData(diffImage, 0, 0);

    // Hotspots: the horizontal bands concentrating the mismatch, so the judge
    // (and the fixer) know WHERE to look without a human pointing at it.
    const bandArea = w * bandHeight;
    const hotspots = bandMismatch
      .map((count, index) => ({
        yStart: index * bandHeight,
        yEnd: Math.min(h, (index + 1) * bandHeight),
        pct: Number(((count / Math.min(bandArea, w * (h - index * bandHeight))) * 100).toFixed(1)),
      }))
      .filter((band) => band.pct > 3)
      .sort((a, b) => b.pct - a.pct)
      .slice(0, 5);
    diffCtx.fillStyle = '#ff9800';
    for (const band of hotspots) {
      diffCtx.fillRect(0, band.yStart, 8, band.yEnd - band.yStart);
    }

    const header = 36;
    const gap = 4;
    const composite = document.createElement('canvas');
    composite.width = w * 3 + gap * 2;
    composite.height = h + header;
    const ctx = composite.getContext('2d');
    ctx.fillStyle = '#1a1a2e';
    ctx.fillRect(0, 0, composite.width, composite.height);
    ctx.font = 'bold 18px sans-serif';
    ctx.fillStyle = '#ffffff';
    const titles = [labels.proto, labels.impl, `diff ${labels.pct}%`];
    for (let panel = 0; panel < 3; panel += 1) {
      ctx.fillText(titles[panel], panel * (w + gap) + 12, 24);
    }
    ctx.drawImage(protoCtx.canvas, 0, header);
    ctx.drawImage(implCtx.canvas, w + gap, header);
    ctx.drawImage(diffCanvas, (w + gap) * 2, header);
    return { dataUrl: composite.toDataURL('image/png'), mismatch, total, w, h, hotspots };
  }, {
    protoB64: protoPng.toString('base64'),
    implB64: implPng.toString('base64'),
    labels,
  });
}

export function statusFor(pct, thresholds) {
  if (pct <= (thresholds.warnPct ?? 5)) return 'close';
  if (pct <= (thresholds.failPct ?? 15)) return 'review';
  return 'divergent';
}

// Style probe: numeric comparison of computed styles + box metrics for one
// element on both sides. Use when a hotspot survives fix attempts: a cascade
// offset (everything shifted below some element) is usually ONE upstream
// property (font-size, line-height, width) - the probe exposes it as numbers.
const PROBE_PROPS = [
  'fontSize', 'lineHeight', 'fontFamily', 'fontWeight', 'letterSpacing',
  'color', 'backgroundColor', 'borderRadius', 'border',
  'marginTop', 'marginRight', 'marginBottom', 'marginLeft',
  'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
  'display', 'flexDirection', 'gap', 'whiteSpace',
];

async function probeElement(page, selector) {
  return page.evaluate(({ selector, props }) => {
    const el = document.querySelector(selector);
    if (!el) return { error: `no element matches: ${selector}` };
    const style = getComputedStyle(el);
    const rect = el.getBoundingClientRect();
    const out = {
      rect: { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.width), h: Math.round(rect.height) },
      text: (el.textContent || '').trim().slice(0, 80),
    };
    for (const prop of props) out[prop] = style[prop];
    return out;
  }, { selector, props: PROBE_PROPS });
}

async function runProbe(config, configDir, args) {
  const pair = (config.pairs || []).find((p) => p.id === args.probe);
  if (!pair) throw new Error(`Pair not found: ${args.probe}`);
  if (pair.baselineImage) throw new Error(`Probe is unavailable for image-baseline pair ${pair.id}; probe its source implementation pair instead.`);
  const protoSelector = args.selector;
  const implSelector = args['impl-selector'] || args.selector;
  if (!protoSelector) throw new Error('Missing --selector');
  const viewportName = args.viewport || config.viewports[0].name;
  const viewport = config.viewports.find((v) => v.name === viewportName);
  if (!viewport) throw new Error(`Viewport not found: ${viewportName}`);

  const sessions = { anonymous: null, ...(config.implementation?.sessions || {}) };
  if (config.implementation?.login && !sessions.default) sessions.default = config.implementation.login;
  const sessionName = pair.session || (sessions.default ? 'default' : 'anonymous');

  const { chromium } = loadPlaywright();
  const browser = await chromium.launch({ headless: true });
  try {
    const size = { width: viewport.width, height: viewport.height };
    const protoPage = await (await browser.newContext({ viewport: size, deviceScaleFactor: 1 })).newPage();
    const implPage = await (await browser.newContext({ viewport: size, deviceScaleFactor: 1, ignoreHTTPSErrors: true })).newPage();
    if (sessions[sessionName]) await login(implPage, sessions[sessionName]);

    const settle = async (page, url, steps, readySelector) => {
      await page.goto(resolveUrl(url, configDir), { waitUntil: 'load', timeout: 30000 });
      await runSteps(page, steps);
      if (readySelector) await page.waitForSelector(readySelector, { timeout: 15000 });
      await page.waitForTimeout(pair.waitMs ?? config.waitMs ?? 1000);
    };
    await settle(protoPage, pair.proto, pair.protoSteps, pair.protoReadySelector ?? config.protoReadySelector);
    await settle(implPage, pair.impl, pair.implSteps, pair.implReadySelector ?? config.implReadySelector);

    const proto = await probeElement(protoPage, protoSelector);
    const impl = await probeElement(implPage, implSelector);
    console.log(`probe ${pair.id} ${viewportName}`);
    console.log(`  proto ${protoSelector}: ${proto.error || `"${proto.text}"`}`);
    console.log(`  impl  ${implSelector}: ${impl.error || `"${impl.text}"`}`);
    if (proto.error || impl.error) process.exit(2);
    const keys = ['rect', ...PROBE_PROPS];
    console.log(`  ${'property'.padEnd(18)} ${'prototype'.padEnd(34)} ${'implementation'.padEnd(34)} same?`);
    for (const key of keys) {
      const a = key === 'rect' ? JSON.stringify(proto.rect) : String(proto[key]);
      const b = key === 'rect' ? JSON.stringify(impl.rect) : String(impl[key]);
      console.log(`  ${key.padEnd(18)} ${a.padEnd(34)} ${b.padEnd(34)} ${a === b ? 'ok' : '<< DIFF'}`);
    }
  } finally {
    await browser.close();
  }
}

async function main() {
  const args = parseArgs(process.argv);
  if (!args.config || args.help) {
    console.log('Usage: node parity_check.mjs --config parity.config.json [--pairs ID1,ID2] [--strict] [--report-name NAME]\n       node parity_check.mjs --config parity.config.json --probe PAIR_ID --selector ".el" [--impl-selector ".other"] [--viewport mobile]');
    process.exit(args.help ? 0 : 1);
  }
  const configPath = path.resolve(args.config);
  const configDir = path.dirname(configPath);
  const config = JSON.parse(await fs.readFile(configPath, 'utf8'));

  if (args.probe) {
    await runProbe(config, configDir, args);
    return;
  }

  const thresholds = config.threshold || {};
  const outDir = path.resolve(configDir, config.outDir || 'parity-evidence');
  await fs.mkdir(outDir, { recursive: true });

  let pairs = config.pairs || [];
  if (args.pairs) {
    const wanted = new Set(String(args.pairs).split(','));
    pairs = pairs.filter((p) => wanted.has(p.id));
    const missing = [...wanted].filter((id) => !pairs.some((p) => p.id === id));
    if (missing.length) throw new Error(`Pairs not in config: ${missing.join(', ')}`);
  }
  if (!pairs.length) throw new Error('No pairs to check.');

  const { chromium } = loadPlaywright();
  const browser = await chromium.launch({ headless: true });
  const results = [];
  try {
    const diffPage = await (await browser.newContext()).newPage();
    // Named implementation sessions: "sessions": { "admin": {login...}, "customer": {login...}, "anonymous": null }.
    // Legacy "implementation.login" becomes session "default". Pairs pick one via "session";
    // unset falls back to "default" when it exists, else anonymous.
    const sessions = { anonymous: null, ...(config.implementation?.sessions || {}) };
    if (config.implementation?.login && !sessions.default) sessions.default = config.implementation.login;
    for (const viewport of config.viewports) {
      const protoContext = await browser.newContext({
        viewport: { width: viewport.width, height: viewport.height }, deviceScaleFactor: 1,
      });
      const protoPage = await protoContext.newPage();
      const implContexts = new Map();
      const getImplPage = async (sessionName) => {
        if (implContexts.has(sessionName)) return implContexts.get(sessionName).page;
        if (!(sessionName in sessions)) {
          throw new Error(`Unknown session "${sessionName}" - declare it under implementation.sessions`);
        }
        const context = await browser.newContext({
          viewport: { width: viewport.width, height: viewport.height }, deviceScaleFactor: 1,
          ignoreHTTPSErrors: true,
        });
        const page = await context.newPage();
        if (sessions[sessionName]) await login(page, sessions[sessionName]);
        implContexts.set(sessionName, { context, page });
        return page;
      };

      for (const pair of pairs) {
        if (pair.viewports && !pair.viewports.includes(viewport.name)) continue;
        const id = `${pair.id}.${viewport.name}`;
        try {
          const implPage = await getImplPage(pair.session || (sessions.default ? 'default' : 'anonymous'));
          // baselineImage pairs compare the live implementation against a stored
          // PNG (e.g. the implementation captured at freeze time) instead of the
          // prototype - regression detection for impl-canonical screens.
          const protoPng = pair.baselineImage
            ? await fs.readFile(path.resolve(configDir, pair.baselineImage))
            : await capture(protoPage, resolveUrl(pair.proto, configDir), {
                readySelector: pair.protoReadySelector ?? config.protoReadySelector,
                waitMs: pair.waitMs ?? config.waitMs,
                fullPage: pair.fullPage ?? config.fullPage,
                mask: pair.mask?.proto || [],
                collapse: pair.mask?.collapse?.proto || [],
                steps: pair.protoSteps,
                screenshotSelector: pair.protoScreenshotSelector,
              });
          const implPng = await capture(implPage, resolveUrl(pair.impl, configDir), {
            readySelector: pair.implReadySelector ?? config.implReadySelector,
            waitMs: pair.waitMs ?? config.waitMs,
            fullPage: pair.fullPage ?? config.fullPage,
            mask: pair.mask?.impl || [],
            collapse: pair.mask?.collapse?.impl || [],
            steps: pair.implSteps,
            screenshotSelector: pair.implScreenshotSelector,
          });
          const provisional = await diffAndCompose(diffPage, protoPng, implPng, {
            proto: `prototype ${pair.id} ${viewport.name}`, impl: `implementation ${pair.id} ${viewport.name}`, pct: '?',
          });
          const pct = Number(((provisional.mismatch / provisional.total) * 100).toFixed(2));
          const final = await diffAndCompose(diffPage, protoPng, implPng, {
            proto: `prototype ${pair.id} ${viewport.name}`, impl: `implementation ${pair.id} ${viewport.name}`, pct,
          });
          const compositePath = path.join(outDir, `${id}.compare.png`);
          await fs.writeFile(compositePath, Buffer.from(final.dataUrl.split(',')[1], 'base64'));
          const status = statusFor(pct, thresholds);
          const hotspots = final.hotspots || [];
          results.push({ id: pair.id, viewport: viewport.name, mismatchPct: pct, status, hotspots, composite: path.relative(configDir, compositePath) });
          const hotspotNote = hotspots.length
            ? ` | hotspots: ${hotspots.map((band) => `y${band.yStart}-${band.yEnd} (${band.pct}%)`).join(', ')}`
            : '';
          console.log(`${id}: ${pct}% mismatch -> ${status}${hotspotNote}`);
        } catch (error) {
          results.push({ id: pair.id, viewport: viewport.name, status: 'error', error: String(error.message || error) });
          console.error(`${id}: ERROR ${error.message || error}`);
        }
      }
      await protoContext.close();
      for (const { context } of implContexts.values()) await context.close();
    }
  } finally {
    await browser.close();
  }

  const report = { generated: new Date().toISOString(), thresholds: { warnPct: thresholds.warnPct ?? 5, failPct: thresholds.failPct ?? 15 }, results };
  const reportSuffix = args['report-name'] ? `.${String(args['report-name']).replace(/[^a-zA-Z0-9_-]/g, '-')}` : '';
  const jsonReportPath = path.join(outDir, `parity-report${reportSuffix}.json`);
  const mdReportPath = path.join(outDir, `parity-report${reportSuffix}.md`);
  await fs.writeFile(jsonReportPath, JSON.stringify(report, null, 2), 'utf8');
  const md = [
    '# Parity Report', '', `Generated: ${report.generated}`, '',
    '| Pair | Viewport | Mismatch % | Signal | Hotspots (y ranges) | Composite |', '|---|---|---|---|---|---|',
    ...results.map((r) => {
      const hotspots = (r.hotspots || []).map((band) => `y${band.yStart}-${band.yEnd} (${band.pct}%)`).join(', ') || '-';
      return `| ${r.id} | ${r.viewport} | ${r.mismatchPct ?? '-'} | ${r.status} | ${hotspots} | ${r.composite ?? r.error} |`;
    }),
    '', 'Signals: close (<= warn) / review / divergent (> fail) / error.',
    'A signal is not a verdict: review each composite before concluding.', '',
  ].join('\n');
  await fs.writeFile(mdReportPath, md, 'utf8');
  console.log(`\nReport: ${mdReportPath}`);
  if (results.some((r) => r.status === 'error')) process.exit(2);
  if (args.strict && results.some((r) => Number(r.mismatchPct) > (thresholds.warnPct ?? 5))) process.exit(3);
}

if (isDirectExecution(process.argv[1])) {
  main().catch((error) => {
    console.error(error.message || error);
    process.exit(1);
  });
}
