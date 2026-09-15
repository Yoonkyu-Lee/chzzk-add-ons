// 영상 페이지를 "재생 가능한 상태로" 확보한다.
//
// 치지직 VOD는 DRM이라 자동화 환경에서 메타데이터 로딩이 비결정적이다.
// 같은 명령을 연달아 돌려도 readyState가 4까지 가기도 하고 0에 머물기도 한다
// (tools/probe-drm.js로 양쪽 모두 관측). 확장의 개입이나 네비게이션 방식
// 때문이 아니다 — 큐가 비었을 때도 실패했고 훅이 걸렸을 때도 성공했다.
//
// 그래서 브라우저 세션을 새로 띄워 가며 재시도한다. 이것이 유일하게
// 안정적인 방법이다. 실패를 조용히 통과시키지 않고 시도 기록을 남긴다.
import { launchHarness } from './chrome-path.js';

const READY_TIMEOUT_MS = 30000;

// evaluate 안에서 이벤트를 무한정 기다리면 CDP 호출이 protocolTimeout까지
// 멈춘다. 항상 타임아웃과 경쟁시킨다.
async function videoReady(page, timeoutMs) {
  return page.evaluate(async (limit) => {
    const v = document.querySelector('video');
    if (!v) return { ok: false, reason: 'video 없음' };
    if (v.readyState < 1) {
      await new Promise((r) => {
        const t = setTimeout(r, limit);
        v.addEventListener('loadedmetadata', () => { clearTimeout(t); r(); }, { once: true });
      });
    }
    const ok = Number.isFinite(v.duration) && v.duration > 0;
    return {
      ok,
      reason: ok ? null : 'metadata 미도달',
      readyState: v.readyState,
      duration: Number.isFinite(v.duration) ? Math.round(v.duration) : String(v.duration)
    };
  }, timeoutMs);
}

/**
 * 영상 페이지가 재생 가능한 상태가 될 때까지 세션을 갈아 끼우며 시도한다.
 * body(ctx)는 {browser, page, ready} 를 받는다. 성공한 시도에서만 실행된다.
 *
 * seed(browser)가 주어지면 네비게이션 전에 호출한다 (큐 심기 등).
 */
export async function withReadyWatchPage({ videoNo, seed, attempts = 3 }, body) {
  const tries = [];
  for (let i = 1; i <= attempts; i++) {
    const { browser, page } = await launchHarness();
    try {
      if (seed) await seed(browser);
      await page.goto(`https://chzzk.naver.com/video/${videoNo}`, {
        waitUntil: 'domcontentloaded', timeout: 60000
      });
      await page.waitForSelector('video', { timeout: 45000 });
      const ready = await videoReady(page, READY_TIMEOUT_MS);
      tries.push({ attempt: i, ...ready });
      if (!ready.ok) {
        console.log(`  시도 ${i}: DRM 메타데이터 미도달 (${JSON.stringify(ready)}) — 세션 재시작`);
        await browser.close().catch(() => {});
        continue;
      }
      console.log(`  시도 ${i}: 재생 준비 완료 (duration ${ready.duration})`);
      const result = await body({ browser, page, ready });
      return { ok: true, tries, result };
    } catch (e) {
      tries.push({ attempt: i, ok: false, reason: e.message.slice(0, 160) });
      console.log(`  시도 ${i}: 실패 — ${e.message.slice(0, 160)}`);
    } finally {
      await browser.close().catch(() => {});
    }
  }
  return { ok: false, tries, result: null };
}
