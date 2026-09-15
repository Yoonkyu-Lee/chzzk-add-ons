import { detectPageType, parseChannelId, parseVideoNo } from './route.js';
import { attachVideosPage } from './videos-page.js';
import { attachWatchPage } from './watch-page.js';
import { createStore } from '../common/store.js';
import { mountPanel } from '../panel/panel.js';
import {
  createEmptyQueue, moveItem, removeItem, reverseOrder, clearQueue
} from '../common/queue.js';

const VERSION = '0.1.0';

const store = createStore(chrome.storage.local);

let panel = null;
let queue = createEmptyQueue();
let status = { message: null, tone: 'info' };
let detachCurrent = null;
let lastPath = null;

// 하니스가 주입 성공과 현재 상태를 읽는 창구다.
// window가 아니라 DOM에 쓴다 — content script는 isolated world에서 돌아서
// window에 심은 값이 page.evaluate(main world)에 보이지 않는다 (스펙 4.4절).
function publishDebugState(pageType) {
  document.documentElement.setAttribute('data-chzzk-addons', JSON.stringify({
    pageType,
    version: VERSION,
    queueLength: queue.items.length,
    currentIndex: queue.currentIndex,
    panelOpen: panel ? panel.isOpen() : false
  }));
}

function repaint() {
  panel?.render(queue, status);
  publishDebugState(detectPageType(location.pathname));
}

function setStatus(message, tone = 'info') {
  status = { message, tone };
  repaint();
}

async function commit(next) {
  queue = next;
  const ok = await store.saveQueue(queue);
  if (!ok) {
    status = { message: '저장하지 못했습니다. 잠시 후 다시 시도해 주세요.', tone: 'error' };
  }
  repaint();
}

async function setPanelOpen(open) {
  panel.setOpen(open);
  await store.saveUi({ panelOpen: open });
  publishDebugState(detectPageType(location.pathname));
}

async function onIntent(intent) {
  switch (intent.type) {
    case 'close':
      await setPanelOpen(false);
      break;
    case 'move':
      await commit(moveItem(queue, intent.from, intent.to));
      break;
    case 'remove':
      await commit(removeItem(queue, intent.videoNo));
      break;
    case 'reverse':
      await commit(reverseOrder(queue));
      break;
    case 'clear':
      await commit(clearQueue(queue));
      break;
    case 'play':
      location.assign(`/video/${intent.videoNo}`);
      break;
    case 'resume': {
      // currentIndex가 -1이면(처음 열었을 때) 첫 항목부터 시작한다.
      const cur = queue.items[queue.currentIndex] ?? queue.items[0];
      if (cur) location.assign(`/video/${cur.videoNo}`);
      break;
    }
    default:
      break;
  }
}

async function attachFor(pageType) {
  if (detachCurrent) {
    detachCurrent();
    detachCurrent = null;
  }

  if (pageType === 'videos') {
    const channelId = parseChannelId(location.pathname);
    if (channelId) {
      detachCurrent = attachVideosPage({
        channelId,
        getQueue: () => queue,
        commit,
        setStatus,
        openPanel: () => setPanelOpen(true)
      });
    }
  }
  if (pageType === 'watch') {
    const videoNo = parseVideoNo(location.pathname);
    if (videoNo !== null) {
      detachCurrent = attachWatchPage({
        videoNo,
        getQueue: () => queue,
        commit,
        setStatus
      });
    }
  }

  publishDebugState(pageType);
}

async function route() {
  const path = location.pathname;
  if (path === lastPath) return;
  lastPath = path;
  await attachFor(detectPageType(path));
}

// 치지직은 SPA다. pushState/replaceState를 감싸야 내부 이동을 감지할 수 있다.
// 원래 함수를 보존해 호출하고 우리 훅은 그 뒤에 얹는다.
function installRouteHooks() {
  for (const name of ['pushState', 'replaceState']) {
    const original = history[name];
    history[name] = function (...args) {
      const r = original.apply(this, args);
      route();
      return r;
    };
  }
  window.addEventListener('popstate', route);
}

export async function start() {
  const loaded = await store.loadQueue();
  queue = loaded.queue;

  panel = await mountPanel({ onIntent });
  const ui = await store.loadUi();
  panel.setOpen(ui.panelOpen);

  if (loaded.reset) {
    setStatus('저장된 재생목록을 읽을 수 없어 비웠습니다. 다시 담아 주세요.', 'error');
  } else {
    repaint();
  }

  // 다른 탭에서 큐가 바뀌어도 따라온다.
  store.subscribe((next) => {
    queue = next;
    repaint();
  });

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg?.type !== 'chzzk-addons/toggle-panel') return;
    setPanelOpen(!panel.isOpen());
  });

  installRouteHooks();
  await route();
}
