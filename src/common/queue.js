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
