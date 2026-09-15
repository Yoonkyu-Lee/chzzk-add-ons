import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStore, defaultUi, KEY_QUEUE, KEY_UI } from '../src/common/store.js';
import { createEmptyQueue, addItems } from '../src/common/queue.js';

// chrome.storage.local의 최소 대역. 실제 API 형태(get/set이 객체를 주고받음)를 흉내낸다.
function fakeArea(initial = {}) {
  const data = { ...initial };
  const listeners = [];
  return {
    async get(keys) {
      const ks = Array.isArray(keys) ? keys : [keys];
      const out = {};
      for (const k of ks) if (k in data) out[k] = data[k];
      return out;
    },
    async set(obj) {
      const changes = {};
      for (const [k, v] of Object.entries(obj)) {
        changes[k] = { oldValue: data[k], newValue: v };
        data[k] = v;
      }
      for (const l of [...listeners]) l(changes, 'local');
    },
    onChanged: {
      addListener: (l) => listeners.push(l),
      removeListener: (l) => {
        const i = listeners.indexOf(l);
        if (i !== -1) listeners.splice(i, 1);
      }
    },
    _data: () => data,
    _listenerCount: () => listeners.length
  };
}

const oneItem = [{ videoNo: 1, title: 'a', publishedAt: '2026-09-01 00:00:00', duration: 10 }];

test('loadQueue: 비어 있으면 빈 큐를 준다', async () => {
  const { queue, reset } = await createStore(fakeArea()).loadQueue();
  assert.equal(queue.items.length, 0);
  assert.equal(queue.currentIndex, -1);
  assert.equal(reset, false);
});

test('saveQueue → loadQueue 왕복', async () => {
  const s = createStore(fakeArea());
  await s.saveQueue(addItems(createEmptyQueue(), oneItem));
  const { queue } = await s.loadQueue();
  assert.equal(queue.items.length, 1);
  assert.equal(queue.items[0].videoNo, 1);
  assert.equal(queue.currentIndex, 0);
});

test('loadQueue: 버전이 다르면 빈 큐로 초기화하고 reset을 알린다', async () => {
  const area = fakeArea({ [KEY_QUEUE]: { version: 99, items: [{ videoNo: 1 }], currentIndex: 0 } });
  const { queue, reset } = await createStore(area).loadQueue();
  assert.equal(queue.items.length, 0);
  assert.equal(reset, true);
});

test('loadQueue: 형태가 깨져 있어도 터지지 않는다', async () => {
  for (const bad of ['not an object', 42, [], { version: 1 }, { items: [] }]) {
    const { queue, reset } = await createStore(fakeArea({ [KEY_QUEUE]: bad })).loadQueue();
    assert.equal(queue.items.length, 0);
    assert.equal(reset, true);
  }
});

test('loadQueue: 읽기가 터져도 빈 큐를 돌려준다', async () => {
  const area = fakeArea();
  area.get = async () => { throw new Error('boom'); };
  const { queue, reset } = await createStore(area).loadQueue();
  assert.equal(queue.items.length, 0);
  assert.equal(reset, true);
});

test('loadUi: 기본값을 준다', async () => {
  const ui = await createStore(fakeArea()).loadUi();
  assert.deepEqual(ui, defaultUi());
  assert.equal(ui.panelOpen, false);
});

test('saveUi → loadUi 왕복', async () => {
  const s = createStore(fakeArea());
  await s.saveUi({ panelOpen: true });
  assert.equal((await s.loadUi()).panelOpen, true);
});

test('loadUi: 저장된 값에 없는 키는 기본값으로 채운다', async () => {
  const area = fakeArea({ [KEY_UI]: {} });
  assert.equal((await createStore(area).loadUi()).panelOpen, false);
});

test('subscribe: 큐가 바뀌면 콜백이 새 큐를 받는다', async () => {
  const s = createStore(fakeArea());
  const seen = [];
  s.subscribe((q) => seen.push(q));
  await s.saveQueue(addItems(createEmptyQueue(), [
    { videoNo: 7, title: 'x', publishedAt: '2026-09-01 00:00:00', duration: 1 }
  ]));
  assert.equal(seen.length, 1);
  assert.equal(seen[0].items[0].videoNo, 7);
});

test('subscribe: ui만 바뀌면 큐 콜백은 안 불린다', async () => {
  const s = createStore(fakeArea());
  const seen = [];
  s.subscribe((q) => seen.push(q));
  await s.saveUi({ panelOpen: true });
  assert.equal(seen.length, 0);
});

test('subscribe: 해지하면 더 받지 않는다', async () => {
  const s = createStore(fakeArea());
  const seen = [];
  const off = s.subscribe((q) => seen.push(q));
  off();
  await s.saveQueue(createEmptyQueue());
  assert.equal(seen.length, 0);
});

test('subscribe: 여러 번 구독해도 브릿지는 하나만 붙는다', async () => {
  const area = fakeArea();
  const s = createStore(area);
  s.subscribe(() => {});
  s.subscribe(() => {});
  s.subscribe(() => {});
  assert.equal(area._listenerCount(), 1);
});

test('subscribe: 깨진 값이 들어오면 빈 큐로 알린다', async () => {
  const area = fakeArea();
  const s = createStore(area);
  const seen = [];
  s.subscribe((q) => seen.push(q));
  await area.set({ [KEY_QUEUE]: 'garbage' });
  assert.equal(seen.length, 1);
  assert.equal(seen[0].items.length, 0);
});

test('saveQueue: 쓰기 실패를 throw하지 않고 false로 알린다', async () => {
  // 저장 실패로 패널 조작이 멈추는 것보다 실패를 표시하고 계속 도는 편이 낫다.
  const area = fakeArea();
  area.set = async () => { throw new Error('quota'); };
  assert.equal(await createStore(area).saveQueue(createEmptyQueue()), false);
});

test('saveQueue: 성공하면 true', async () => {
  assert.equal(await createStore(fakeArea()).saveQueue(createEmptyQueue()), true);
});

test('saveUi: 쓰기 실패를 false로 알린다', async () => {
  const area = fakeArea();
  area.set = async () => { throw new Error('quota'); };
  assert.equal(await createStore(area).saveUi({ panelOpen: true }), false);
});
