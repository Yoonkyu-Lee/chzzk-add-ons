// 창을 띄우지 않고도 확장이 로드되는지 확인한다.
// 사람이 쓰는 PC에서 headful 창이 계속 뜨면 방해가 되므로,
// headless로 돌 수 있으면 그것이 기본이어야 한다.
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { rmSync } from 'node:fs';
import puppeteer from 'puppeteer-core';
import { resolveChrome, extensionArgs } from './chrome-path.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const EXT = resolve(HERE, 'fixtures/smoke-ext');
const PROFILE = resolve(HERE, '.probe-profile');
const chrome = resolveChrome();

const modes = [
  { name: 'headless: true (새 headless)', headless: true },
  { name: "headless: 'shell' (구 headless)", headless: 'shell' },
  { name: 'headless: false (참조용)', headless: false }
];

for (const m of modes) {
  try { rmSync(PROFILE, { recursive: true, force: true }); } catch { /* 잠금 무시 */ }
  let browser = null;
  let r = { injected: false, sw: false };
  try {
    browser = await puppeteer.launch({
      executablePath: chrome.path,
      userDataDir: PROFILE,
      headless: m.headless,
      args: extensionArgs(EXT)
    });
    const page = (await browser.pages())[0] ?? await browser.newPage();
    await page.goto('https://example.com/', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await new Promise((res) => setTimeout(res, 2000));
    r.injected = await page
      .evaluate(() => document.documentElement.getAttribute('data-chzzk-smoke') === 'ok')
      .catch(() => false);
    const t = (await browser.targets()).find(
      (x) => x.type() === 'service_worker' && x.url().startsWith('chrome-extension://'));
    r.sw = !!t;
    if (t) {
      const w = await t.worker();
      await w.evaluate(async () => chrome.storage.local.set({ hl: 1 }));
      r.storage = await w.evaluate(async () => (await chrome.storage.local.get('hl')).hl === 1);
    }
    r.pages = (await browser.pages()).length;
  } catch (e) {
    r.error = e.message.slice(0, 120);
  } finally {
    await browser?.close().catch(() => {});
  }
  console.log(`${r.injected ? 'OK  ' : 'FAIL'} ${m.name} — ${JSON.stringify(r)}`);
}

try { rmSync(PROFILE, { recursive: true, force: true }); } catch { /* 잠금 무시 */ }
