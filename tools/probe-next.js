// T10 확인용: 종료 10초 전 다음 항목 카드, 자동 전환, 마지막 항목 처리.
//
// 환경 제약 두 가지를 안고 설계했다. 둘 다 실측으로 확인했다.
//
// 1) 치지직 VOD의 DRM 메타데이터 로딩이 비결정적이다. 같은 조건에서
//    성공하기도 실패하기도 한다. → withReadyWatchPage로 세션을 갈아 끼우며
//    재시도한다.
// 2) 끝으로 seek하면 플레이어가 곧 처음으로 되돌린다 (3578 → 1).
//    감지 창이 1초도 안 될 수 있으므로 카드가 뜰 때까지 반복해서 민다.
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdirSync } from 'node:fs';
import {
  readQueue, writeQueue, clearStorage, seedQueue, panelInfo, waitFor
} from './ext-bridge.js';
import { withReadyWatchPage } from './watch-session.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(HERE, 'out');
const CHANNEL = '0f9a3b4fbb0e7137d1f0b4d70563031c';

const mkItem = (videoNo, title, publishedAt, duration, extra = {}) => ({
  videoNo, title, channelId: CHANNEL, channelName: '오킹TV',
  publishedAt, duration, thumb: '', progress: 0, done: false, unavailable: false, ...extra
});

// 실측 영상 둘. A가 먼저(오래됨), B가 다음.
const A = mkItem(14689850, '첫 항목', '2026-08-20 05:37:12', 3582);
const B = mkItem(15204257, '다음 항목', '2026-09-15 08:08:00', 42675);

const seeder = (items, idx) => async (browser) => {
  await clearStorage(browser);
  await writeQueue(browser, seedQueue(items, idx));
};

// 끝 lead초 전으로 민다. 이미 메타데이터가 확보된 상태에서만 호출된다.
async function pushToEnd(page, lead = 5) {
  return page.evaluate(async (l) => {
    const v = document.querySelector('video');
    if (!v || !Number.isFinite(v.duration)) return { unusable: true };
    v.muted = true;
    try { await v.play(); } catch { /* 자동재생 정책 무시 */ }
    v.currentTime = Math.max(0, v.duration - l);
    return { duration: Math.round(v.duration), currentTime: Math.round(v.currentTime) };
  }, lead);
}

function tapConsole(page, label) {
  page.on('console', (m) => {
    const t = m.text();
    if (t.includes('chzzk-add-ons')) console.log(`  [${label}] ${t.slice(0, 220)}`);
  });
}

mkdirSync(OUT, { recursive: true });
const out = {};

// ── 1부: A 종료 → 카드 등장 → B로 전환
console.log('1부: 종료 감지와 다음 항목 전환');
const part1 = await withReadyWatchPage(
  { videoNo: A.videoNo, seed: seeder([A, B], 0) },
  async ({ browser, page }) => {
    tapConsole(page, '1부');
    const r = {};
    r.pushes = [];
    for (let i = 0; i < 8; i++) {
      r.pushes.push(await pushToEnd(page, 5));
      const shown = await page.waitForSelector('#chzzk-addons-upnext', { timeout: 4000 })
        .then(() => true).catch(() => false);
      if (shown) break;
    }
    await page.waitForSelector('#chzzk-addons-upnext', { timeout: 15000 });
    r.card = await page.evaluate(() => {
      const b = document.getElementById('chzzk-addons-upnext');
      return {
        present: !!b,
        hostClass: b?.parentElement?.className?.slice(0, 26),
        title: b?.querySelector('[data-title]')?.textContent,
        text: b?.textContent.replace(/\s+/g, ' ').trim().slice(0, 80)
      };
    });
    await page.screenshot({ path: resolve(OUT, 'upnext-card.png') });

    r.advanced = await waitFor(async () => {
      const p = new URL(page.url()).pathname;
      return p === `/video/${B.videoNo}` ? { path: p } : null;
    }, { label: '다음 항목으로 전환', timeout: 40000 });

    // A가 완료로 찍히고, 새 페이지의 훅이 currentIndex를 B로 옮겼는지 함께 본다.
    // A의 done만 보면 B의 페이지가 자리를 옮기기 전에 통과해 버린다.
    r.afterAdvance = await waitFor(async () => {
      const q = await readQueue(browser);
      const a = q?.items.find((i) => i.videoNo === A.videoNo);
      const pointsToB = q?.items[q.currentIndex]?.videoNo === B.videoNo;
      return a?.done && pointsToB ? {
        aDone: a.done,
        aProgress: a.progress,
        currentIndex: q.currentIndex,
        currentVideoNo: q.items[q.currentIndex]?.videoNo
      } : null;
    }, { label: 'A done + currentIndex가 B로 이동', timeout: 45000 });
    return r;
  }
);
out.part1 = part1;

// ── 2부: 마지막 항목에서는 전환하지 않고 문구만 띄운다
console.log('2부: 마지막 항목 처리');
const part2 = await withReadyWatchPage(
  { videoNo: B.videoNo, seed: seeder([{ ...A, done: true }, B], 1) },
  async ({ page }) => {
    tapConsole(page, '2부');
    const r = { pushes: [] };
    for (let i = 0; i < 8; i++) {
      r.pushes.push(await pushToEnd(page, 5));
      const p = await panelInfo(page).catch(() => ({}));
      if (p.status && p.status.includes('끝까지')) break;
      await new Promise((res) => setTimeout(res, 2500));
    }
    r.notice = await waitFor(async () => {
      const p = await panelInfo(page);
      return p.status && p.status.includes('끝까지') ? p.status : null;
    }, { label: '마지막 항목 문구', timeout: 30000 });
    r.stillOnLast = new URL(page.url()).pathname === `/video/${B.videoNo}`;
    r.noCard = await page.evaluate(() => !document.getElementById('chzzk-addons-upnext'));
    return r;
  }
);
out.part2 = part2;

console.log(JSON.stringify(out, null, 2));
process.exit(part1.ok && part2.ok ? 0 : 1);
