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

// 치지직은 SPA다. 내부 이동에서는 content script가 재실행되지 않으므로
// URL 변화를 우리가 직접 알아내야 한다.
//
// pushState/replaceState를 감싸는 것만으로는 부족하다. 치지직 번들은 우리
// content script(document_idle)보다 먼저 로드되면서 history.pushState의
// 원본 참조를 붙잡아 두기 때문에, 우리가 나중에 프로퍼티를 덮어써도
// 그쪽 호출은 래퍼를 지나가지 않는다. 실측으로 SPA 이동 시 라우팅 감지가
// 되지 않는 것을 확인했다.
//
// 그래서 폴링을 대비책으로 둔다. 300ms에 pathname 하나를 비교하는 비용은
// 무시할 수 있고, 어떤 라우터를 쓰든 놓치지 않는다.
const ROUTE_POLL_MS = 300;

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
  setInterval(() => {
    if (location.pathname !== lastPath) route();
  }, ROUTE_POLL_MS);
}

export async function start() {
  const loaded = await store.loadQueue();
  queue = loaded.queue;

  panel = await mountPanel({ onIntent });
  const ui = await store.loadUi();
  panel.setOpen(ui.panelOpen);

  if (loaded.reset) {
    // 빈 큐를 실제로 되쓴다. 메모리만 비우면 깨진 값이 storage에 남아
    // 다음 로드에서도 같은 문구가 반복된다.
    await store.saveQueue(queue);
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
