// chrome.storage를 아는 유일한 파일이다.
// 저장 영역을 주입받는 이유는 테스트 때문이다 — chrome 전역 없이 Node에서 검증된다.
import { createEmptyQueue, QUEUE_VERSION } from './queue.js';

export const KEY_QUEUE = 'queue';
export const KEY_UI = 'ui';

export function defaultUi() {
  return { panelOpen: false };
}

function isValidQueue(v) {
  return !!v
    && typeof v === 'object'
    && !Array.isArray(v)
    && Array.isArray(v.items)
    && v.version === QUEUE_VERSION
    && Number.isInteger(v.currentIndex);
}

export function createStore(storageArea) {
  const subscribers = new Set();
  let bridge = null;

  // storage.onChanged는 다른 탭의 변경도 전달한다.
  // 덕분에 목록 탭과 시청 탭이 같은 큐를 보게 된다.
  // 리스너는 하나만 붙인다 — 구독자마다 붙이면 해지 관리가 꼬인다.
  function ensureBridge() {
    if (bridge) return;
    bridge = (changes) => {
      if (!changes || !(KEY_QUEUE in changes)) return;
      const next = changes[KEY_QUEUE].newValue;
      const queue = isValidQueue(next) ? next : createEmptyQueue();
      for (const cb of [...subscribers]) cb(queue);
    };
    storageArea.onChanged.addListener(bridge);
  }

  return {
    async loadQueue() {
      try {
        const got = await storageArea.get(KEY_QUEUE);
        const raw = got?.[KEY_QUEUE];
        if (raw === undefined) return { queue: createEmptyQueue(), reset: false };
        // 버전이 다르거나 형태가 깨졌으면 빈 큐로 간다.
        // reset을 올려 패널이 사용자에게 알릴 수 있게 한다 — 조용히 비우지 않는다.
        if (!isValidQueue(raw)) return { queue: createEmptyQueue(), reset: true };
        return { queue: raw, reset: false };
      } catch (e) {
        console.warn('[chzzk-add-ons] 큐를 읽지 못했습니다', e);
        return { queue: createEmptyQueue(), reset: true };
      }
    },

    async saveQueue(queue) {
      try {
        await storageArea.set({ [KEY_QUEUE]: queue });
        return true;
      } catch (e) {
        // 저장 실패로 패널 조작이 멈추는 것보다 실패를 표시하고 계속 도는 편이 낫다.
        console.warn('[chzzk-add-ons] 큐를 저장하지 못했습니다', e);
        return false;
      }
    },

    async loadUi() {
      try {
        const got = await storageArea.get(KEY_UI);
        const raw = got?.[KEY_UI];
        return { ...defaultUi(), ...(raw && typeof raw === 'object' ? raw : {}) };
      } catch {
        return defaultUi();
      }
    },

    async saveUi(ui) {
      try {
        await storageArea.set({ [KEY_UI]: ui });
        return true;
      } catch (e) {
        console.warn('[chzzk-add-ons] 화면 상태를 저장하지 못했습니다', e);
        return false;
      }
    },

    subscribe(cb) {
      ensureBridge();
      subscribers.add(cb);
      return () => subscribers.delete(cb);
    }
  };
}
