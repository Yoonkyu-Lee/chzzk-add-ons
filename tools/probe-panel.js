// T7 확인용: 큐를 심고 패널이 그려지는지, 순서 변경이 저장되는지 본다.
// T11에서 하니스가 이 역할을 흡수한다.
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdirSync } from 'node:fs';
import puppeteer from 'puppeteer-core';
import { resolveChrome, extensionArgs } from './chrome-path.js';
import {
  readQueue, writeQueue, setPanelOpen, clearStorage, seedQueue,
  debugState, panelInfo, waitFor
} from './ext-bridge.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const PROFILE = resolve(HERE, '.profile');
const OUT = resolve(HERE, 'out');
const CHANNEL = '0f9a3b4fbb0e7137d1f0b4d70563031c';

const ITEMS = [
  { videoNo: 1, title: '어머 개피곤해 진짜', channelId: CHANNEL, channelName: '오킹TV', publishedAt: '2026-09-13 01:33:20', duration: 19563, thumb: '', progress: 3512, done: false, unavailable: false },
  { videoNo: 2, title: '등갈비', channelId: CHANNEL, channelName: '오킹TV', publishedAt: '2026-09-13 14:15:57', duration: 3443, thumb: '', progress: 0, done: false, unavailable: false },
  { videoNo: 3, title: '등갈비 <2부>', channelId: CHANNEL, channelName: '오킹TV', publishedAt: '2026-09-13 15:31:22', duration: 4507, thumb: '', progress: 4507, done: true, unavailable: false },
  { videoNo: 4, title: '오늘 잠을 히익', channelId: CHANNEL, channelName: '오킹TV', publishedAt: '2026-09-15 08:08:00', duration: 42675, thumb: '', progress: 0, done: false, unavailable: true }
];

mkdirSync(OUT, { recursive: true });
const chrome = resolveChrome();
console.log(`브라우저: ${chrome.kind}\n`);

const browser = await puppeteer.launch({
  executablePath: chrome.path,
  userDataDir: PROFILE,
  headless: false,
  args: extensionArgs(ROOT)
});

const out = {};
try {
  const page = await browser.newPage();
  page.on('console', (m) => {
    if (m.text().includes('chzzk-add-ons')) console.log('CONSOLE:', m.text());
  });
  page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));

  // 확장이 뜨도록 한 번 방문해 service worker를 깨운다.
  await page.goto(`https://chzzk.naver.com/${CHANNEL}/videos?videoType=REPLAY`, {
    waitUntil: 'networkidle2', timeout: 45000
  });
  await clearStorage(browser);
  await writeQueue(browser, seedQueue(ITEMS, 0));
  await setPanelOpen(browser, true);

  await page.reload({ waitUntil: 'networkidle2', timeout: 45000 });
  out.debug = await waitFor(async () => {
    const d = await debugState(page);
    return d && d.queueLength === 4 ? d : null;
  }, { label: '큐 4개 렌더' });

  out.panel = await waitFor(async () => {
    const p = await panelInfo(page);
    return p.rowCount === 4 ? p : null;
  }, { label: '패널 4행' });

  await page.screenshot({ path: resolve(OUT, 'panel-open.png') });

  // 2번 행의 위로 버튼을 눌러 순서 변경이 저장되는지 본다.
  const before = (await readQueue(browser)).items.map((i) => i.videoNo);
  await page.evaluate(() => {
    const root = document.getElementById('chzzk-addons-panel-host').shadowRoot;
    root.querySelectorAll('.row')[1].querySelector('button[data-act="up"]').click();
  });
  const afterQ = await waitFor(async () => {
    const q = await readQueue(browser);
    return q.items[0].videoNo !== before[0] ? q : null;
  }, { label: '순서 변경 저장' });
  out.reorder = {
    before,
    after: afterQ.items.map((i) => i.videoNo),
    currentIndex: afterQ.currentIndex,
    currentVideoNo: afterQ.items[afterQ.currentIndex]?.videoNo
  };

  // 새로고침 후 복원되는지 본다.
  await page.reload({ waitUntil: 'networkidle2', timeout: 45000 });
  out.afterReload = await waitFor(async () => {
    const p = await panelInfo(page);
    return p.rowCount === 4 ? p : null;
  }, { label: '새로고침 후 패널 복원' });

  // 제목에 <> 가 든 항목이 이스케이프되는지 확인한다.
  out.escapedTitle = await page.evaluate(() => {
    const root = document.getElementById('chzzk-addons-panel-host').shadowRoot;
    return [...root.querySelectorAll('.row .t')].map((e) => e.textContent);
  });

  await page.screenshot({ path: resolve(OUT, 'panel-after-reload.png') });
} catch (e) {
  out.error = e.message;
  console.error('PROBE FAILED:', e.message);
} finally {
  await browser.close().catch(() => {});
}

console.log(JSON.stringify(out, null, 2));
process.exit(out.error ? 1 : 0);
