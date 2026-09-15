import { setCurrentByVideoNo, updateProgress, findNext } from '../common/queue.js';
import { showUpNext, hideUpNext } from './upnext.js';

const VIDEO_WAIT_MS = 15000;
const SAVE_INTERVAL_SEC = 5;
const RESUME_MIN_SEC = 10;
// 종료 10초 전에 개입한다. 치지직 자체 자동재생보다 먼저 잡아야 우리 순서가 이긴다.
const NEXT_LEAD_SEC = 10;
const COUNTDOWN_SEC = 8;

// 플레이어는 늦게 마운트된다. 없으면 기다린다.
export function waitForVideo(timeoutMs = VIDEO_WAIT_MS) {
  const found = document.querySelector('video');
  if (found) return Promise.resolve(found);
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      mo.disconnect();
      resolve(null);
    }, timeoutMs);
    const mo = new MutationObserver(() => {
      const v = document.querySelector('video');
      if (!v) return;
      clearTimeout(timer);
      mo.disconnect();
      resolve(v);
    });
    mo.observe(document.documentElement, { childList: true, subtree: true });
  });
}

export function attachWatchPage({ videoNo, getQueue, commit, setStatus }) {
  let video = null;
  let lastSaved = 0;
  let disposed = false;
  const cleanups = [];

  // 하니스가 읽는 창구. DOM에 쓴다 — isolated world라 window는 보이지 않는다.
  const state = { videoNo, inQueue: false, hooked: false };
  function publishWatchState(patch = {}) {
    Object.assign(state, patch);
    document.documentElement.setAttribute('data-chzzk-addons-watch', JSON.stringify(state));
  }
  publishWatchState();

  function currentItem() {
    return getQueue().items.find((i) => i.videoNo === videoNo) ?? null;
  }

  async function flushProgress() {
    if (!video || disposed) return;
    // 넘어가는 중이면 절대 쓰지 않는다.
    // location.assign이 pagehide를 발생시키고 그 핸들러가 여기로 들어오는데,
    // 그때 치지직 플레이어는 이미 영상을 처음으로 되돌려놨다
    // (실측: currentTime 3578 → 1). 그 값을 쓰면 방금 완료로 찍은 항목이
    // 진행 13초, done false로 덮인다 (progress.md P3).
    if (advancing) return;
    const t = video.currentTime;
    await commit(updateProgress(getQueue(), videoNo, t, video.duration));
    lastSaved = t;
    publishWatchState({ progress: Math.floor(t) });
  }

  let upnext = null;
  // 종료 시점에 완료 판정의 분모로 쓴다. 그때 video.duration을 다시 읽으면
  // 플레이어가 소스를 갈아치운 뒤라 믿을 수 없다.
  let lastGoodDuration = 0;
  let cancelled = false; // 사용자가 이번 영상에서 취소했는가
  let advancing = false; // 이미 넘어가는 중인가 — 중복 이동을 막는다
  let endNoticed = false; // 마지막 항목 문구를 한 번만 띄우기 위한 것

  function goNext() {
    if (advancing || disposed) return;
    const next = findNext(getQueue());
    if (!next) {
      setStatus('재생목록을 끝까지 봤습니다. 순서를 바꾸거나 더 담아 보세요.', 'info');
      return;
    }
    advancing = true;
    publishWatchState({ advancingTo: next.videoNo });

    // 넘어가는 이유가 "이 영상이 끝났다"이므로 여기서 완료로 확정한다.
    // 이 순간의 currentTime을 다시 읽으면 안 된다. 종료 직후 치지직
    // 플레이어가 위치를 되돌리거나 스스로 다음 영상을 물려서 작은 값이
    // 읽히고, 그러면 95% 판정이 어긋나 완료로 찍히지 않는다 (progress.md P3).
    const d = lastGoodDuration;
    console.log(`[chzzk-add-ons] 다음 항목으로 넘어갑니다: ${videoNo} → ${next.videoNo}`);

    commit(updateProgress(getQueue(), videoNo, d, d))
      .finally(() => location.assign(`/video/${next.videoNo}`));
  }

  function maybeOfferNext() {
    if (!video || disposed || cancelled || advancing || upnext) return;
    const d = video.duration;
    if (!Number.isFinite(d) || d <= 0) return;
    lastGoodDuration = d;
    if (d - video.currentTime > NEXT_LEAD_SEC) return;

    const next = findNext(getQueue());
    if (!next) {
      if (!endNoticed) {
        endNoticed = true;
        setStatus('재생목록을 끝까지 봤습니다. 순서를 바꾸거나 더 담아 보세요.', 'info');
      }
      return;
    }
    publishWatchState({ upnext: next.videoNo });
    upnext = showUpNext({
      video,
      item: next,
      seconds: COUNTDOWN_SEC,
      onPlay: goNext,
      onCancel: () => {
        cancelled = true;
        upnext = null;
        publishWatchState({ upnext: null, cancelled: true });
      }
    });
  }

  function onTimeUpdate() {
    if (!video || disposed) return;
    // 넘어가기로 정한 뒤에는 진행을 더 쓰지 않는다.
    // 치지직 플레이어는 영상이 끝나면 처음으로 되돌려 다시 재생한다
    // (실측: currentTime 3578 → 1). 그 값을 저장하면 다 본 영상의
    // 진행이 1초로 덮여 이어보기가 망가진다 (progress.md P3).
    const frozen = advancing || !!upnext;
    if (!frozen && Math.abs(video.currentTime - lastSaved) >= SAVE_INTERVAL_SEC) {
      flushProgress();
    }
    maybeOfferNext();
  }

  function restorePosition() {
    const item = currentItem();
    if (!item || !video) return;
    const d = video.duration;
    if (!Number.isFinite(d) || d <= 0) return;
    // 끝에 거의 다 온 항목은 되돌리지 않는다. 되돌리면 종료 감지가 바로
    // 다시 걸려 같은 지점을 맴돈다.
    if (item.progress > RESUME_MIN_SEC && item.progress < d - RESUME_MIN_SEC) {
      video.currentTime = item.progress;
      lastSaved = item.progress;
    }
  }

  (async () => {
    // 큐에 없는 영상이면 아무것도 하지 않는다. 일반 시청을 방해하지 않는다.
    if (!currentItem()) {
      publishWatchState({ inQueue: false, hooked: false });
      return;
    }
    publishWatchState({ inQueue: true });
    await commit(setCurrentByVideoNo(getQueue(), videoNo));
    if (disposed) return;

    video = await waitForVideo();
    if (!video || disposed) {
      setStatus(
        '플레이어를 찾지 못해 자동 넘김을 쓸 수 없습니다. 재생목록은 그대로 쓸 수 있습니다.',
        'error'
      );
      return;
    }
    // duration은 여기서 아직 NaN일 수 있어 싣지 않는다. NaN은 JSON에서
    // null이 되어 디버깅할 때 오해를 부른다.
    publishWatchState({ hooked: true });

    // MSE 스트리밍이라 loadedmetadata 전에는 currentTime 쓰기가 무시된다.
    if (video.readyState >= 1) restorePosition();
    else video.addEventListener('loadedmetadata', restorePosition, { once: true });

    video.addEventListener('timeupdate', onTimeUpdate);
    cleanups.push(() => video.removeEventListener('timeupdate', onTimeUpdate));

    // ended는 광고나 중간 삽입에서 오지 않는 경우가 있어 보조로만 쓴다.
    // 정상 흐름에서는 timeupdate가 이미 10초 전에 카드를 띄웠다.
    const onEnded = () => {
      if (!cancelled && !advancing) goNext();
    };
    video.addEventListener('ended', onEnded);
    cleanups.push(() => video.removeEventListener('ended', onEnded));

    // 탭을 숨기거나 떠날 때 마지막 위치를 흘려 넣는다.
    // 새로고침 중 마지막 구간을 잃지 않기 위한 것이다.
    const onHide = () => {
      if (document.visibilityState === 'hidden') flushProgress();
    };
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('pagehide', flushProgress);
    cleanups.push(() => document.removeEventListener('visibilitychange', onHide));
    cleanups.push(() => window.removeEventListener('pagehide', flushProgress));
  })();

  return function detach() {
    disposed = true;
    upnext?.destroy();
    upnext = null;
    hideUpNext();
    for (const fn of cleanups) fn();
    cleanups.length = 0;
    document.documentElement.removeAttribute('data-chzzk-addons-watch');
  };
}
