import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatDurationKo, formatClock, formatDateShort } from '../src/common/format.js';

test('formatDurationKo: 시간과 분으로 끊는다', () => {
  assert.equal(formatDurationKo(42675), '11시간 51분');
  assert.equal(formatDurationKo(19563), '5시간 26분');
  assert.equal(formatDurationKo(3600), '1시간 0분');
});

test('formatDurationKo: 한 시간 미만은 분만 쓴다', () => {
  assert.equal(formatDurationKo(3443), '57분');
  assert.equal(formatDurationKo(59), '0분');
  assert.equal(formatDurationKo(0), '0분');
});

test('formatDurationKo: 내림한다 — 반올림하면 12시간 51분이 된다', () => {
  // 42675 / 3600 = 11.854. 반올림 구현이면 12가 나온다.
  assert.equal(formatDurationKo(42675).startsWith('11시간'), true);
});

test('formatDurationKo: 음수와 쓰레기 입력을 0분으로 본다', () => {
  assert.equal(formatDurationKo(-5), '0분');
  assert.equal(formatDurationKo(null), '0분');
  assert.equal(formatDurationKo(undefined), '0분');
  assert.equal(formatDurationKo('abc'), '0분');
});

test('formatClock: 한 시간 넘으면 시:분:초', () => {
  assert.equal(formatClock(42675), '11:51:15');
  assert.equal(formatClock(3600), '1:00:00');
});

test('formatClock: 한 시간 미만은 분:초', () => {
  assert.equal(formatClock(59), '0:59');
  assert.equal(formatClock(3443), '57:23');
});

test('formatClock: 소수점 초를 버린다 — video.duration이 소수다', () => {
  assert.equal(formatClock(3582.9344900000124), '59:42');
});

test('formatDateShort: 월-일 시:분만 남긴다', () => {
  assert.equal(formatDateShort('2026-09-13 01:33:20'), '09-13 01:33');
  assert.equal(formatDateShort('2026-09-15 08:08:00'), '09-15 08:08');
});

test('formatDateShort: 형식이 다르면 원문을 돌려준다', () => {
  // API 응답 형식이 바뀌어도 화면이 깨지는 대신 원문이 보이게 한다.
  assert.equal(formatDateShort('nonsense'), 'nonsense');
  assert.equal(formatDateShort(''), '');
  assert.equal(formatDateShort(null), '');
  assert.equal(formatDateShort(undefined), '');
});
