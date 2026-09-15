import { formatDurationKo, formatClock, formatDateShort } from '../common/format.js';
import { totalDuration } from '../common/queue.js';

const HOST_ID = 'chzzk-addons-panel-host';

// 치지직 리렌더 트리 밖에 붙인다. body 아래에 두면 React가 그 서브트리를
// 갈아치울 때 패널이 통째로 사라진다. Shadow DOM은 CSS를 양방향 격리한다.
function createHost() {
  const existing = document.getElementById(HOST_ID);
  if (existing) return existing;
  const host = document.createElement('div');
  host.id = HOST_ID;
  document.documentElement.appendChild(host);
  return host;
}

async function loadCss() {
  const url = chrome.runtime.getURL('src/panel/panel.css');
  const res = await fetch(url);
  return res.text();
}

export async function mountPanel({ onIntent }) {
  const host = createHost();
  const root = host.shadowRoot ?? host.attachShadow({ mode: 'open' });
  root.innerHTML = '';

  const style = document.createElement('style');
  style.textContent = await loadCss();
  root.appendChild(style);

  const panel = document.createElement('div');
  panel.className = 'panel';
  panel.hidden = true;
  panel.innerHTML = `
    <div class="head">
      <div class="row1">
        <span class="name">지금 보는 큐</span>
        <button class="x" id="ca-close" aria-label="닫기">✕</button>
      </div>
      <div class="stat" id="ca-stat"></div>
      <div class="prog"><i id="ca-prog" style="width:0%"></i></div>
    </div>
    <div class="status" id="ca-status" hidden></div>
    <div class="rows" id="ca-rows"></div>
    <div class="foot">
      <button class="btn primary" id="ca-resume">이어서 재생</button>
      <button class="btn" id="ca-reverse">순서 뒤집기</button>
      <span class="spacer"></span>
      <button class="btn" id="ca-clear">비우기</button>
    </div>
  `;
  root.appendChild(panel);

  const $ = (id) => root.getElementById(id);
  const rows = $('ca-rows');

  $('ca-close').addEventListener('click', () => onIntent({ type: 'close' }));
  $('ca-resume').addEventListener('click', () => onIntent({ type: 'resume' }));
  $('ca-reverse').addEventListener('click', () => onIntent({ type: 'reverse' }));
  $('ca-clear').addEventListener('click', () => onIntent({ type: 'clear' }));

  rows.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-act]');
    if (btn) {
      const i = Number(btn.dataset.i);
      const act = btn.dataset.act;
      if (act === 'up') onIntent({ type: 'move', from: i, to: i - 1 });
      else if (act === 'down') onIntent({ type: 'move', from: i, to: i + 1 });
      else if (act === 'remove') onIntent({ type: 'remove', videoNo: Number(btn.dataset.no) });
      return;
    }
    const meta = e.target.closest('.meta');
    if (meta) onIntent({ type: 'play', videoNo: Number(meta.dataset.no) });
  });

  function render(queue, status = { message: null, tone: 'info' }) {
    const items = queue.items;
    const doneCount = items.filter((i) => i.done).length;

    $('ca-stat').textContent = items.length
      ? `${items.length}개 · 총 ${formatDurationKo(totalDuration(items))} · ${doneCount}개 시청 완료`
      : '담긴 항목이 없습니다';
    $('ca-prog').style.width = items.length ? `${(doneCount / items.length) * 100}%` : '0%';

    const st = $('ca-status');
    st.hidden = !status.message;
    st.className = `status ${status.tone}`;
    st.textContent = status.message ?? '';

    $('ca-resume').disabled = items.length === 0;
    $('ca-reverse').disabled = items.length < 2;
    $('ca-clear').disabled = items.length === 0;

    if (items.length === 0) {
      rows.innerHTML = '<div class="empty">다시보기 목록에서 <b>전체 담기</b>를 누르면 '
        + '오래된 방송부터 순서대로 담깁니다.</div>';
      return;
    }

    rows.innerHTML = '';
    items.forEach((it, i) => {
      const row = document.createElement('div');
      const cls = ['row'];
      if (i === queue.currentIndex) cls.push('now');
      if (it.done) cls.push('done');
      if (it.unavailable) cls.push('gone');
      row.className = cls.join(' ');
      row.draggable = true;
      row.dataset.i = String(i);

      const date = formatDateShort(it.publishedAt) || '날짜 없음';
      const sub = it.unavailable
        ? '볼 수 없는 영상입니다'
        : it.done
          ? `${date} · 시청 완료`
          : it.progress > 0
            ? `${date} · ${formatClock(it.progress)} / ${formatClock(it.duration)}`
            : `${date} · ${formatDurationKo(it.duration)}`;

      const barPct = it.duration > 0 && !it.done
        ? Math.min(100, (it.progress / it.duration) * 100)
        : 0;

      row.innerHTML = `
        <span class="grip" aria-hidden="true">⠿</span>
        <span class="idx">${i + 1}</span>
        <button class="meta" data-no="${it.videoNo}">
          <span class="t"></span>
          <span class="s">${sub}</span>
          ${barPct > 0 ? `<span class="bar"><i style="width:${barPct}%"></i></span>` : ''}
        </button>
        <span class="ctl">
          <button data-act="up" data-i="${i}" aria-label="위로">▲</button>
          <button data-act="down" data-i="${i}" aria-label="아래로">▼</button>
          <button data-act="remove" data-i="${i}" data-no="${it.videoNo}" aria-label="빼기">✕</button>
        </span>
      `;
      // 제목은 textContent로 넣는다. 방송 제목에 <> 같은 문자가 들어올 수 있다.
      row.querySelector('.t').textContent = it.title;
      rows.appendChild(row);
    });
  }

  // 드래그 정렬. 키보드로는 ▲▼ 버튼을 쓴다.
  let dragFrom = null;
  function clearDragMarks() {
    for (const r of rows.querySelectorAll('.row.dragover')) r.classList.remove('dragover');
  }
  rows.addEventListener('dragstart', (e) => {
    const row = e.target.closest('.row');
    if (!row) return;
    dragFrom = Number(row.dataset.i);
    e.dataTransfer.effectAllowed = 'move';
  });
  rows.addEventListener('dragover', (e) => {
    const row = e.target.closest('.row');
    if (!row || dragFrom === null) return;
    e.preventDefault();
    clearDragMarks();
    row.classList.add('dragover');
  });
  rows.addEventListener('drop', (e) => {
    const row = e.target.closest('.row');
    if (!row || dragFrom === null) return;
    e.preventDefault();
    const to = Number(row.dataset.i);
    const from = dragFrom;
    dragFrom = null;
    clearDragMarks();
    if (to !== from) onIntent({ type: 'move', from, to });
  });
  rows.addEventListener('dragend', () => {
    dragFrom = null;
    clearDragMarks();
  });

  return {
    render,
    setOpen(open) { panel.hidden = !open; },
    isOpen() { return !panel.hidden; },
    destroy() { host.remove(); }
  };
}
