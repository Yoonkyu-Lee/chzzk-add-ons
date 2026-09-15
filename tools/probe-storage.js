// P1 후속: 하니스가 chrome.storage.local을 읽고 쓸 경로를 찾는다.
//
// main world의 page.evaluate에는 chrome.storage가 없다. content script는
// isolated world에서 돌고 puppeteer는 그 world에 들어갈 수 없다.
// 남은 후보는 확장의 service worker 타깃이다. 그것이 실제로 붙고
// evaluate까지 되는지 여기서 판정한다.
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { rmSync } from 'node:fs';
import puppeteer from 'puppeteer-core';
import { resolveChrome, extensionArgs } from './chrome-path.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const EXT = resolve(HERE, 'fixtures/smoke-ext');
const PROFILE = resolve(HERE, '.probe-profile');

try {
  rmSync(PROFILE, { recursive: true, force: true });
} catch {
  // 잠금이 걸려 있어도 진행한다.
}

const chrome = resolveChrome();
console.log(`브라우저: ${chrome.kind}\n`);

const browser = await puppeteer.launch({
  executablePath: chrome.path,
  userDataDir: PROFILE,
  headless: false,
  args: extensionArgs(EXT)
});

const out = {};
try {
  const page = await browser.newPage();
  await page.goto('https://example.com/', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await new Promise((r) => setTimeout(r, 1500));

  out.contentScriptRan = await page
    .evaluate(() => document.documentElement.getAttribute('data-chzzk-smoke') === 'ok');

  // 모든 타깃을 찍어 무엇이 있는지 본다.
  out.allTargets = (await browser.targets()).map((t) => ({ type: t.type(), url: t.url().slice(0, 80) }));

  // service worker 타깃을 찾는다. SW는 유휴 시 죽으므로 없으면 잠시 기다린다.
  let swTarget = (await browser.targets()).find(
    (t) => t.type() === 'service_worker' && t.url().startsWith('chrome-extension://')
  );
  if (!swTarget) {
    swTarget = await browser
      .waitForTarget(
        (t) => t.type() === 'service_worker' && t.url().startsWith('chrome-extension://'),
        { timeout: 10000 }
      )
      .catch(() => null);
  }
  out.swTargetFound = !!swTarget;
  out.swUrl = swTarget?.url() ?? null;

  if (swTarget) {
    const worker = await swTarget.worker();
    out.workerHandleOk = !!worker;
    if (worker) {
      // 읽기·쓰기 왕복을 실제로 해 본다.
      out.hasStorageApi = await worker.evaluate(() => typeof chrome?.storage?.local?.set === 'function');
      await worker.evaluate(async () => {
        await chrome.storage.local.set({ probe: { hello: 'world', n: 42 } });
      });
      out.readBack = await worker.evaluate(async () => (await chrome.storage.local.get('probe')).probe);
    }
  }

  // 확장 페이지를 열어 거기서 evaluate하는 대안도 확인한다.
  // SW가 불안정할 때의 예비 경로다.
  const extId = out.swUrl ? new URL(out.swUrl).host : null;
  if (extId) {
    const extPage = await browser.newPage();
    try {
      await extPage.goto(`chrome-extension://${extId}/manifest.json`, { timeout: 15000 });
      out.extPageStorageOk = await extPage
        .evaluate(() => typeof chrome?.storage?.local?.get === 'function')
        .catch(() => false);
    } catch (e) {
      out.extPageError = e.message;
    }
    await extPage.close().catch(() => {});
  }
} finally {
  await browser.close().catch(() => {});
  try {
    rmSync(PROFILE, { recursive: true, force: true });
  } catch {
    // 정리 실패는 치명적이지 않다.
  }
}

console.log(JSON.stringify(out, null, 2));
