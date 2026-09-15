import { formatDurationKo, formatDateShort } from '../common/format.js';

const ID = 'chzzk-addons-upnext';

export function hideUpNext() {
  document.getElementById(ID)?.remove();
}

// 플레이어 위에 얹는다. 정찰에서 확인한 prismplayer 루트(.pzp)를 우선 쓰고,
// 없으면 video의 첫 non-static 조상, 그것도 없으면 화면 오른쪽 아래에 고정한다.
function anchorFor(video) {
  const pzp = document.querySelector('.pzp');
  if (pzp && getComputedStyle(pzp).position !== 'static') return pzp;
  let el = video?.parentElement;
  while (el && el !== document.body) {
    if (getComputedStyle(el).position !== 'static') return el;
    el = el.parentElement;
  }
  return null;
}

export function showUpNext({ video, item, seconds, onPlay, onCancel }) {
  hideUpNext();
  const host = anchorFor(video);

  const box = document.createElement('div');
  box.id = ID;
  const place = host
    ? 'position:absolute;right:16px;bottom:76px;z-index:60;'
    : 'position:fixed;right:16px;bottom:16px;z-index:2147483000;';
  box.setAttribute('style', place
    + 'width:272px;max-width:calc(100vw - 32px);box-sizing:border-box;'
    + 'background:rgba(10,10,12,.93);border:1px solid #383C42;border-radius:5px;'
    + 'padding:11px;color:#F1F3F5;'
    + "font-family:'Malgun Gothic','Apple SD Gothic Neo',sans-serif;");

  box.innerHTML = `
    <div style="font-size:9.5px;letter-spacing:.13em;color:#8E80FF;font-weight:700">
      다음 항목 · <span data-sec>${seconds}</span>초 후
    </div>
    <div data-title style="font-size:12.5px;font-weight:600;margin-top:5px;line-height:1.35"></div>
    <div style="font-size:10.5px;color:#98A0A8;margin-top:2px">
      ${formatDateShort(item.publishedAt)} · ${formatDurationKo(item.duration)}
    </div>
    <div style="display:flex;gap:6px;margin-top:10px">
      <button data-act="play" type="button" style="font:inherit;font-size:12px;font-weight:500;
        padding:6px 11px;border-radius:4px;cursor:pointer;background:#5C4BD6;
        border:1px solid #8E80FF;color:#fff">바로 재생</button>
      <button data-act="cancel" type="button" style="font:inherit;font-size:12px;
        padding:6px 11px;border-radius:4px;cursor:pointer;background:#2A2D31;
        border:1px solid #383C42;color:#F1F3F5">취소</button>
    </div>`;
  // 제목은 textContent로 넣는다. 방송 제목에 꺾쇠가 들어올 수 있다.
  box.querySelector('[data-title]').textContent = item.title;

  (host ?? document.body).appendChild(box);

  let left = seconds;
  const secEl = box.querySelector('[data-sec]');
  const timer = setInterval(() => {
    left -= 1;
    if (left <= 0) {
      clearInterval(timer);
      onPlay();
      return;
    }
    secEl.textContent = String(left);
  }, 1000);

  box.addEventListener('click', (e) => {
    const act = e.target.closest('button')?.dataset.act;
    if (!act) return;
    // 플레이어 위에 있으므로 클릭이 아래로 새지 않게 막는다.
    e.preventDefault();
    e.stopPropagation();
    clearInterval(timer);
    if (act === 'play') {
      onPlay();
    } else {
      hideUpNext();
      onCancel();
    }
  });

  return {
    destroy() {
      clearInterval(timer);
      hideUpNext();
    }
  };
}
