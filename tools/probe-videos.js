// T8 확인용: 툴바 주입, 카드 버튼, 전체 담기 → 오래된 순 65개.
// T11에서 하니스가 이 역할을 흡수한다.
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdirSync } from 'node:fs';
import { launchHarness, gotoAndWaitCards } from './chrome-path.js';
import { readQueue, clearStorage, debugState, panelInfo, waitFor } from './ext-bridge.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const PROFILE = resolve(HERE, '.profile');
const OUT = resolve(HERE, 'out');
const CHANNEL = '0f9a3b4fbb0e7137d1f0b4d70563031c';
const VIDEOS_URL = `https://chzzk.naver.com/${CHANNEL}/videos?videoType=REPLAY`;

mkdirSync(OUT, { recursive: true });
const { browser, page } = await launchHarness();

const out = {};
try {
  page.on('console', (m) => {
    if (m.text().includes('chzzk-add-ons')) console.log('CONSOLE:', m.text());
  });

  await gotoAndWaitCards(page, VIDEOS_URL);
  await clearStorage(browser);
  await gotoAndWaitCards(page, VIDEOS_URL);

  await page.waitForSelector('#chzzk-addons-toolbar', { timeout: 20000 });
  out.toolbar = await page.evaluate(() => {
    const tb = document.getElementById('chzzk-addons-toolbar');
    return {
      present: !!tb,
      parentTag: tb?.parentElement?.tagName.toLowerCase(),
      nextTag: tb?.nextElementSibling?.tagName.toLowerCase(),
      count: tb?.querySelector('.count')?.textContent
    };
  });

  out.cards = await page.evaluate(() => {
    const btns = [...document.querySelectorAll('.chzzk-addons-add')];
    const links = document.querySelectorAll('a[href*="/video/"]').length;
    const nos = btns.map((b) => b.dataset.no);
    return {
      buttonCount: btns.length,
      linkCount: links,
      uniqueNos: new Set(nos).size,
      sampleLabel: btns[0]?.textContent
    };
  });

  // 담기 버튼 하나를 눌러 영상으로 이동하지 않는지 본다.
  const urlBefore = page.url();
  await page.click('.chzzk-addons-add');
  const afterOne = await waitFor(async () => {
    const q = await readQueue(browser);
    return q && q.items.length === 1 ? q : null;
  }, { label: '개별 담기' });
  out.singleAdd = {
    navigated: page.url() !== urlBefore,
    item: { videoNo: afterOne.items[0].videoNo, title: afterOne.items[0].title },
    buttonLabel: await page.evaluate(() => document.querySelector('.chzzk-addons-add').textContent)
  };

  // 같은 버튼을 다시 눌러 빠지는지 본다.
  await page.click('.chzzk-addons-add');
  out.toggleOff = await waitFor(async () => {
    const q = await readQueue(browser);
    return q && q.items.length === 0 ? { length: 0 } : null;
  }, { label: '개별 빼기' });

  // 전체 담기.
  await page.click('#chzzk-addons-toolbar [data-act="add-all"]');
  const full = await waitFor(async () => {
    const q = await readQueue(browser);
    return q && q.items.length > 50 ? q : null;
  }, { label: '전체 담기', timeout: 60000 });

  const dates = full.items.map((i) => i.publishedAt);
  const sorted = [...dates].sort();
  out.addAll = {
    count: full.items.length,
    ascending: JSON.stringify(dates) === JSON.stringify(sorted),
    first: { no: full.items[0].videoNo, at: dates[0], title: full.items[0].title },
    last: { no: full.items.at(-1).videoNo, at: dates.at(-1), title: full.items.at(-1).title },
    currentIndex: full.currentIndex
  };
  // 같은 날 조각의 시각 순서를 직접 본다.
  out.sameDayPairs = dates
    .map((d, i) => ({ d, t: full.items[i].title }))
    .filter((x) => x.d.startsWith('2026-09-13') || x.d.startsWith('2026-09-12'));

  out.panelAfterAddAll = await waitFor(async () => {
    const p = await panelInfo(page);
    return p.open ? p : null;
  }, { label: '전체 담기 후 패널 자동 열림' });

  out.debug = await debugState(page);
  await page.screenshot({ path: resolve(OUT, 'videos-page.png'), fullPage: false });
} catch (e) {
  out.error = e.message;
  console.error('PROBE FAILED:', e.message);
} finally {
  await browser.close().catch(() => {});
}

console.log(JSON.stringify(out, null, 2));
process.exit(out.error ? 1 : 0);
