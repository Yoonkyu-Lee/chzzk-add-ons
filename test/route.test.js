import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectPageType, parseVideoNo, parseChannelId } from '../src/content/route.js';

const CH = '0f9a3b4fbb0e7137d1f0b4d70563031c';

test('detectPageType: 다시보기 목록', () => {
  assert.equal(detectPageType(`/${CH}/videos`), 'videos');
  assert.equal(detectPageType(`/${CH}/videos/`), 'videos');
});

test('detectPageType: 영상 페이지', () => {
  assert.equal(detectPageType('/video/15168378'), 'watch');
  assert.equal(detectPageType('/video/15168378/'), 'watch');
});

test('detectPageType: 그 외', () => {
  assert.equal(detectPageType('/'), 'other');
  assert.equal(detectPageType(`/${CH}`), 'other');
  assert.equal(detectPageType(`/${CH}/community`), 'other');
  assert.equal(detectPageType(`/${CH}/clips`), 'other');
  assert.equal(detectPageType('/live/abc'), 'other');
  assert.equal(detectPageType('/video/abc'), 'other');
});

test('detectPageType: 채널 id가 32자 hex가 아니면 목록으로 보지 않는다', () => {
  // /live/videos 같은 경로가 목록으로 오인되면 엉뚱한 채널에 툴바를 붙인다.
  assert.equal(detectPageType('/live/videos'), 'other');
  assert.equal(detectPageType('/abc/videos'), 'other');
  assert.equal(detectPageType(`/${CH}XX/videos`), 'other');
});

test('parseVideoNo: 숫자를 꺼낸다', () => {
  assert.equal(parseVideoNo('/video/15168378'), 15168378);
  assert.equal(parseVideoNo('/video/15168378/'), 15168378);
});

test('parseVideoNo: 영상 페이지가 아니면 null', () => {
  assert.equal(parseVideoNo(`/${CH}/videos`), null);
  assert.equal(parseVideoNo('/video/abc'), null);
  assert.equal(parseVideoNo('/'), null);
});

test('parseChannelId: 목록 경로에서 채널 id를 꺼낸다', () => {
  assert.equal(parseChannelId(`/${CH}/videos`), CH);
  assert.equal(parseChannelId(`/${CH}/videos/`), CH);
});

test('parseChannelId: 목록 경로가 아니면 null', () => {
  assert.equal(parseChannelId('/video/15168378'), null);
  assert.equal(parseChannelId('/'), null);
  assert.equal(parseChannelId(`/${CH}`), null);
});
