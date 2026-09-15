// 치지직 비공식 목록 API를 아는 유일한 파일이다.
// 응답 형태가 바뀌면 여기만 고친다. 밖으로는 정규화된 모델만 나간다.

const API_BASE = 'https://api.chzzk.naver.com/service/v1/channels';
const DEFAULT_SIZE = 24;
const DEFAULT_CONCURRENCY = 3;

export class ApiError extends Error {
  constructor(message, { status } = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

// sortType은 LATEST와 POPULAR만 동작한다. OLDEST는 200에 빈 배열이 온다.
// 그래서 최신순으로 전부 받아 우리가 뒤집는다 (queue.sortByPublishedAsc).
export function buildVideosUrl(channelId, page, size = DEFAULT_SIZE) {
  const q = new URLSearchParams({
    sortType: 'LATEST',
    pagingType: 'PAGE',
    page: String(page),
    size: String(size),
    publishDateAt: '',
    videoType: 'REPLAY'
  });
  return `${API_BASE}/${channelId}/videos?${q}`;
}

export function normalizeVideo(raw) {
  if (!raw) return null;
  // duration 0은 유효한 값이다 (실측에 24초짜리가 있다).
  // null/undefined만 누락으로 본다. 0을 누락 처리하면 항목이 조용히 사라진다.
  const hasDuration = raw.duration !== null && raw.duration !== undefined;
  if (!raw.videoNo || !raw.videoTitle || !raw.publishDate || !hasDuration) return null;
  return {
    // videoNo는 큐의 유일 키다. 타입이 흔들리면 중복 담기 방지가 깨진다.
    videoNo: Number(raw.videoNo),
    title: String(raw.videoTitle),
    channelId: raw.channel?.channelId ?? '',
    channelName: raw.channel?.channelName ?? '',
    publishedAt: String(raw.publishDate),
    duration: Number(raw.duration) || 0,
    thumb: raw.thumbnailImageUrl ?? '',
    progress: 0,
    done: false,
    unavailable: false
  };
}

async function getPage(fetchImpl, channelId, page, size) {
  const res = await fetchImpl(buildVideosUrl(channelId, page, size));
  if (!res.ok) throw new ApiError(`목록 요청 실패 (page ${page})`, { status: res.status });
  return res.json();
}

// 동시 요청을 제한한다. 65개면 3요청이라 크지 않지만, 비공식 API를
// 몰아치지 않는 것이 예의이고 차단 위험도 줄인다.
async function runLimited(tasks, limit) {
  const results = new Array(tasks.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, tasks.length) }, async () => {
    while (cursor < tasks.length) {
      const i = cursor++;
      results[i] = await tasks[i]();
    }
  });
  await Promise.all(workers);
  return results;
}

export async function fetchAllReplays(channelId, options = {}) {
  const {
    fetchImpl = globalThis.fetch,
    size = DEFAULT_SIZE,
    concurrency = DEFAULT_CONCURRENCY
  } = options;

  // 첫 페이지 실패만 치명적이다 — totalPages를 모르면 순회할 수 없다.
  const first = await getPage(fetchImpl, channelId, 0, size);
  const content = first?.content ?? {};
  const totalPages = Number(content.totalPages) || 0;

  const rawItems = [...(content.data ?? [])];
  const failedPages = [];

  if (totalPages > 1) {
    const tasks = [];
    for (let p = 1; p < totalPages; p++) {
      const page = p;
      tasks.push(async () => {
        try {
          const body = await getPage(fetchImpl, channelId, page, size);
          return { page, data: body?.content?.data ?? [] };
        } catch {
          // 뒤 페이지 하나가 실패해도 받은 것은 살린다.
          // 전부 버리면 사용자는 아무것도 담지 못한다.
          return { page, data: null };
        }
      });
    }
    for (const r of await runLimited(tasks, concurrency)) {
      if (r.data === null) failedPages.push(r.page);
      else rawItems.push(...r.data);
    }
  }

  let skipped = 0;
  const items = [];
  for (const raw of rawItems) {
    const it = normalizeVideo(raw);
    if (it) {
      items.push(it);
    } else {
      skipped++;
      console.warn('[chzzk-add-ons] 항목을 건너뜀 — 필수 필드 누락', raw?.videoNo);
    }
  }
  return {
    items,
    skipped,
    failedPages,
    totalCount: Number(content.totalCount) || items.length
  };
}
