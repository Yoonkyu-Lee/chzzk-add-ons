import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createEmptyQueue, sortByPublishedAsc, addItems, totalDuration
} from '../src/common/queue.js';

// 오킹TV 실측 데이터. 등갈비 두 조각은 제목이 같고 시각만 다르다.
// 이 케이스가 정렬의 존재 이유다.
const V = {
  deung2: { videoNo: 15175460, title: '등갈비', publishedAt: '2026-09-13 15:31:22', duration: 4507 },
  deung1: { videoNo: 15174856, title: '등갈비', publishedAt: '2026-09-13 14:15:57', duration: 3443 },
  tired: { videoNo: 15168378, title: '어머 개피곤해 진짜', publishedAt: '2026-09-13 01:33:20', duration: 19563 },
  today: { videoNo: 15204257, title: '오늘 잠을 히익', publishedAt: '2026-09-15 08:08:00', duration: 42675 }
};

test('createEmptyQueue: currentIndex는 -1이다', () => {
  const q = createEmptyQueue();
  assert.equal(q.version, 1);
  assert.deepEqual(q.items, []);
  assert.equal(q.currentIndex, -1);
});

test('sortByPublishedAsc: 같은 날 두 조각이 시각 순으로 온다', () => {
  const sorted = sortByPublishedAsc([V.deung2, V.deung1, V.tired]);
  assert.deepEqual(sorted.map((i) => i.videoNo), [15168378, 15174856, 15175460]);
});

test('sortByPublishedAsc: 원본 배열을 변형하지 않는다', () => {
  const input = [V.deung2, V.deung1];
  sortByPublishedAsc(input);
  assert.equal(input[0].videoNo, 15175460);
});

test('sortByPublishedAsc: 같은 시각이면 videoNo로 안정화한다', () => {
  const a = { videoNo: 20, publishedAt: '2026-09-01 00:00:00', duration: 1 };
  const b = { videoNo: 10, publishedAt: '2026-09-01 00:00:00', duration: 1 };
  assert.deepEqual(sortByPublishedAsc([a, b]).map((i) => i.videoNo), [10, 20]);
  assert.deepEqual(sortByPublishedAsc([b, a]).map((i) => i.videoNo), [10, 20]);
});

test('addItems: 오래된 순으로 담긴다', () => {
  const q = addItems(createEmptyQueue(), [V.today, V.deung2, V.tired]);
  assert.deepEqual(q.items.map((i) => i.videoNo), [15168378, 15175460, 15204257]);
});

test('addItems: 담기면 currentIndex가 0이 된다', () => {
  const q = addItems(createEmptyQueue(), [V.today]);
  assert.equal(q.currentIndex, 0);
});

test('addItems: 기본 필드를 채운다', () => {
  const q = addItems(createEmptyQueue(), [V.today]);
  assert.equal(q.items[0].progress, 0);
  assert.equal(q.items[0].done, false);
  assert.equal(q.items[0].unavailable, false);
  assert.equal(q.items[0].thumb, '');
  assert.equal(q.items[0].channelName, '');
});

test('addItems: 같은 videoNo를 다시 담아도 늘지 않는다', () => {
  let q = addItems(createEmptyQueue(), [V.today, V.tired]);
  q = addItems(q, [V.today, V.deung1]);
  assert.equal(q.items.length, 3);
});

test('addItems: 재담기 시 기존 progress와 done을 보존한다', () => {
  let q = addItems(createEmptyQueue(), [V.tired]);
  q.items[0].progress = 3512;
  q.items[0].done = true;
  q = addItems(q, [V.tired, V.today]);
  const tired = q.items.find((i) => i.videoNo === 15168378);
  assert.equal(tired.progress, 3512);
  assert.equal(tired.done, true);
});

test('addItems: 재담기 후에도 currentIndex가 같은 항목을 가리킨다', () => {
  // tired가 0번이었고, 앞에 끼어드는 항목이 없으므로 0을 유지한다.
  let q = addItems(createEmptyQueue(), [V.tired]);
  q = addItems(q, [V.today]);
  assert.equal(q.items[q.currentIndex].videoNo, 15168378);
});

test('addItems: 더 오래된 항목이 앞에 끼어들면 currentIndex가 밀린다', () => {
  let q = addItems(createEmptyQueue(), [V.today]);
  assert.equal(q.currentIndex, 0);
  q = addItems(q, [V.tired]);
  assert.equal(q.items[q.currentIndex].videoNo, 15204257);
  assert.equal(q.currentIndex, 1);
});

test('addItems: 빈 배열을 담아도 터지지 않는다', () => {
  const q = addItems(createEmptyQueue(), []);
  assert.equal(q.items.length, 0);
  assert.equal(q.currentIndex, -1);
});

test('addItems: 인자 큐를 변형하지 않는다', () => {
  const q0 = createEmptyQueue();
  addItems(q0, [V.today]);
  assert.equal(q0.items.length, 0);
});

test('totalDuration: 합산한다', () => {
  assert.equal(totalDuration([V.deung1, V.deung2]), 7950);
  assert.equal(totalDuration([]), 0);
});

test('totalDuration: duration이 없는 항목을 0으로 본다', () => {
  assert.equal(totalDuration([{ duration: null }, { duration: 10 }, {}]), 10);
});
