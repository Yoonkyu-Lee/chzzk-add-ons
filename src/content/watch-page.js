import { setCurrentByVideoNo, updateProgress } from '../common/queue.js';

const VIDEO_WAIT_MS = 15000;
const SAVE_INTERVAL_SEC = 5;
const RESUME_MIN_SEC = 10;

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
    const t = video.currentTime;
    await commit(updateProgress(getQueue(), videoNo, t, video.duration));
    lastSaved = t;
    publishWatchState({ progress: Math.floor(t) });
  }

  function onTimeUpdate() {
    if (!video || disposed) return;
    // timeupdate는 초당 4회쯤 온다. 매번 저장하면 storage 쓰기가 폭주한다.
    if (Math.abs(video.currentTime - lastSaved) < SAVE_INTERVAL_SEC) return;
    flushProgress();
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
    for (const fn of cleanups) fn();
    cleanups.length = 0;
    document.documentElement.removeAttribute('data-chzzk-addons-watch');
  };
}
