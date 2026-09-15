// 큐를 변환하는 순수 함수 모음. DOM·storage·fetch·현재 시각에 의존하지 않는다.
// 모든 함수는 인자를 변형하지 않고 새 값을 반환한다.

export const QUEUE_VERSION = 1;

export function createEmptyQueue() {
  return { version: QUEUE_VERSION, items: [], currentIndex: -1 };
}

// publishedAt은 'YYYY-MM-DD HH:mm:ss' 고정 폭이므로 문자열 비교로 충분하다.
// Date 파싱을 피하면 시간대 해석이 끼어들 여지가 없고, 같은 날 여러 조각으로
// 쪼개진 방송의 시각 순서가 자동으로 해결된다.
// 같은 시각이면 videoNo로 안정화한다 — 정렬 결과가 매번 같아야 테스트가 선다.
export function sortByPublishedAsc(items) {
  return [...items].sort((a, b) => {
    const t = String(a.publishedAt).localeCompare(String(b.publishedAt));
    return t !== 0 ? t : a.videoNo - b.videoNo;
  });
}

function withDefaults(raw) {
  return {
    videoNo: raw.videoNo,
    title: raw.title ?? '',
    channelId: raw.channelId ?? '',
    channelName: raw.channelName ?? '',
    publishedAt: raw.publishedAt ?? '',
    duration: raw.duration ?? 0,
    thumb: raw.thumb ?? '',
    progress: raw.progress ?? 0,
    done: raw.done ?? false,
    unavailable: raw.unavailable ?? false
  };
}

// currentIndex는 위치가 아니라 "어느 항목"을 가리켜야 한다.
// 그래서 연산 전 videoNo를 앵커로 잡고 연산 후 그 항목의 새 위치로 되돌린다.
// 이 보정이 없으면 순서를 바꿀 때 재생 중인 항목이 바뀐다.
function anchorOf(queue) {
  return queue.items[queue.currentIndex]?.videoNo ?? null;
}

function restoreAnchor(items, anchor, fallbackIndex) {
  if (items.length === 0) return -1;
  if (anchor !== null) {
    const found = items.findIndex((i) => i.videoNo === anchor);
    if (found !== -1) return found;
  }
  return Math.min(Math.max(fallbackIndex, 0), items.length - 1);
}

export function addItems(queue, incoming) {
  const anchor = anchorOf(queue);
  const byNo = new Map(queue.items.map((i) => [i.videoNo, i]));
  for (const raw of incoming) {
    // 이미 있는 항목은 건드리지 않는다. progress와 done을 잃으면
    // "어디까지 봤는지"가 사라져 기능의 핵심이 무너진다.
    if (!byNo.has(raw.videoNo)) byNo.set(raw.videoNo, withDefaults(raw));
  }
  const items = sortByPublishedAsc([...byNo.values()]);
  return {
    version: QUEUE_VERSION,
    items,
    currentIndex: restoreAnchor(items, anchor, queue.currentIndex)
  };
}

export function totalDuration(items) {
  return items.reduce((sum, i) => sum + (Number(i.duration) || 0), 0);
}

// 완료 판정 기준. video.duration의 95%를 넘기면 봤다고 본다.
// 엔딩이나 방송 종료 화면을 끝까지 볼 필요는 없다.
const DONE_RATIO = 0.95;

export function moveItem(queue, fromIndex, toIndex) {
  const n = queue.items.length;
  if (fromIndex < 0 || fromIndex >= n || toIndex < 0 || toIndex >= n) return queue;
  const anchor = anchorOf(queue);
  const items = [...queue.items];
  items.splice(toIndex, 0, items.splice(fromIndex, 1)[0]);
  return { ...queue, items, currentIndex: restoreAnchor(items, anchor, queue.currentIndex) };
}

export function removeItem(queue, videoNo) {
  const idx = queue.items.findIndex((i) => i.videoNo === videoNo);
  if (idx === -1) return queue;
  const anchor = anchorOf(queue);
  const items = queue.items.filter((i) => i.videoNo !== videoNo);
  // 현재 항목을 뺐으면 앵커가 사라진다. 그때는 같은 위치를 가리킨다 —
  // 뒤로 밀면 이미 본 것을 다시 보게 되므로 앞으로 두지 않는다.
  const removedCurrent = anchor === videoNo;
  return {
    ...queue,
    items,
    currentIndex: restoreAnchor(
      items,
      removedCurrent ? null : anchor,
      removedCurrent ? idx : queue.currentIndex
    )
  };
}

export function reverseOrder(queue) {
  const anchor = anchorOf(queue);
  const items = [...queue.items].reverse();
  return { ...queue, items, currentIndex: restoreAnchor(items, anchor, queue.currentIndex) };
}

export function clearQueue(queue) {
  return { ...queue, items: [], currentIndex: -1 };
}

export function setCurrentByVideoNo(queue, videoNo) {
  const idx = queue.items.findIndex((i) => i.videoNo === videoNo);
  return idx === -1 ? queue : { ...queue, currentIndex: idx };
}

export function updateProgress(queue, videoNo, seconds, playerDuration) {
  const idx = queue.items.findIndex((i) => i.videoNo === videoNo);
  if (idx === -1) return queue;
  const dur = Number(playerDuration);
  // loadedmetadata 전에는 duration이 NaN이다. 그 상태로 비율을 계산하면
  // 보지도 않은 항목이 done으로 넘어간다. 기존 done도 지우지 않는다.
  const usable = Number.isFinite(dur) && dur > 0;
  const items = [...queue.items];
  items[idx] = {
    ...items[idx],
    progress: Math.max(0, Math.floor(Number(seconds) || 0)),
    done: usable ? seconds / dur >= DONE_RATIO : items[idx].done
  };
  return { ...queue, items };
}

export function markUnavailable(queue, videoNo) {
  const idx = queue.items.findIndex((i) => i.videoNo === videoNo);
  if (idx === -1) return queue;
  const items = [...queue.items];
  items[idx] = { ...items[idx], unavailable: true };
  return { ...queue, items };
}

// currentIndex 이후만 본다. 앞쪽으로 되돌아가면 앞의 미시청 항목과
// 현재 항목 사이를 무한히 왕복한다.
// currentIndex가 -1이면 0부터 시작해 첫 항목을 준다.
export function findNext(queue) {
  for (let i = queue.currentIndex + 1; i < queue.items.length; i++) {
    const it = queue.items[i];
    if (!it.done && !it.unavailable) return it;
  }
  return null;
}
