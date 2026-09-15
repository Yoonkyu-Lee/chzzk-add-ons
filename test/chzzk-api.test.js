import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { normalizeVideo, buildVideosUrl, fetchAllReplays, ApiError } from '../src/common/chzzk-api.js';

const page0 = JSON.parse(readFileSync(new URL('./fixtures/videos-page0.json', import.meta.url), 'utf8'));
const CH = '0f9a3b4fbb0e7137d1f0b4d70563031c';

test('normalizeVideo: 응답 항목을 내부 모델로 바꾼다', () => {
  const it = normalizeVideo(page0.content.data[0]);
  assert.equal(it.videoNo, 15175460);
  assert.equal(it.title, '등갈비');
  assert.equal(it.publishedAt, '2026-09-13 15:31:22');
  assert.equal(it.duration, 4507);
  assert.equal(it.channelId, CH);
  assert.equal(it.channelName, '오킹TV');
  assert.equal(it.thumb, 'https://livecloud-thumb.akamaized.net/a.jpg');
  assert.equal(it.progress, 0);
  assert.equal(it.done, false);
  assert.equal(it.unavailable, false);
});

test('normalizeVideo: 필수 필드가 없으면 null', () => {
  assert.equal(normalizeVideo({ videoTitle: 'x', publishDate: 'y', duration: 1 }), null);
  assert.equal(normalizeVideo({ videoNo: 1, publishDate: 'y', duration: 1 }), null);
  assert.equal(normalizeVideo({ videoNo: 1, videoTitle: 'x', duration: 1 }), null);
  assert.equal(normalizeVideo({ videoNo: 1, videoTitle: 'x', publishDate: 'y' }), null);
  assert.equal(normalizeVideo(null), null);
  assert.equal(normalizeVideo(undefined), null);
});

test('normalizeVideo: duration 0은 유효하다', () => {
  // 실측에 24초짜리 다시보기가 있고 0도 나올 수 있다.
  // 누락으로 처리하면 그 항목이 조용히 사라진다.
  const it = normalizeVideo({ videoNo: 1, videoTitle: 'x', publishDate: 'y', duration: 0 });
  assert.notEqual(it, null);
  assert.equal(it.duration, 0);
});

test('normalizeVideo: 썸네일과 채널이 없어도 통과한다', () => {
  const it = normalizeVideo({ videoNo: 1, videoTitle: 'x', publishDate: 'y', duration: 5 });
  assert.equal(it.thumb, '');
  assert.equal(it.channelName, '');
  assert.equal(it.channelId, '');
});

test('normalizeVideo: videoNo를 숫자로 만든다', () => {
  // 응답이 문자열로 올 가능성에 대비한다. 큐의 유일 키이므로 타입이 흔들리면
  // 중복 담기 방지가 깨진다.
  const it = normalizeVideo({ videoNo: '15175460', videoTitle: 'x', publishDate: 'y', duration: 5 });
  assert.equal(it.videoNo, 15175460);
  assert.equal(typeof it.videoNo, 'number');
});

test('buildVideosUrl: REPLAY만 최신순으로 요청한다', () => {
  const u = new URL(buildVideosUrl(CH, 0, 24));
  assert.equal(u.hostname, 'api.chzzk.naver.com');
  assert.equal(u.pathname, `/service/v1/channels/${CH}/videos`);
  assert.equal(u.searchParams.get('videoType'), 'REPLAY');
  assert.equal(u.searchParams.get('sortType'), 'LATEST');
  assert.equal(u.searchParams.get('pagingType'), 'PAGE');
  assert.equal(u.searchParams.get('page'), '0');
  assert.equal(u.searchParams.get('size'), '24');
});

function ok(body) {
  return { ok: true, status: 200, json: async () => body };
}
function fail(status) {
  return { ok: false, status, json: async () => ({}) };
}
function fakeFetch(pages) {
  return async (url) => {
    const page = Number(new URL(url).searchParams.get('page'));
    return pages[page] ? ok(pages[page]) : fail(500);
  };
}
function mkPage(page, nos, totalPages) {
  return {
    code: 200,
    content: {
      page,
      size: 2,
      totalCount: 5,
      totalPages,
      data: nos.map((n) => ({
        videoNo: n,
        videoTitle: `t${n}`,
        publishDate: `2026-09-0${n} 00:00:00`,
        duration: n * 10,
        channel: { channelId: CH, channelName: '오킹TV' }
      }))
    }
  };
}

test('fetchAllReplays: totalPages만큼 순회해 모두 모은다', async () => {
  const { items, skipped, failedPages } = await fetchAllReplays(CH, {
    fetchImpl: fakeFetch([mkPage(0, [5, 4], 3), mkPage(1, [3, 2], 3), mkPage(2, [1], 3)]),
    size: 2
  });
  assert.equal(items.length, 5);
  assert.equal(skipped, 0);
  assert.deepEqual(failedPages, []);
  assert.deepEqual(new Set(items.map((i) => i.videoNo)), new Set([1, 2, 3, 4, 5]));
});

test('fetchAllReplays: 깨진 항목은 세어서 알린다', async () => {
  const body = {
    code: 200,
    content: {
      page: 0, size: 2, totalCount: 2, totalPages: 1,
      data: [
        { videoNo: 1, videoTitle: 'ok', publishDate: '2026-09-01 00:00:00', duration: 10 },
        { videoTitle: '번호 없음', publishDate: '2026-09-02 00:00:00', duration: 10 }
      ]
    }
  };
  const { items, skipped } = await fetchAllReplays(CH, { fetchImpl: fakeFetch([body]) });
  assert.equal(items.length, 1);
  assert.equal(skipped, 1);
});

test('fetchAllReplays: 첫 요청이 실패하면 ApiError를 던진다', async () => {
  // totalPages를 모르면 순회 자체가 불가능하므로 이것만 치명적으로 다룬다.
  await assert.rejects(
    () => fetchAllReplays(CH, { fetchImpl: async () => fail(503) }),
    (e) => e instanceof ApiError && e.status === 503
  );
});

test('fetchAllReplays: 뒤 페이지 하나가 실패해도 나머지는 살린다', async () => {
  const impl = async (url) => {
    const page = Number(new URL(url).searchParams.get('page'));
    if (page === 1) return fail(500);
    return ok(mkPage(0, [1], 2));
  };
  const { items, failedPages } = await fetchAllReplays(CH, { fetchImpl: impl, size: 1 });
  assert.equal(items.length, 1);
  assert.deepEqual(failedPages, [1]);
});

test('fetchAllReplays: data가 비면 빈 결과를 돌려준다', async () => {
  const empty = { code: 200, content: { page: 0, size: 2, totalCount: 0, totalPages: 0, data: [] } };
  const { items, totalCount } = await fetchAllReplays(CH, { fetchImpl: fakeFetch([empty]) });
  assert.deepEqual(items, []);
  assert.equal(totalCount, 0);
});

test('fetchAllReplays: content가 없어도 터지지 않는다', async () => {
  const { items } = await fetchAllReplays(CH, { fetchImpl: async () => ok({ code: 200 }) });
  assert.deepEqual(items, []);
});

test('fetchAllReplays: 동시 요청 수를 넘기지 않는다', async () => {
  let inFlight = 0;
  let peak = 0;
  const impl = async (url) => {
    inFlight++;
    peak = Math.max(peak, inFlight);
    await new Promise((r) => setTimeout(r, 5));
    inFlight--;
    const page = Number(new URL(url).searchParams.get('page'));
    return ok(mkPage(page, [1], 9));
  };
  await fetchAllReplays(CH, { fetchImpl: impl, size: 1, concurrency: 2 });
  // 첫 페이지는 단독으로 나가므로 나머지 8개가 2개씩 흐른다.
  assert.ok(peak <= 2, `동시 요청이 ${peak}개까지 늘었다`);
});

test('fetchAllReplays: totalPages가 1이면 추가 요청을 하지 않는다', async () => {
  let calls = 0;
  const impl = async () => {
    calls++;
    return ok(mkPage(0, [1], 1));
  };
  await fetchAllReplays(CH, { fetchImpl: impl });
  assert.equal(calls, 1);
});
