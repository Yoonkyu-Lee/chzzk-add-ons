import { fetchAllReplays, fetchVideo } from '../common/chzzk-api.js';
import { addItems, removeItem, totalDuration } from '../common/queue.js';
import { formatDurationKo } from '../common/format.js';

const TOOLBAR_ID = 'chzzk-addons-toolbar';
const BTN_CLASS = 'chzzk-addons-add';
const STYLE_ID = 'chzzk-addons-inline-style';

// T0 정찰로 확정한 기준점 (스펙 4.3절).
// 클래스명에 의존하지 않는다 — 치지직은 해시 클래스를 쓰므로 배포마다 바뀐다.
// 실측: 카드 18개에 링크 36개, 즉 카드당 2개(썸네일과 제목)다.
const CARD_LINK = 'a[href*="/video/"]';

function videoNoFromLink(a) {
  const m = a.getAttribute('href')?.match(/\/video\/(\d+)/);
  return m ? Number(m[1]) : null;
}

// 카드 경계는 링크에서 올라가며 찾는다. 실측에서 li._item_* 로 잡힌다.
function cardOf(a) {
  return a.closest('li') ?? a.parentElement;
}

function injectStyleOnce() {
  if (document.getElementById(STYLE_ID)) return;
  const s = document.createElement('style');
  s.id = STYLE_ID;
  // 치지직 페이지에 직접 넣는 스타일이므로 접두사를 붙여 충돌을 피한다.
  s.textContent = `
    #${TOOLBAR_ID}{display:flex;flex-wrap:wrap;gap:8px;align-items:center;
      margin:12px 0;padding:10px 12px;border-radius:5px;
      background:rgba(142,128,255,.12);border:1px solid rgba(142,128,255,.42);
      font-family:'Malgun Gothic','Apple SD Gothic Neo',sans-serif;color:#F1F3F5}
    #${TOOLBAR_ID} .tag{font-size:10px;font-weight:700;letter-spacing:.1em;
      color:#8E80FF;border:1px solid rgba(142,128,255,.5);padding:2px 6px;border-radius:3px}
    #${TOOLBAR_ID} button{font:inherit;font-size:12px;font-weight:500;padding:6px 11px;
      border-radius:4px;cursor:pointer;border:1px solid #383C42;background:#2A2D31;color:#F1F3F5}
    #${TOOLBAR_ID} button:hover{background:#383C42}
    #${TOOLBAR_ID} button.primary{background:#5C4BD6;border-color:#8E80FF;color:#fff}
    #${TOOLBAR_ID} button.primary:hover{background:#8E80FF}
    #${TOOLBAR_ID} button:disabled{opacity:.45;cursor:default}
    #${TOOLBAR_ID} .count{font-size:11.5px;color:#98A0A8;margin-left:auto}
    #${TOOLBAR_ID} :focus-visible{outline:2px solid #8E80FF;outline-offset:2px}
    .${BTN_CLASS}{position:absolute;left:5px;top:5px;z-index:5;
      font-family:'Malgun Gothic','Apple SD Gothic Neo',sans-serif;
      font-size:10.5px;font-weight:600;line-height:1.3;
      padding:3px 7px;border-radius:3px;cursor:pointer;
      background:rgba(12,12,14,.86);color:#8E80FF;border:1px solid rgba(142,128,255,.55)}
    .${BTN_CLASS}.in{background:#5C4BD6;color:#fff}
    .${BTN_CLASS}:focus-visible{outline:2px solid #8E80FF;outline-offset:2px}
  `;
  document.head.appendChild(s);
}

export function attachVideosPage({ channelId, getQueue, commit, setStatus, openPanel }) {
  injectStyleOnce();

  const toolbar = document.createElement('div');
  toolbar.id = TOOLBAR_ID;
  toolbar.innerHTML = `
    <span class="tag">재생목록</span>
    <button class="primary" data-act="add-all">전체 담기 · 오래된 순</button>
    <button data-act="open">재생목록 열기</button>
    <span class="count"></span>
  `;
  const countEl = toolbar.querySelector('.count');

  function refreshCount() {
    const q = getQueue();
    countEl.textContent = q.items.length
      ? `담은 항목 ${q.items.length}개 · ${formatDurationKo(totalDuration(q.items))}`
      : '담은 항목 없음';
  }

  // 툴바를 목록 컨테이너 앞에 꽂는다.
  // 실측에서 카드의 parentElement가 ul._list_* 이다.
  function mountToolbar() {
    if (document.getElementById(TOOLBAR_ID)?.isConnected) return true;
    const firstLink = document.querySelector(CARD_LINK);
    if (!firstLink) return false;
    const container = cardOf(firstLink)?.parentElement;
    if (!container?.parentElement) return false;
    container.parentElement.insertBefore(toolbar, container);
    return true;
  }

  function decorateCards() {
    const links = document.querySelectorAll(CARD_LINK);
    for (const a of links) {
      const no = videoNoFromLink(a);
      if (no === null) continue;
      const card = cardOf(a);
      // 카드당 링크가 2개라 중복 부착을 막아야 한다.
      if (!card || card.querySelector(`.${BTN_CLASS}`)) continue;
      // getComputedStyle은 레이아웃을 강제하므로 새 카드에만 부른다.
      if (getComputedStyle(card).position === 'static') card.style.position = 'relative';

      const btn = document.createElement('button');
      btn.className = BTN_CLASS;
      btn.dataset.no = String(no);
      btn.type = 'button';
      card.appendChild(btn);
    }
    syncCardButtons();
    return links.length;
  }

  function syncCardButtons() {
    const inQueue = new Set(getQueue().items.map((i) => i.videoNo));
    for (const btn of document.querySelectorAll(`.${BTN_CLASS}`)) {
      const has = inQueue.has(Number(btn.dataset.no));
      btn.textContent = has ? '✓ 담김' : '＋ 담기';
      btn.classList.toggle('in', has);
      btn.setAttribute('aria-label', has ? '재생목록에서 빼기' : '재생목록에 담기');
    }
  }

  async function addAll() {
    const btn = toolbar.querySelector('[data-act="add-all"]');
    btn.disabled = true;
    btn.textContent = '담고 있습니다…';
    try {
      const { items, skipped, failedPages } = await fetchAllReplays(channelId);
      await commit(addItems(getQueue(), items));
      let msg = `${items.length}개를 오래된 순으로 담았습니다.`;
      if (skipped > 0) msg += ` ${skipped}개는 정보가 모자라 건너뛰었습니다.`;
      if (failedPages.length > 0) {
        msg += ` ${failedPages.length}개 페이지를 받지 못했습니다. 다시 눌러 주세요.`;
      }
      setStatus(msg, failedPages.length > 0 ? 'error' : 'info');
      openPanel();
    } catch (e) {
      setStatus('다시보기 목록을 가져오지 못했습니다. 잠시 후 다시 시도해 주세요.', 'error');
      console.warn('[chzzk-add-ons] 전체 담기 실패', e);
    } finally {
      btn.disabled = false;
      btn.textContent = '전체 담기 · 오래된 순';
      refreshCount();
      syncCardButtons();
    }
  }

  function onToolbarClick(e) {
    const act = e.target.closest('button')?.dataset.act;
    if (act === 'add-all') addAll();
    else if (act === 'open') openPanel();
  }

  async function onCardClick(e) {
    const btn = e.target.closest(`.${BTN_CLASS}`);
    if (!btn) return;
    // 카드 전체가 링크다. 막지 않으면 담기를 눌렀을 때 영상으로 이동한다.
    e.preventDefault();
    e.stopPropagation();

    const no = Number(btn.dataset.no);
    const q = getQueue();
    if (q.items.some((i) => i.videoNo === no)) {
      await commit(removeItem(q, no));
      refreshCount();
      syncCardButtons();
      return;
    }

    // 카드 DOM에서 제목을 긁으면 접근성 텍스트가 섞여 들어오고
    // (실측: "오늘 잠을 히익동영상 엔드로 이동") 날짜와 길이도 얻을 수 없다.
    // API로 받아야 제목이 깨끗하고 날짜가 있어 순서도 제대로 잡힌다.
    btn.textContent = '…';
    try {
      const item = await fetchVideo(no);
      await commit(addItems(getQueue(), [item]));
    } catch (e) {
      setStatus('영상 정보를 가져오지 못해 담지 못했습니다. 다시 눌러 주세요.', 'error');
      console.warn('[chzzk-add-ons] 개별 담기 실패', e);
    }
    refreshCount();
    syncCardButtons();
  }

  const mounted = mountToolbar();
  decorateCards();
  refreshCount();

  // 처음 부착에 실패해도 바로 알리지 않는다. document_idle 시점에는 카드가
  // 아직 렌더되지 않은 것이 정상이고, 아래 MutationObserver가 곧 붙인다.
  // 즉시 알리면 매 로드마다 헛된 오류 문구가 뜨고, 더 중요한 문구까지
  // 덮어쓴다 (하니스 시나리오 10에서 실제로 관측).
  // 유예 시간이 지나도 못 붙었을 때만 알린다.
  const MOUNT_GRACE_MS = 10000;
  let graceTimer = null;
  if (!mounted) {
    graceTimer = setTimeout(() => {
      graceTimer = null;
      if (document.getElementById(TOOLBAR_ID)?.isConnected) return;
      setStatus(
        '다시보기 목록을 찾지 못해 담기 버튼을 넣지 못했습니다. 페이지를 새로고침해 주세요.',
        'error'
      );
    }, MOUNT_GRACE_MS);
  }

  // 치지직이 페이지를 더 그리면 새 카드에도 버튼을 붙인다.
  //
  // 디바운스가 필수다. 이 페이지는 플레이어까지 띄워서 DOM 변경이 끊이지 않는데,
  // 콜백마다 querySelectorAll과 getComputedStyle을 돌면 렌더러가 멈춘다.
  // 실측으로 puppeteer의 Runtime.callFunctionOn이 타임아웃되는 것을 확인했다
  // (progress.md P2).
  //
  // 우리가 넣은 요소의 변경은 무시한다. 버튼을 붙이는 행위가 다시 콜백을
  // 부르는 순환을 끊는다.
  const SETTLE_MS = 250;
  let settleTimer = null;

  function isOurs(node) {
    return node instanceof Element
      && (node.id === TOOLBAR_ID || node.classList?.contains(BTN_CLASS));
  }

  const mo = new MutationObserver((records) => {
    const relevant = records.some((r) =>
      [...r.addedNodes, ...r.removedNodes].some((n) => !isOurs(n)));
    if (!relevant) return;
    if (settleTimer) clearTimeout(settleTimer);
    settleTimer = setTimeout(() => {
      settleTimer = null;
      mountToolbar();
      decorateCards();
    }, SETTLE_MS);
  });
  mo.observe(document.body, { childList: true, subtree: true });

  toolbar.addEventListener('click', onToolbarClick);
  // 캡처 단계에서 잡는다. 치지직의 링크 핸들러보다 먼저 막아야 한다.
  document.addEventListener('click', onCardClick, true);

  return function detach() {
    mo.disconnect();
    if (settleTimer) clearTimeout(settleTimer);
    if (graceTimer) clearTimeout(graceTimer);
    toolbar.removeEventListener('click', onToolbarClick);
    document.removeEventListener('click', onCardClick, true);
    toolbar.remove();
    for (const b of document.querySelectorAll(`.${BTN_CLASS}`)) b.remove();
  };
}
