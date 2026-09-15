// headless에서 치지직 VOD가 재생되는지 확인한다.
// 재생이 안 되면 영상 관련 시나리오만 headful로 돌려야 한다.
import { launchHarness } from './chrome-path.js';
import { clearStorage, writeQueue, seedQueue } from './ext-bridge.js';

const VIDEO_NO = 14689850;

const { browser, page } = await launchHarness();
try {
  // --seed 를 주면 이 영상을 큐에 심어 확장이 훅을 걸게 한다.
  // 확장의 개입이 DRM 로딩을 막는지 가리기 위한 것이다.
  if (process.argv.includes('--seed')) {
    await clearStorage(browser);
    await writeQueue(browser, seedQueue([{
      videoNo: VIDEO_NO, title: '테스트', channelId: '', channelName: '',
      publishedAt: '2026-08-20 05:37:12', duration: 3582, thumb: '',
      progress: 0, done: false, unavailable: false
    }], 0));
    console.log('큐에 심었습니다 (확장이 훅을 걸 것)');
  }
  page.on('console', (m) => {
    const t = m.text();
    if (t.includes('PlayReady') || t.includes('Widevine') || t.includes('EME')) {
      console.log(`  [drm] ${t.slice(0, 160)}`);
    }
  });
  await page.goto(`https://chzzk.naver.com/video/${VIDEO_NO}`, {
    waitUntil: 'domcontentloaded', timeout: 60000
  });
  let hasVideo = await page.waitForSelector('video', { timeout: 30000 })
    .then(() => true).catch(() => false);
  console.log('video 엘리먼트:', hasVideo);

  // --reload 를 주면 새로고침 후의 상태를 본다.
  // probe-next는 큐를 심고 reload한 뒤에 실패하므로 이 차이를 가린다.
  if (process.argv.includes('--reload')) {
    await new Promise((r) => setTimeout(r, 3000));
    console.log('--- reload ---');
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 });
    hasVideo = await page.waitForSelector('video', { timeout: 30000 })
      .then(() => true).catch(() => false);
    console.log('reload 후 video 엘리먼트:', hasVideo);
  }

  for (let i = 1; i <= 8; i++) {
    await new Promise((r) => setTimeout(r, 2500));
    // evaluate 안에서 이벤트를 무한정 기다리지 않는다. 그러면 CDP 호출이 멈춘다.
    const s = await page.evaluate(() => {
      const v = document.querySelector('video');
      if (!v) return { noVideo: true };
      return {
        readyState: v.readyState,
        duration: Number.isFinite(v.duration) ? Math.round(v.duration) : String(v.duration),
        currentTime: Math.round(v.currentTime * 10) / 10,
        paused: v.paused,
        networkState: v.networkState,
        errorCode: v.error?.code ?? null,
        src: (v.currentSrc || '').slice(0, 30)
      };
    });
    console.log(`t+${i * 2.5}s`, JSON.stringify(s));
    if (s.readyState >= 1) break;
  }
} finally {
  await browser.close().catch(() => {});
}
