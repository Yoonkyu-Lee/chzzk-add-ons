// T9 확인용: 진행 저장, 이어보기 복원, 큐에 없는 영상 무간섭.
// T11에서 하니스가 이 역할을 흡수한다.
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdirSync } from 'node:fs';
import puppeteer from 'puppeteer-core';
import { resolveChrome, extensionArgs, PROTOCOL_TIMEOUT } from './chrome-path.js';
import {
  readQueue, writeQueue, clearStorage, seedQueue, watchState, waitFor
} from './ext-bridge.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const PROFILE = resolve(HERE, '.profile');
const OUT = resolve(HERE, 'out');
const CHANNEL = '0f9a3b4fbb0e7137d1f0b4d70563031c';

// 오킹TV 실측. 1시간짜리라 seek 검증에 여유가 있다.
const IN_QUEUE = {
  videoNo: 14689850, title: '큐에 있는 영상', channelId: CHANNEL, channelName: '오킹TV',
  publishedAt: '2026-08-20 05:37:12', duration: 3582, thumb: '',
  progress: 0, done: false, unavailable: false
};
const NOT_IN_QUEUE = 15204257;

const watchUrl = (no) => `https://chzzk.naver.com/video/${no}`;

async function gotoWatch(page, no) {
  await page.goto(watchUrl(no), { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForSelector('video', { timeout: 45000 });
}

async function videoInfo(page) {
  return page.evaluate(() => {
    const v = document.querySelector('video');
    return v ? { currentTime: v.currentTime, duration: v.duration, readyState: v.readyState } : null;
  });
}

mkdirSync(OUT, { recursive: true });
const chrome = resolveChrome();
console.log(`브라우저: ${chrome.kind}\n`);

const browser = await puppeteer.launch({
  executablePath: chrome.path,
  userDataDir: PROFILE,
  headless: false,
  protocolTimeout: PROTOCOL_TIMEOUT,
  args: extensionArgs(ROOT)
});

const out = {};
try {
  const page = await browser.newPage();
  page.on('console', (m) => {
    if (m.text().includes('chzzk-add-ons')) console.log('CONSOLE:', m.text());
  });

  await gotoWatch(page, IN_QUEUE.videoNo);
  await clearStorage(browser);

  // (A) 큐에 없는 영상에서는 아무것도 하지 않는다.
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForSelector('video', { timeout: 45000 });
  await new Promise((r) => setTimeout(r, 3000));
  out.notInQueue = {
    watch: await watchState(page),
    queueAfter: await readQueue(browser)
  };

  // (B) 큐에 심고 진행 저장을 확인한다.
  await writeQueue(browser, seedQueue([IN_QUEUE], 0));
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForSelector('video', { timeout: 45000 });

  out.hooked = await waitFor(async () => {
    const w = await watchState(page);
    return w?.hooked ? w : null;
  }, { label: 'video 훅 부착', timeout: 45000 });

  // 재생 위치를 300초로 밀고 재생시켜 timeupdate가 돌게 한다.
  await page.evaluate(async () => {
    const v = document.querySelector('video');
    if (v.readyState < 1) {
      await new Promise((r) => v.addEventListener('loadedmetadata', r, { once: true }));
    }
    v.muted = true;
    v.currentTime = 300;
    try { await v.play(); } catch { /* 자동재생 정책은 무시한다 */ }
  });
  out.afterSeek = await videoInfo(page);

  out.progressSaved = await waitFor(async () => {
    const q = await readQueue(browser);
    const p = q?.items?.[0]?.progress ?? 0;
    return p > 250 ? { progress: p } : null;
  }, { label: '진행 저장 (>250초)', timeout: 45000 });

  // (C) 새로고침 후 그 위치에서 이어지는지 본다.
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForSelector('video', { timeout: 45000 });
  await waitFor(async () => {
    const w = await watchState(page);
    return w?.hooked ? w : null;
  }, { label: '새로고침 후 훅 부착', timeout: 45000 });

  out.resumed = await waitFor(async () => {
    const v = await videoInfo(page);
    return v && v.currentTime > 250 ? v : null;
  }, { label: '이어보기 복원 (>250초)', timeout: 45000 });

  await page.screenshot({ path: resolve(OUT, 'watch-resumed.png') });

  // (D) 큐에 없는 다른 영상으로 가면 다시 무간섭인지 본다.
  await gotoWatch(page, NOT_IN_QUEUE);
  await new Promise((r) => setTimeout(r, 3000));
  out.otherVideo = {
    watch: await watchState(page),
    queueLength: (await readQueue(browser))?.items?.length
  };
} catch (e) {
  out.error = e.message;
  console.error('PROBE FAILED:', e.message);
} finally {
  await browser.close().catch(() => {});
}

console.log(JSON.stringify(out, null, 2));
process.exit(out.error ? 1 : 0);
