// T0 전용 정찰 도구. 두 가지를 확인한다.
//   (1) puppeteer-core로 MV3 확장이 실제로 주입되는가
//   (2) 다시보기 목록·영상 페이지의 실제 DOM 구조
// 결과를 stdout과 tools/out/recon.json에 남긴다. 사람이 읽고 스펙에 옮긴다.
//
// --ext <path> 로 로드할 확장을 바꿀 수 있다. 기본은 스모크 껍데기.
// 실제 확장을 확인할 때는 --ext .. 를 쓴다.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';
import { resolveChrome, extensionArgs } from './chrome-path.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const PROFILE = resolve(HERE, '.profile');
const OUT = resolve(HERE, 'out');

const args = process.argv.slice(2);
const extArg = args.includes('--ext') ? args[args.indexOf('--ext') + 1] : 'fixtures/smoke-ext';
const EXT = resolve(HERE, extArg);

const CHANNEL = '0f9a3b4fbb0e7137d1f0b4d70563031c';
const VIDEO_NO = '14689850';

// 설치된 정식판은 커맨드라인 확장 로드를 차단한다 (스펙 4.4절).
// Chrome for Testing + headful 조합만 동작한다.
async function launch() {
  const chrome = resolveChrome();
  console.log(`브라우저: ${chrome.kind}`);
  return puppeteer.launch({
    executablePath: chrome.path,
    userDataDir: PROFILE,
    headless: false,
    args: extensionArgs(EXT)
  });
}

// 확장 상태는 DOM 속성으로 읽는다. isolated world라 window는 보이지 않는다.
async function readAddonsState(page, attr) {
  return page
    .evaluate((a) => {
      const raw = document.documentElement.getAttribute(a);
      return raw ? JSON.parse(raw) : null;
    }, attr)
    .catch(() => null);
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  console.log('확장 경로:', EXT);
  const browser = await launch();
  const result = { extPath: EXT };
  try {
    const page = await browser.newPage();
    const logs = [];
    page.on('console', (m) => {
      const t = m.text();
      logs.push(`[${m.type()}] ${t}`);
      if (t.includes('[smoke]') || t.includes('chzzk-add-ons')) console.log('CONSOLE:', t);
    });
    page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));

    // (1) 확장 주입 확인
    await page.goto(`https://chzzk.naver.com/${CHANNEL}/videos?videoType=REPLAY`, {
      waitUntil: 'networkidle2',
      timeout: 45000
    });
    await new Promise((r) => setTimeout(r, 2500));
    result.smokeInjected = await page
      .evaluate(() => document.documentElement.getAttribute('data-chzzk-smoke') === 'ok')
      .catch(() => false);
    result.addonsState = await readAddonsState(page, 'data-chzzk-addons');
    result.panelHostPresent = await page
      .evaluate(() => !!document.getElementById('chzzk-addons-panel-host'))
      .catch(() => false);
    result.toolbarPresent = await page
      .evaluate(() => !!document.getElementById('chzzk-addons-toolbar'))
      .catch(() => false);
    result.addButtonCount = await page
      .evaluate(() => document.querySelectorAll('.chzzk-addons-add').length)
      .catch(() => 0);

    // (2) 목록 페이지 구조 — videoNo를 담은 링크를 역추적해 카드 경계를 찾는다
    result.videosPage = await page.evaluate(() => {
      const links = [...document.querySelectorAll('a[href*="/video/"]')];
      const first = links[0];
      const chain = [];
      let el = first;
      for (let i = 0; el && i < 8; i++) {
        chain.push({
          tag: el.tagName.toLowerCase(),
          cls: el.className ? String(el.className).slice(0, 140) : '',
          childCount: el.children.length,
          hasImg: !!el.querySelector('img'),
          textHead: (el.textContent || '').trim().slice(0, 40)
        });
        el = el.parentElement;
      }
      return {
        linkCount: links.length,
        firstHref: first ? first.getAttribute('href') : null,
        ancestorChain: chain,
        liCount: document.querySelectorAll('li').length,
        closestLi: first ? !!first.closest('li') : false,
        closestArticle: first ? !!first.closest('article') : false
      };
    });

    await page.screenshot({ path: resolve(OUT, 'recon-videos.png') });

    // (3) 영상 페이지 구조 + seek 실동작 (스펙 4.3-1)
    await page.goto(`https://chzzk.naver.com/video/${VIDEO_NO}`, {
      waitUntil: 'networkidle2',
      timeout: 45000
    });
    await page.waitForSelector('video', { timeout: 30000 }).catch(() => null);
    result.watchPage = await page.evaluate(async () => {
      const v = document.querySelector('video');
      if (!v) return { videoFound: false };
      const chain = [];
      let el = v.parentElement;
      for (let i = 0; el && i < 6; i++) {
        chain.push({
          tag: el.tagName.toLowerCase(),
          cls: String(el.className).slice(0, 140),
          position: getComputedStyle(el).position
        });
        el = el.parentElement;
      }
      if (v.readyState < 1) {
        await new Promise((r) => {
          const t = setTimeout(r, 8000);
          v.addEventListener('loadedmetadata', () => { clearTimeout(t); r(); }, { once: true });
        });
      }
      const before = v.currentTime;
      v.currentTime = before + 60;
      await new Promise((r) => setTimeout(r, 2000));
      return {
        videoFound: true,
        iframeCount: document.querySelectorAll('iframe').length,
        duration: v.duration,
        readyState: v.readyState,
        paused: v.paused,
        seekBefore: before,
        seekAfter: v.currentTime,
        seekWorked: Math.abs(v.currentTime - (before + 60)) < 10,
        ancestorChain: chain
      };
    });
    result.watchPageType = await readAddonsState(page, 'data-chzzk-addons');
    result.addonsWatchState = await readAddonsState(page, 'data-chzzk-addons-watch');

    await page.screenshot({ path: resolve(OUT, 'recon-watch.png') });
    writeFileSync(resolve(OUT, 'recon.log'), logs.join('\n'), 'utf8');
  } finally {
    await browser.close();
  }
  writeFileSync(resolve(OUT, 'recon.json'), JSON.stringify(result, null, 2), 'utf8');
  console.log(JSON.stringify(result, null, 2));
}

main().catch((e) => {
  console.error('RECON FAILED:', e.message);
  process.exit(1);
});
