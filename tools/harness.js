// 스펙 9.2절 시나리오 8개를 실행한다.
//
// CLI: node tools/harness.js [--scenario N] [--headless]
//
// 설계 근거 (전부 실측)
//  - 1~5번은 목록 페이지만 쓰므로 한 브라우저 세션에서 함께 돈다.
//  - 6~8번은 영상 재생이 필요하다. 치지직 VOD는 DRM이라 메타데이터 로딩이
//    비결정적이므로 withReadyWatchPage가 세션을 갈아 끼우며 재시도한다.
//  - 시나리오마다 하드 타임아웃을 둔다. 멈춘 채로 세션을 태우는 것이
//    최악의 실패 방식이다.
//  - 실제 목록 API를 때리는 것은 2번 하나뿐이다. 나머지는 storage에 큐를
//    직접 심어 시작한다.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchHarness, gotoAndWaitCards } from './chrome-path.js';
import {
  readQueue, writeQueue, clearStorage, seedQueue, setPanelOpen,
  debugState, watchState, panelInfo, waitFor
} from './ext-bridge.js';
import { withReadyWatchPage } from './watch-session.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(HERE, 'out');
const CHANNEL = '0f9a3b4fbb0e7137d1f0b4d70563031c';
const VIDEOS_URL = `https://chzzk.naver.com/${CHANNEL}/videos?videoType=REPLAY`;

const SCENARIO_TIMEOUT_MS = 180000;
const TOTAL_TIMEOUT_MS = 20 * 60 * 1000;

const argv = process.argv.slice(2);
const only = argv.includes('--scenario') ? Number(argv[argv.indexOf('--scenario') + 1]) : null;

const mkItem = (videoNo, title, publishedAt, duration, extra = {}) => ({
  videoNo, title, channelId: CHANNEL, channelName: '오킹TV',
  publishedAt, duration, thumb: '', progress: 0, done: false, unavailable: false, ...extra
});

// 실측 영상. A는 1시간짜리라 seek 검증에 여유가 있다.
const A = mkItem(14689850, '첫 항목', '2026-08-20 05:37:12', 3582);
const B = mkItem(15204257, '다음 항목', '2026-09-15 08:08:00', 42675);

const seeder = (items, idx) => async (browser) => {
  await clearStorage(browser);
  await writeQueue(browser, seedQueue(items, idx));
};

function assert(cond, message) {
  if (!cond) throw new Error(message);
}

// ── 목록 페이지 시나리오 (1~5). 한 세션에서 순서대로 돈다.
const listScenarios = [
  {
    n: 1,
    name: '목록 페이지에 툴바·카드 버튼 주입',
    async run({ page }) {
      await gotoAndWaitCards(page, VIDEOS_URL);
      await page.waitForSelector('#chzzk-addons-toolbar', { timeout: 30000 });
      const info = await page.evaluate(() => ({
        toolbar: !!document.getElementById('chzzk-addons-toolbar'),
        nextTag: document.getElementById('chzzk-addons-toolbar')?.nextElementSibling?.tagName,
        buttons: document.querySelectorAll('.chzzk-addons-add').length,
        links: document.querySelectorAll('a[href*="/video/"]').length,
        uniqueNos: new Set([...document.querySelectorAll('.chzzk-addons-add')]
          .map((b) => b.dataset.no)).size
      }));
      assert(info.toolbar, '툴바가 없다');
      assert(info.buttons > 0, '담기 버튼이 하나도 없다');
      // 카드당 링크가 2개이므로 버튼 수는 고유 videoNo 수와 같아야 한다.
      assert(info.buttons === info.uniqueNos, `버튼 중복: ${info.buttons} vs ${info.uniqueNos}`);
      return info;
    }
  },
  {
    n: 2,
    name: '전체 담기 → 큐가 오래된 순으로 채워짐',
    async run({ browser, page }) {
      await clearStorage(browser);
      await gotoAndWaitCards(page, VIDEOS_URL);
      await page.waitForSelector('#chzzk-addons-toolbar [data-act="add-all"]', { timeout: 30000 });
      await page.click('#chzzk-addons-toolbar [data-act="add-all"]');
      const q = await waitFor(async () => {
        const cur = await readQueue(browser);
        return cur?.items?.length > 50 ? cur : null;
      }, { label: '전체 담기', timeout: 90000 });

      const dates = q.items.map((i) => i.publishedAt);
      assert(JSON.stringify(dates) === JSON.stringify([...dates].sort()), '오래된 순이 아니다');
      assert(q.items.length >= 60, `담긴 수가 적다: ${q.items.length}`);
      const sameDay = dates.filter((d) => d.startsWith('2026-09-13'));
      return {
        count: q.items.length,
        ascending: true,
        first: dates[0],
        last: dates.at(-1),
        sameDay0913: sameDay
      };
    }
  },
  {
    n: 3,
    name: '패널 열림 + 순서 변경 저장',
    async run({ browser, page }) {
      await seeder([A, B], 0)(browser);
      await setPanelOpen(browser, true);
      await gotoAndWaitCards(page, VIDEOS_URL);
      await waitFor(async () => {
        const p = await panelInfo(page);
        return p.rowCount === 2 ? p : null;
      }, { label: '패널 2행 렌더' });

      const before = (await readQueue(browser)).items.map((i) => i.videoNo);
      await page.evaluate(() => {
        const root = document.getElementById('chzzk-addons-panel-host').shadowRoot;
        root.querySelectorAll('.row')[1].querySelector('button[data-act="up"]').click();
      });
      const after = await waitFor(async () => {
        const q = await readQueue(browser);
        return q.items[0].videoNo !== before[0] ? q : null;
      }, { label: '순서 변경 저장' });

      assert(after.items[0].videoNo === before[1], '순서가 바뀌지 않았다');
      // 앵커 보정: 현재 항목이 계속 같은 영상을 가리켜야 한다.
      assert(after.items[after.currentIndex].videoNo === before[0],
        `currentIndex가 항목을 놓쳤다: ${after.items[after.currentIndex]?.videoNo}`);
      return { before, after: after.items.map((i) => i.videoNo), currentIndex: after.currentIndex };
    }
  },
  {
    n: 4,
    name: '새로고침 후 큐·패널 상태 복원',
    async run({ browser, page }) {
      await seeder([A, B], 0)(browser);
      await setPanelOpen(browser, true);
      await gotoAndWaitCards(page, VIDEOS_URL);
      await waitFor(async () => (await panelInfo(page)).rowCount === 2 ? true : null,
        { label: '초기 렌더' });

      await page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 });
      await page.waitForSelector('a[href*="/video/"]', { timeout: 60000 });
      const p = await waitFor(async () => {
        const cur = await panelInfo(page);
        return cur.open && cur.rowCount === 2 ? cur : null;
      }, { label: '새로고침 후 패널 복원' });

      const q = await readQueue(browser);
      assert(q.items.length === 2, `큐 길이가 달라졌다: ${q.items.length}`);
      return { open: p.open, rowCount: p.rowCount, stat: p.stat, queueLength: q.items.length };
    }
  },
  {
    n: 5,
    name: 'SPA 내부 이동 후 패널 생존 (D1 핵심 가정)',
    async run({ browser, page }) {
      await seeder([A, B], 0)(browser);
      await setPanelOpen(browser, true);
      await gotoAndWaitCards(page, VIDEOS_URL);
      await waitFor(async () => (await panelInfo(page)).rowCount === 2 ? true : null,
        { label: '초기 렌더' });

      // 목록의 첫 영상 링크를 눌러 SPA 이동을 유발한다.
      await page.evaluate(() => {
        document.querySelector('a[href*="/video/"]').click();
      });
      await page.waitForFunction(() => location.pathname.startsWith('/video/'), { timeout: 30000 });

      const p = await panelInfo(page);
      assert(p.hostPresent && p.shadowPresent, 'SPA 이동 후 패널이 사라졌다');
      const d = await waitFor(async () => {
        const s = await debugState(page);
        return s?.pageType === 'watch' ? s : null;
      }, { label: '라우팅 감지' });
      return { panel: { host: p.hostPresent, rows: p.rowCount }, debug: d };
    }
  }
];

// ── 영상 재생이 필요한 시나리오 (6~8). 각자 세션을 관리한다.
const watchScenarios = [
  {
    n: 6,
    name: 'currentTime 쓰기로 seek 동작',
    async run() {
      const r = await withReadyWatchPage(
        { videoNo: A.videoNo, seed: seeder([A], 0) },
        // 순서가 중요하다. currentTime을 먼저 쓰고 그 다음에 play를 부른다.
        // play를 먼저 부르고 나서 밀면 seek이 무시되고 재생만 이어진다 (실측 0 → 3).
        //
        // 그리고 고정 대기로는 부족하다. DRM 세그먼트를 받아오느라 seek이
        // 늦게 반영되어 3초 대기로는 실패했다 (0 → 1). 폴링으로 기다린다.
        async ({ page }) => {
          const before = await page.evaluate(async () => {
            const v = document.querySelector('video');
            const t = v.currentTime;
            v.muted = true;
            v.currentTime = 240;
            try { await v.play(); } catch { /* 자동재생 정책 무시 */ }
            return Math.round(t);
          });
          const after = await waitFor(async () => {
            const t = await page.evaluate(() => document.querySelector('video')?.currentTime ?? 0);
            return t > 200 ? Math.round(t) : null;
          }, { label: 'seek 반영 (>200초)', timeout: 45000 });
          return { before, target: 240, after };
        }
      );
      assert(r.ok, `재생 준비 실패: ${JSON.stringify(r.tries)}`);
      const { before, target, after } = r.result;
      assert(after > target - 10, `seek 실패: ${before} → ${after} (목표 ${target})`);
      return { ...r.result, tries: r.tries.length };
    }
  },
  {
    n: 7,
    name: '종료 10초 전 다음 항목 카드 + 전환',
    async run() {
      const r = await withReadyWatchPage(
        { videoNo: A.videoNo, seed: seeder([A, B], 0) },
        async ({ browser, page }) => {
          // 끝으로 seek하면 플레이어가 곧 처음으로 되돌린다. 카드가 뜰 때까지 민다.
          for (let i = 0; i < 8; i++) {
            await page.evaluate(async () => {
              const v = document.querySelector('video');
              v.muted = true;
              try { await v.play(); } catch { /* 자동재생 정책 무시 */ }
              v.currentTime = Math.max(0, v.duration - 5);
            });
            const shown = await page.waitForSelector('#chzzk-addons-upnext', { timeout: 4000 })
              .then(() => true).catch(() => false);
            if (shown) break;
          }
          await page.waitForSelector('#chzzk-addons-upnext', { timeout: 15000 });
          const card = await page.evaluate(() => {
            const b = document.getElementById('chzzk-addons-upnext');
            return { title: b?.querySelector('[data-title]')?.textContent, present: !!b };
          });
          await page.screenshot({ path: resolve(OUT, 'scenario7-upnext.png') });

          await waitFor(async () => new URL(page.url()).pathname === `/video/${B.videoNo}`,
            { label: '다음 항목으로 전환', timeout: 40000 });

          const q = await waitFor(async () => {
            const cur = await readQueue(browser);
            const a = cur?.items.find((i) => i.videoNo === A.videoNo);
            const pointsToB = cur?.items[cur.currentIndex]?.videoNo === B.videoNo;
            return a?.done && pointsToB ? cur : null;
          }, { label: 'A done + currentIndex 이동', timeout: 45000 });

          const a = q.items.find((i) => i.videoNo === A.videoNo);
          return {
            card,
            path: new URL(page.url()).pathname,
            aDone: a.done,
            aProgress: a.progress,
            currentVideoNo: q.items[q.currentIndex].videoNo
          };
        }
      );
      assert(r.ok, `재생 준비 실패: ${JSON.stringify(r.tries)}`);
      return { ...r.result, tries: r.tries.length };
    }
  },
  {
    n: 8,
    name: '이어보기: seek → 재로드 → 위치 복원',
    async run() {
      // 1단계: 300초로 밀고 진행이 저장되는 것을 확인한다.
      const step1 = await withReadyWatchPage(
        { videoNo: A.videoNo, seed: seeder([A], 0) },
        async ({ browser, page }) => {
          await page.evaluate(async () => {
            const v = document.querySelector('video');
            v.muted = true;
            v.currentTime = 300;
            try { await v.play(); } catch { /* 자동재생 정책 무시 */ }
          });
          const saved = await waitFor(async () => {
            const q = await readQueue(browser);
            const p = q?.items?.[0]?.progress ?? 0;
            return p > 250 ? p : null;
          }, { label: '진행 저장 (>250초)', timeout: 45000 });
          return { saved };
        }
      );
      assert(step1.ok, `1단계 재생 준비 실패: ${JSON.stringify(step1.tries)}`);

      // 2단계: 새 세션으로 같은 영상을 다시 열어 복원되는지 본다.
      // storage는 프로필에 남으므로 큐를 다시 심지 않는다.
      const step2 = await withReadyWatchPage(
        { videoNo: A.videoNo },
        async ({ page }) => {
          await waitFor(async () => (await watchState(page))?.hooked ? true : null,
            { label: '훅 부착', timeout: 45000 });
          const pos = await waitFor(async () => {
            const t = await page.evaluate(() => document.querySelector('video')?.currentTime ?? 0);
            return t > 250 ? Math.round(t) : null;
          }, { label: '이어보기 복원 (>250초)', timeout: 45000 });
          await page.screenshot({ path: resolve(OUT, 'scenario8-resumed.png') });
          return { restored: pos };
        }
      );
      assert(step2.ok, `2단계 재생 준비 실패: ${JSON.stringify(step2.tries)}`);
      return { savedProgress: step1.result.saved, restoredAt: step2.result.restored };
    }
  }
];

function withTimeout(promise, ms, label) {
  let timer;
  const guard = new Promise((_, rej) => {
    timer = setTimeout(() => rej(new Error(`하드 타임아웃 ${ms}ms: ${label}`)), ms);
  });
  return Promise.race([promise, guard]).finally(() => clearTimeout(timer));
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const wanted = (s) => only === null || s.n === only;
  const results = [];
  const deadline = Date.now() + TOTAL_TIMEOUT_MS;

  const listWanted = listScenarios.filter(wanted);
  if (listWanted.length > 0) {
    const { browser, page } = await launchHarness();
    page.on('console', (m) => {
      if (m.text().includes('chzzk-add-ons')) console.log(`    ${m.text().slice(0, 180)}`);
    });
    try {
      for (const s of listWanted) {
        if (Date.now() > deadline) {
          results.push({ scenario: s.n, name: s.name, passed: false, ms: 0, error: '전체 타임아웃' });
          continue;
        }
        const t0 = Date.now();
        try {
          const detail = await withTimeout(s.run({ browser, page }), SCENARIO_TIMEOUT_MS, `${s.n}`);
          results.push({ scenario: s.n, name: s.name, passed: true, ms: Date.now() - t0, detail });
          console.log(`PASS ${s.n} ${s.name}`);
        } catch (e) {
          const shot = resolve(OUT, `fail-${s.n}.png`);
          await page.screenshot({ path: shot }).catch(() => {});
          results.push({
            scenario: s.n, name: s.name, passed: false,
            ms: Date.now() - t0, error: e.message, screenshot: shot
          });
          console.log(`FAIL ${s.n} ${s.name} — ${e.message}`);
        }
      }
    } finally {
      await browser.close().catch(() => {});
    }
  }

  for (const s of watchScenarios.filter(wanted)) {
    if (Date.now() > deadline) {
      results.push({ scenario: s.n, name: s.name, passed: false, ms: 0, error: '전체 타임아웃' });
      continue;
    }
    const t0 = Date.now();
    try {
      const detail = await withTimeout(s.run(), SCENARIO_TIMEOUT_MS, `${s.n}`);
      results.push({ scenario: s.n, name: s.name, passed: true, ms: Date.now() - t0, detail });
      console.log(`PASS ${s.n} ${s.name}`);
    } catch (e) {
      results.push({
        scenario: s.n, name: s.name, passed: false, ms: Date.now() - t0, error: e.message
      });
      console.log(`FAIL ${s.n} ${s.name} — ${e.message}`);
    }
  }

  results.sort((a, b) => a.scenario - b.scenario);
  writeFileSync(resolve(OUT, 'result.json'), JSON.stringify(results, null, 2), 'utf8');
  const failed = results.filter((r) => !r.passed);
  console.log(`\n${results.length - failed.length}/${results.length} 통과`);
  console.log(`결과: ${resolve(OUT, 'result.json')}`);
  process.exit(failed.length > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error('HARNESS FAILED:', e);
  process.exit(1);
});
