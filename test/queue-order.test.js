import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createEmptyQueue, addItems, moveItem, removeItem, reverseOrder, clearQueue,
  setCurrentByVideoNo, updateProgress, markUnavailable, findNext
} from '../src/common/queue.js';

// 오래된 순으로 a(1일) b(2일) c(3일) d(4일)
const raw = [
  { videoNo: 1, title: 'a', publishedAt: '2026-09-01 00:00:00', duration: 100 },
  { videoNo: 2, title: 'b', publishedAt: '2026-09-02 00:00:00', duration: 200 },
  { videoNo: 3, title: 'c', publishedAt: '2026-09-03 00:00:00', duration: 300 },
  { videoNo: 4, title: 'd', publishedAt: '2026-09-04 00:00:00', duration: 400 }
];
const base = () => addItems(createEmptyQueue(), raw);
const nos = (q) => q.items.map((i) => i.videoNo);

test('moveItem: 항목을 옮긴다', () => {
  const q = moveItem(base(), 0, 2);
  assert.deepEqual(nos(q), [2, 3, 1, 4]);
});

test('moveItem: 현재 항목을 옮기면 currentIndex가 따라간다', () => {
  let q = setCurrentByVideoNo(base(), 1);
  q = moveItem(q, 0, 2);
  assert.equal(q.items[q.currentIndex].videoNo, 1);
  assert.equal(q.currentIndex, 2);
});

test('moveItem: 다른 항목을 옮겨도 현재 항목은 그대로다', () => {
  let q = setCurrentByVideoNo(base(), 3);
  q = moveItem(q, 0, 3);
  assert.equal(q.items[q.currentIndex].videoNo, 3);
});

test('moveItem: 범위를 벗어난 인덱스는 큐를 바꾸지 않는다', () => {
  const q = base();
  assert.deepEqual(nos(moveItem(q, -1, 2)), [1, 2, 3, 4]);
  assert.deepEqual(nos(moveItem(q, 0, 99)), [1, 2, 3, 4]);
  assert.deepEqual(nos(moveItem(q, 99, 0)), [1, 2, 3, 4]);
});

test('moveItem: 인자 큐를 변형하지 않는다', () => {
  const q0 = base();
  moveItem(q0, 0, 3);
  assert.deepEqual(nos(q0), [1, 2, 3, 4]);
});

test('removeItem: 항목을 뺀다', () => {
  const q = removeItem(base(), 2);
  assert.deepEqual(nos(q), [1, 3, 4]);
});

test('removeItem: 없는 번호는 큐를 바꾸지 않는다', () => {
  assert.deepEqual(nos(removeItem(base(), 999)), [1, 2, 3, 4]);
});

test('removeItem: 현재 항목이 아닌 것을 빼도 현재 항목은 그대로다', () => {
  let q = setCurrentByVideoNo(base(), 3);
  q = removeItem(q, 1);
  assert.equal(q.items[q.currentIndex].videoNo, 3);
});

test('removeItem: 현재 항목을 빼면 같은 위치를 가리킨다', () => {
  // 뒤로 밀면 이미 본 것을 다시 보게 되므로 앞으로 두지 않는다.
  let q = setCurrentByVideoNo(base(), 2);
  q = removeItem(q, 2);
  assert.equal(q.items[q.currentIndex].videoNo, 3);
});

test('removeItem: 마지막 항목이 현재였다면 새 마지막을 가리킨다', () => {
  let q = setCurrentByVideoNo(base(), 4);
  q = removeItem(q, 4);
  assert.equal(q.items[q.currentIndex].videoNo, 3);
});

test('removeItem: 하나뿐인 항목을 빼면 currentIndex는 -1이다', () => {
  let q = addItems(createEmptyQueue(), [raw[0]]);
  q = removeItem(q, 1);
  assert.equal(q.currentIndex, -1);
  assert.equal(q.items.length, 0);
});

test('reverseOrder: 뒤집어도 현재 항목은 그대로다', () => {
  let q = setCurrentByVideoNo(base(), 2);
  q = reverseOrder(q);
  assert.deepEqual(nos(q), [4, 3, 2, 1]);
  assert.equal(q.items[q.currentIndex].videoNo, 2);
});

test('reverseOrder: 빈 큐에서도 터지지 않는다', () => {
  const q = reverseOrder(createEmptyQueue());
  assert.deepEqual(q.items, []);
  assert.equal(q.currentIndex, -1);
});

test('clearQueue: 비운다', () => {
  const q = clearQueue(base());
  assert.deepEqual(q.items, []);
  assert.equal(q.currentIndex, -1);
});

test('setCurrentByVideoNo: 큐에 없는 번호면 그대로 둔다', () => {
  const q0 = setCurrentByVideoNo(base(), 2);
  const q1 = setCurrentByVideoNo(q0, 999);
  assert.equal(q1.currentIndex, q0.currentIndex);
});

test('updateProgress: 재생 위치를 기록한다', () => {
  const q = updateProgress(base(), 2, 50, 200);
  assert.equal(q.items[1].progress, 50);
  assert.equal(q.items[1].done, false);
});

test('updateProgress: 95%를 넘으면 done이다', () => {
  const q = updateProgress(base(), 2, 190, 200);
  assert.equal(q.items[1].done, true);
});

test('updateProgress: 경계값 — 94%는 아직 아니다', () => {
  assert.equal(updateProgress(base(), 2, 188, 200).items[1].done, false);
  assert.equal(updateProgress(base(), 2, 190, 200).items[1].done, true);
  assert.equal(updateProgress(base(), 2, 200, 200).items[1].done, true);
});

test('updateProgress: playerDuration이 0이나 NaN이면 done 판정을 하지 않는다', () => {
  // loadedmetadata 전에는 duration이 NaN이다. 이때 done으로 찍으면
  // 보지도 않은 항목이 완료로 넘어간다.
  assert.equal(updateProgress(base(), 2, 10, 0).items[1].done, false);
  assert.equal(updateProgress(base(), 2, 10, NaN).items[1].done, false);
  assert.equal(updateProgress(base(), 2, 10, Infinity).items[1].done, false);
});

test('updateProgress: duration을 모르면 기존 done을 지우지 않는다', () => {
  let q = updateProgress(base(), 2, 190, 200);
  assert.equal(q.items[1].done, true);
  q = updateProgress(q, 2, 5, NaN);
  assert.equal(q.items[1].done, true);
});

test('updateProgress: 없는 videoNo는 큐를 바꾸지 않는다', () => {
  const q = base();
  assert.deepEqual(updateProgress(q, 999, 10, 100).items, q.items);
});

test('markUnavailable: 표시한다', () => {
  const q = markUnavailable(base(), 2);
  assert.equal(q.items[1].unavailable, true);
  assert.equal(q.items[0].unavailable, false);
});

test('findNext: 현재 이후의 첫 미시청 항목', () => {
  const q = setCurrentByVideoNo(base(), 2);
  assert.equal(findNext(q).videoNo, 3);
});

test('findNext: done 항목을 건너뛴다', () => {
  let q = setCurrentByVideoNo(base(), 1);
  q = updateProgress(q, 2, 200, 200);
  assert.equal(findNext(q).videoNo, 3);
});

test('findNext: unavailable 항목을 건너뛴다', () => {
  let q = setCurrentByVideoNo(base(), 1);
  q = markUnavailable(q, 2);
  assert.equal(findNext(q).videoNo, 3);
});

test('findNext: 뒤로 되돌아가지 않는다 — 무한 순환 방지', () => {
  // 앞쪽 1번이 미시청이어도 현재(4번) 이후를 보므로 null이다.
  const q = setCurrentByVideoNo(base(), 4);
  assert.equal(findNext(q), null);
});

test('findNext: 남은 항목이 전부 done이면 null', () => {
  let q = setCurrentByVideoNo(base(), 2);
  q = updateProgress(q, 3, 300, 300);
  q = updateProgress(q, 4, 400, 400);
  assert.equal(findNext(q), null);
});

test('findNext: 빈 큐는 null', () => {
  assert.equal(findNext(createEmptyQueue()), null);
});

test('findNext: currentIndex가 -1이면 첫 항목을 준다', () => {
  // 큐를 처음 열었을 때 이어서 재생이 동작해야 한다.
  const q = { ...base(), currentIndex: -1 };
  assert.equal(findNext(q).videoNo, 1);
});
