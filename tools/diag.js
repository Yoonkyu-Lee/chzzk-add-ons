// 목록 페이지에서 무엇이 붙고 무엇이 안 붙는지 시간 순으로 찍는다.
// 추측으로 고치지 않기 위한 진단 도구.
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';
import { resolveChrome, extensionArgs } from './chrome-path.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const PROFILE = resolve(HERE, '.profile');
const CHANNEL = '0f9a3b4fbb0e7137d1f0b4d70563031c';

const chrome = resolveChrome();
const browser = await puppeteer.launch({
  executablePath: chrome.path,
  userDataDir: PROFILE,
  headless: false,
  args: extensionArgs(ROOT)
});

try {
  const page = await browser.newPage();
  // 확장 관련만 걸러내지 않고 전부 찍는다. 놓치는 게 없어야 한다.
  page.on('console', (m) => console.log(`  [console.${m.type()}] ${m.text().slice(0, 300)}`));
  page.on('pageerror', (e) => console.log(`  [pageerror] ${e.message.slice(0, 300)}`));
  page.on('requestfailed', (r) => {
    if (r.url().includes('chrome-extension')) {
      console.log(`  [reqfail] ${r.url().slice(0, 140)} ${r.failure()?.errorText}`);
    }
  });

  console.log('--- goto ---');
  await page.goto(`https://chzzk.naver.com/${CHANNEL}/videos?videoType=REPLAY`, {
    waitUntil: 'domcontentloaded', timeout: 45000
  });

  for (let i = 1; i <= 10; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    const s = await page.evaluate(() => ({
      attr: document.documentElement.getAttribute('data-chzzk-addons'),
      panelHost: !!document.getElementById('chzzk-addons-panel-host'),
      toolbar: !!document.getElementById('chzzk-addons-toolbar'),
      styleTag: !!document.getElementById('chzzk-addons-inline-style'),
      addBtns: document.querySelectorAll('.chzzk-addons-add').length,
      videoLinks: document.querySelectorAll('a[href*="/video/"]').length,
      firstLinkLiParentTag: (() => {
        const a = document.querySelector('a[href*="/video/"]');
        const li = a?.closest('li');
        return li?.parentElement?.tagName.toLowerCase() ?? null;
      })(),
      liGrandParentTag: (() => {
        const a = document.querySelector('a[href*="/video/"]');
        const li = a?.closest('li');
        return li?.parentElement?.parentElement?.tagName.toLowerCase() ?? null;
      })()
    }));
    console.log(`t+${i * 2}s`, JSON.stringify(s));
    if (s.toolbar) break;
  }
} finally {
  await browser.close().catch(() => {});
}
