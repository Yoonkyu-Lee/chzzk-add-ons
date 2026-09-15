import { detectPageType } from './route.js';

const VERSION = '0.1.0';

// 하니스가 주입 성공과 현재 페이지 타입을 읽는 창구다.
// window가 아니라 DOM에 쓴다 — content script는 isolated world에서 돌아서
// window에 심은 값이 page.evaluate(main world)에 보이지 않는다 (스펙 4.4절).
function publishDebugState(pageType) {
  document.documentElement.setAttribute(
    'data-chzzk-addons',
    JSON.stringify({ pageType, version: VERSION })
  );
}

let detachCurrent = null;
let lastPath = null;

async function attachFor(pageType) {
  if (detachCurrent) {
    detachCurrent();
    detachCurrent = null;
  }
  // 페이지별 모듈은 T8·T9에서 붙인다. 지금은 골격만 세운다.
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
  installRouteHooks();
  await route();
}
