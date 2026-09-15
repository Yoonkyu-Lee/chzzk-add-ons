// 확장의 storage를 읽고 쓰는 창구.
//
// main world의 page.evaluate에는 chrome.storage가 없고, content script의
// isolated world에는 puppeteer가 들어갈 수 없다. 그래서 확장의
// service worker 타깃에 붙어 evaluate한다 (스펙 4.4절).
// service worker는 유휴 시 죽으므로 매번 다시 확보한다.

const isExtSw = (t) => t.type() === 'service_worker' && t.url().startsWith('chrome-extension://');

export async function extWorker(browser, timeout = 15000) {
  const found = (await browser.targets()).find(isExtSw)
    ?? await browser.waitForTarget(isExtSw, { timeout });
  const worker = await found.worker();
  if (!worker) throw new Error('service worker 핸들을 얻지 못했다');
  return worker;
}

export async function readQueue(browser) {
  const w = await extWorker(browser);
  return w.evaluate(async () => (await chrome.storage.local.get('queue')).queue ?? null);
}

export async function writeQueue(browser, queue) {
  const w = await extWorker(browser);
  await w.evaluate(async (q) => chrome.storage.local.set({ queue: q }), queue);
}

export async function setPanelOpen(browser, open) {
  const w = await extWorker(browser);
  await w.evaluate(async (o) => chrome.storage.local.set({ ui: { panelOpen: o } }), open);
}

export async function clearStorage(browser) {
  const w = await extWorker(browser);
  await w.evaluate(async () => chrome.storage.local.clear());
}

export function seedQueue(items, currentIndex = 0) {
  return { version: 1, items, currentIndex };
}

// 확장이 DOM에 남긴 상태를 읽는다. DOM은 world를 넘나든다.
export async function debugState(page) {
  return page.evaluate(() => {
    const raw = document.documentElement.getAttribute('data-chzzk-addons');
    return raw ? JSON.parse(raw) : null;
  });
}

export async function watchState(page) {
  return page.evaluate(() => {
    const raw = document.documentElement.getAttribute('data-chzzk-addons-watch');
    return raw ? JSON.parse(raw) : null;
  });
}

// 패널은 shadow root 안에 있다. mode: 'open'이므로 main world에서 뚫린다.
export async function panelInfo(page) {
  return page.evaluate(() => {
    const host = document.getElementById('chzzk-addons-panel-host');
    const root = host?.shadowRoot;
    if (!root) return { hostPresent: !!host, shadowPresent: false };
    const panel = root.querySelector('.panel');
    return {
      hostPresent: true,
      shadowPresent: true,
      open: panel ? !panel.hidden : false,
      rowCount: root.querySelectorAll('.row').length,
      stat: root.getElementById('ca-stat')?.textContent ?? '',
      status: root.getElementById('ca-status')?.hidden === false
        ? root.getElementById('ca-status').textContent
        : null,
      firstTitle: root.querySelector('.row .t')?.textContent ?? null,
      emptyShown: !!root.querySelector('.empty')
    };
  });
}

// storage 변경이 비동기이므로 조건이 참이 될 때까지 폴링한다.
// page.waitForFunction은 chrome.storage에 닿지 못해 쓸 수 없다.
export async function waitFor(fn, { timeout = 20000, interval = 400, label = '조건' } = {}) {
  const deadline = Date.now() + timeout;
  let last = null;
  while (Date.now() < deadline) {
    try {
      last = await fn();
      if (last) return last;
    } catch (e) {
      last = e.message;
    }
    await new Promise((r) => setTimeout(r, interval));
  }
  throw new Error(`타임아웃: ${label} (마지막 값: ${JSON.stringify(last)})`);
}
