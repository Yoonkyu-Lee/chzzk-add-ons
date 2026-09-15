# 다시보기 재생목록 v1 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 치지직 다시보기를 원하는 순서로 담아 연속 재생하고, 어디까지 봤는지 기억하는 크롬 확장을 만든다.

**Architecture:** Manifest V3 content script가 치지직 페이지에 Shadow DOM 패널을 주입한다. 큐 상태는 `chrome.storage.local`의 단일 키에 배열로 저장한다. 순수 로직(`src/common/queue.js`)은 DOM·storage·fetch에 의존하지 않아 Node에서 전부 테스트되고, 치지직 마크업 의존은 `src/content/videos-page.js`와 `watch-page.js` 두 파일에만 존재한다.

**Tech Stack:** Manifest V3, 바닐라 ES 모듈 JS/CSS (확장 본체 빌드 없음), `node:test` 단위 테스트, `puppeteer-core` 검증 하니스 (devDependency)

**Spec:** `docs/superpowers/specs/2026-09-15-replay-playlist-design.md`

## Global Constraints

- **확장 본체(`src/`)는 빌드 없음.** 바닐라 ES 모듈 JS/CSS만. 트랜스파일·번들러·프레임워크 금지. `devDependencies`는 예외.
- **원격 코드 없음.** CDN 로드, `eval`, 외부 스크립트 주입 금지.
- **치지직 마크업 셀렉터는 `src/content/videos-page.js`와 `src/content/watch-page.js`에만.**
- **`chrome.storage`는 `src/common/store.js`만 접근한다.**
- **API 응답 스키마는 `src/common/chzzk-api.js`만 안다.** 밖으로는 정규화된 모델만 나간다.
- **`src/common/queue.js`는 순수 함수만.** DOM·storage·fetch·전역 상태·`Date.now()` 무의존. 인자를 변형하지 않고 새 값을 반환한다.
- **큐에 없는 영상 페이지에서는 아무 동작도 하지 않는다.**
- **조용히 실패하지 않는다.** 스펙 8장 에러 표의 모든 경로는 패널에 사용자가 읽을 한국어 문구를 남긴다. 사과하지 않는다.
- **완료 판정과 종료 감지는 `video.duration`(소수점) 기준.** API의 `duration`(정수 초)은 표시·합산용.
- **들여쓰기 2칸, 작은따옴표, 세미콜론.** 주석은 한국어로 *왜* 그렇게 했는지를 적는다.
- **작업 브랜치는 `feat/replay-playlist`.** `main`에 직접 커밋하지 않는다.
- **커밋 요약에 항목 ID를 넣는다** (`feat: T3 다음 항목 계산`). 작업 단위 완료 커밋에 `docs/progress.md` 갱신을 포함한다.
- **사용자의 Chrome을 이름 기준으로 종료하지 않는다.** `tools/.profile/` 경로로 식별한 프로세스만 정리한다.
- **하니스는 Chrome for Testing으로만 돈다.** 설치된 정식판(152)은 커맨드라인 확장 로드를 차단한다 (스펙 4.4절). 경로는 `tools/chrome-path.js`가 해석한다.
- **디버깅 창구는 `document.documentElement`의 data 속성이다.** content script는 isolated world에서 돌아 `window`에 심은 값이 `page.evaluate`에 보이지 않는다. `window.__chzzkAddons*`를 쓰지 않는다.
- **하니스는 `chrome.storage`를 service worker 타깃에서 읽고 쓴다.** main world에는 `chrome.storage`가 없다.
- **테스트 채널**: 오킹TV `0f9a3b4fbb0e7137d1f0b4d70563031c` (다시보기 65개 / 9페이지). **테스트 영상**: `14689850`.

---

## 파일 구조

| 파일 | 책임 | 의존 |
|---|---|---|
| `package.json` | `type: module`, 테스트/하니스 스크립트, devDependency | — |
| `manifest.json` | MV3 선언, content script, host permissions | — |
| `src/common/format.js` | 초·날짜 → 사람이 읽는 문자열 | 없음 |
| `src/common/queue.js` | 큐 배열 순수 변환 함수 모음 | 없음 |
| `src/common/chzzk-api.js` | 목록 API 호출 + 응답 정규화 | `fetch` |
| `src/common/store.js` | 큐/UI 상태 로드·저장·변경 구독 | `chrome.storage` |
| `src/panel/panel.css` | 패널 스타일 (shadow root에 주입) | — |
| `src/panel/panel.js` | Shadow DOM 패널 렌더 + 의도 콜백 | `panel.css`, `format.js` |
| `src/content/videos-page.js` | 목록 페이지 툴바·카드 버튼 | 치지직 DOM |
| `src/content/watch-page.js` | `<video>` 훅, 진행 저장, 전환 | 치지직 DOM |
| `src/content/boot.js` | 라우팅 감지 → 페이지 모듈 부착/정리 | 위 전부 |
| `src/sw.js` | 아이콘 클릭 → 패널 토글 메시지 | — |
| `test/*.test.js` | `node:test` 단위 테스트 | — |
| `test/fixtures/*.json` | 실제 API 응답 픽스처 | — |
| `tools/harness.js` | puppeteer-core 검증 하니스 | `puppeteer-core` |
| `tools/recon.js` | 치지직 DOM 정찰 (T0 전용) | `puppeteer-core` |
| `docs/manual-test.md` | 수동 확인 시나리오 | — |

---

### Task 0: 하니스 스모크 테스트와 DOM 정찰

이 항목이 먼저다. MV3 확장을 puppeteer로 로드하는 데는 알려진 함정이 있고, 이것이 실패하면 검증 계획 전체가 무너진다. 3시간째가 아니라 지금 알아야 한다. 동시에 스펙 4.3절의 미확인 셀렉터를 사실로 바꿔 뒤 작업의 추측을 없앤다.

**Files:**
- Create: `package.json`
- Create: `tools/recon.js`
- Create: `tools/fixtures/smoke-ext/manifest.json`
- Create: `tools/fixtures/smoke-ext/content.js`
- Modify: `docs/superpowers/specs/2026-09-15-replay-playlist-design.md` (4.2절에 정찰 결과 추가, 4.3절에서 해당 항목 제거)
- Modify: `docs/progress.md` (환경 사실 표)

**Interfaces:**
- Consumes: 없음
- Produces: 확정된 셀렉터 상수들 — `VIDEOS_GRID_SELECTOR`, `VIDEO_CARD_SELECTOR`, `CARD_LINK_SELECTOR`(카드에서 `videoNo`를 얻는 경로), `PLAYER_CONTAINER_SELECTOR`. Task 9·10이 이 값을 그대로 쓴다. 값은 `docs/progress.md`의 환경 사실 표에 기록한다.

- [ ] **Step 1: 브랜치를 만든다**

```bash
git checkout -b feat/replay-playlist
```

- [ ] **Step 2: `package.json`을 만든다**

`type: module`이 없으면 `node --test`가 `src/`의 ES 모듈을 읽지 못한다.

```json
{
  "name": "chzzk-add-ons",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "description": "치지직 다시보기 재생목록 크롬 확장",
  "scripts": {
    "test": "node --test test/",
    "harness": "node tools/harness.js",
    "recon": "node tools/recon.js"
  },
  "devDependencies": {
    "puppeteer-core": "^24.0.0"
  }
}
```

- [ ] **Step 3: 의존성을 설치한다**

Run: `npm install`
Expected: `puppeteer-core`가 설치된다. Chromium 다운로드는 일어나지 않는다 (`puppeteer-core`는 브라우저를 내려받지 않는다).

- [ ] **Step 4: 껍데기 확장을 만든다**

`tools/fixtures/smoke-ext/manifest.json`:

```json
{
  "manifest_version": 3,
  "name": "smoke",
  "version": "0.0.1",
  "content_scripts": [
    {
      "matches": ["https://chzzk.naver.com/*"],
      "js": ["content.js"],
      "run_at": "document_idle"
    }
  ]
}
```

`tools/fixtures/smoke-ext/content.js`:

```js
// 하니스가 확장 주입 성공을 판정하는 유일한 근거다.
// window에 표식을 남기고 콘솔에도 찍어 두 경로로 확인한다.
window.__CHZZK_SMOKE__ = 'ok';
console.log('[smoke] content script ran on', location.pathname);
```

- [ ] **Step 5: 정찰 스크립트를 만든다**

`tools/recon.js`:

```js
// T0 전용 정찰 도구. 두 가지를 확인한다.
//   (1) puppeteer-core로 MV3 확장이 실제로 주입되는가
//   (2) 다시보기 목록·영상 페이지의 실제 DOM 구조
// 결과를 stdout에 JSON으로 찍는다. 사람이 읽고 스펙에 옮긴다.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const HERE = dirname(fileURLToPath(import.meta.url));
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PROFILE = resolve(HERE, '.profile');
const OUT = resolve(HERE, 'out');
const EXT = resolve(HERE, 'fixtures/smoke-ext');

const CHANNEL = '0f9a3b4fbb0e7137d1f0b4d70563031c';
const VIDEO_NO = '14689850';

// MV3 확장은 구형 headless에서 로드되지 않는다. headful로 고정한다.
// 이것이 실패하면 raw CDP로 내려가야 한다 (계획의 Step 9 참고).
async function launch() {
  return puppeteer.launch({
    executablePath: CHROME,
    userDataDir: PROFILE,
    headless: false,
    args: [
      `--disable-extensions-except=${EXT}`,
      `--load-extension=${EXT}`,
      '--no-first-run',
      '--no-default-browser-check'
    ]
  });
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const browser = await launch();
  const result = {};
  try {
    const page = await browser.newPage();
    page.on('console', (m) => {
      if (m.text().includes('[smoke]')) console.log('CONSOLE:', m.text());
    });

    // (1) 확장 주입 확인
    await page.goto(`https://chzzk.naver.com/${CHANNEL}/videos?videoType=REPLAY`, {
      waitUntil: 'networkidle2',
      timeout: 45000
    });
    result.extensionInjected = await page
      .evaluate(() => window.__CHZZK_SMOKE__ === 'ok')
      .catch(() => false);

    // (2) 목록 페이지 구조 — videoNo를 담은 링크를 역추적해 카드 경계를 찾는다
    result.videosPage = await page.evaluate(() => {
      const links = [...document.querySelectorAll('a[href*="/video/"]')];
      const first = links[0];
      const chain = [];
      let el = first;
      for (let i = 0; el && i < 8; i++) {
        chain.push({
          tag: el.tagName.toLowerCase(),
          cls: el.className && String(el.className).slice(0, 120),
          childCount: el.children.length
        });
        el = el.parentElement;
      }
      return {
        linkCount: links.length,
        firstHref: first ? first.getAttribute('href') : null,
        ancestorChain: chain,
        bodyHasReactRoot: !!document.querySelector('#root, [id*="root"], [data-reactroot]')
      };
    });

    // (3) 영상 페이지 구조 + seek 실동작 (스펙 4.3-1)
    await page.goto(`https://chzzk.naver.com/video/${VIDEO_NO}`, {
      waitUntil: 'networkidle2',
      timeout: 45000
    });
    await page.waitForSelector('video', { timeout: 30000 }).catch(() => null);
    result.watchPage = await page.evaluate(async () => {
      const v = document.querySelector('video');
      if (!v) return { videoFound: false };
      const chain = [];
      let el = v.parentElement;
      for (let i = 0; el && i < 6; i++) {
        chain.push({ tag: el.tagName.toLowerCase(), cls: String(el.className).slice(0, 120) });
        el = el.parentElement;
      }
      const before = v.currentTime;
      v.currentTime = before + 60;
      await new Promise((r) => setTimeout(r, 1500));
      return {
        videoFound: true,
        iframeCount: document.querySelectorAll('iframe').length,
        duration: v.duration,
        readyState: v.readyState,
        seekBefore: before,
        seekAfter: v.currentTime,
        seekWorked: Math.abs(v.currentTime - (before + 60)) < 5,
        ancestorChain: chain,
        usesPushState: typeof history.pushState === 'function'
      };
    });

    await page.screenshot({ path: resolve(OUT, 'recon-watch.png') });
  } finally {
    await browser.close();
  }
  writeFileSync(resolve(OUT, 'recon.json'), JSON.stringify(result, null, 2), 'utf8');
  console.log(JSON.stringify(result, null, 2));
}

main().catch((e) => {
  console.error('RECON FAILED:', e.message);
  process.exit(1);
});
```

- [ ] **Step 6: 정찰을 실행한다**

Run: `node tools/recon.js`
Expected: `extensionInjected: true`, `videosPage.linkCount > 0`, `watchPage.videoFound: true`.

- [ ] **Step 7: `extensionInjected`가 `false`면 대안으로 내려간다**

순서대로 시도한다. 각 시도와 결과를 `docs/progress.md`의 "조사 중인 문제"에 적는다.

1. `headless: 'shell'`을 빼고 `headless: false`가 맞는지 확인 (이미 headful이므로 다음으로)
2. `args`에 `--disable-features=DisableLoadExtensionCommandLineSwitch` 추가
3. `puppeteer.launch` 대신 직접 Chrome을 띄우고 `puppeteer.connect({browserURL})`로 붙기
4. 위 셋이 다 실패하면 puppeteer를 버리고 raw CDP로 간다 — `chrome.exe --remote-debugging-port=9222 --load-extension=...`를 `child_process.spawn`으로 띄우고, `http://localhost:9222/json/list`로 타깃을 찾고, Node 24 내장 `WebSocket`으로 `Page.navigate`/`Runtime.evaluate`/`Page.captureScreenshot`을 직접 호출한다. 의존성 0.

접근 3개가 실패하면 CLAUDE.md의 런어웨이 가드에 따라 4번으로 바로 넘어간다.

- [ ] **Step 8: 정찰 결과를 스펙과 진행 기록에 옮긴다**

`recon.json`을 읽고:

- 스펙 4.2절에 `seekWorked`, 카드 셀렉터, `usesPushState`를 **확인된 사실**로 추가한다.
- 스펙 4.3절에서 확인된 항목(1·2·3번)을 **제거한다.**
- `docs/progress.md` 환경 사실 표에 `VIDEOS_GRID_SELECTOR`, `VIDEO_CARD_SELECTOR`, `CARD_LINK_SELECTOR`, `PLAYER_CONTAINER_SELECTOR`의 확정 값을 날짜와 함께 적는다.

셀렉터는 클래스명이 해시처럼 보이면(치지직은 CSS 모듈을 쓸 가능성이 높다) 클래스에 의존하지 않는다. `a[href*="/video/"]`를 기준점으로 잡고 `closest()`로 카드 경계를 올라가는 방식을 확정 값으로 적는다. 해시 클래스는 배포마다 바뀌므로 이것이 유일하게 견디는 방법이다.

- [ ] **Step 9: 커밋**

```bash
git add package.json package-lock.json tools/ docs/
git commit -m "chore: T0 하니스 스모크 테스트와 치지직 DOM 정찰

MV3 확장을 puppeteer로 로드하는 것이 가능한지 먼저 확인했다.
이것이 실패하면 검증 계획 전체가 무너지므로 기능 코드보다 앞에 두었다.

정찰로 확정한 셀렉터를 스펙 4.2절로 옮기고 4.3절의 미확인 항목을 줄였다.
클래스명이 아니라 a[href*=\"/video/\"] 기준점 + closest()로 카드를 찾는다.
해시 클래스는 배포마다 바뀌므로 이것만이 견딘다."
```

---

### Task 1: `format.js` — 시간·날짜 포맷

**Files:**
- Create: `src/common/format.js`
- Test: `test/format.test.js`

**Interfaces:**
- Consumes: 없음
- Produces:
  - `formatDurationKo(seconds: number) => string` — `42675` → `'11시간 51분'`, `59` → `'0분'`, `3600` → `'1시간 0분'`
  - `formatClock(seconds: number) => string` — `42675` → `'11:51:15'`, `59` → `'0:59'`
  - `formatDateShort(publishedAt: string) => string` — `'2026-09-13 01:33:20'` → `'09-13 01:33'`

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`test/format.test.js`:

```js
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
});

test('formatDateShort: 형식이 다르면 원문을 돌려준다', () => {
  // API 응답 형식이 바뀌어도 화면이 깨지는 대신 원문이 보이게 한다.
  assert.equal(formatDateShort('nonsense'), 'nonsense');
  assert.equal(formatDateShort(''), '');
});
```

- [ ] **Step 2: 실패를 확인한다**

Run: `node --test test/format.test.js`
Expected: FAIL — `Cannot find module '../src/common/format.js'`

- [ ] **Step 3: 최소 구현**

`src/common/format.js`:

```js
// 초 단위 길이를 사람이 읽는 한국어로 바꾼다.
// 내림을 쓴다. 반올림하면 11.85시간이 "12시간"으로 보여 실제보다 길어진다.
export function formatDurationKo(seconds) {
  const s = Math.max(0, Math.floor(Number(seconds) || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h}시간 ${m}분` : `${m}분`;
}

// 플레이어 눈금용. video.duration이 소수이므로 초를 버린다.
export function formatClock(seconds) {
  const s = Math.max(0, Math.floor(Number(seconds) || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`;
}

// API의 publishDate는 'YYYY-MM-DD HH:mm:ss' 고정 폭이다.
// Date로 파싱하지 않는다 — 시간대 해석이 끼어들면 표시가 흔들린다.
export function formatDateShort(publishedAt) {
  const raw = String(publishedAt ?? '');
  const m = raw.match(/^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})/);
  if (!m) return raw;
  return `${m[2]}-${m[3]} ${m[4]}:${m[5]}`;
}
```

- [ ] **Step 4: 통과를 확인한다**

Run: `node --test test/format.test.js`
Expected: PASS, 8 tests

- [ ] **Step 5: 커밋**

```bash
git add src/common/format.js test/format.test.js
git commit -m "feat: T1 시간·날짜 포맷

내림을 쓴다. 반올림이면 42675초가 12시간 51분으로 보여 실제보다 길다.
publishDate는 Date로 파싱하지 않는다 - 시간대 해석이 끼어들면
표시가 환경에 따라 흔들린다. 고정 폭 문자열이므로 정규식으로 자른다."
```

---

### Task 2: `queue.js` — 큐 생성·담기·정렬

**Files:**
- Create: `src/common/queue.js`
- Test: `test/queue-add.test.js`

**Interfaces:**
- Consumes: 없음
- Produces:
  - `createEmptyQueue() => Queue` — `{version: 1, items: [], currentIndex: -1}`
  - `sortByPublishedAsc(items: Item[]) => Item[]` — 새 배열
  - `addItems(queue: Queue, incoming: Item[]) => Queue` — 중복 `videoNo` 제외, 기존 항목의 `progress`·`done`·`unavailable` 보존, `publishedAt` 오름차순 정렬, `currentIndex` 보정
  - `totalDuration(items: Item[]) => number`
  - `Item` = `{videoNo, title, channelId, channelName, publishedAt, duration, thumb, progress, done, unavailable}`

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`test/queue-add.test.js`:

```js
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
  tired:  { videoNo: 15168378, title: '어머 개피곤해 진짜', publishedAt: '2026-09-13 01:33:20', duration: 19563 },
  today:  { videoNo: 15204257, title: '오늘 잠을 히익', publishedAt: '2026-09-15 08:08:00', duration: 42675 }
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
```

- [ ] **Step 2: 실패를 확인한다**

Run: `node --test test/queue-add.test.js`
Expected: FAIL — 모듈 없음

- [ ] **Step 3: 최소 구현**

`src/common/queue.js`:

```js
// 큐를 변환하는 순수 함수 모음. DOM·storage·fetch·현재 시각에 의존하지 않는다.
// 모든 함수는 인자를 변형하지 않고 새 값을 반환한다.

export const QUEUE_VERSION = 1;

export function createEmptyQueue() {
  return { version: QUEUE_VERSION, items: [], currentIndex: -1 };
}

// publishedAt은 'YYYY-MM-DD HH:mm:ss' 고정 폭이므로 문자열 비교로 충분하다.
// Date 파싱을 피하면 시간대 해석이 끼어들 여지가 없다.
// 같은 시각이면 videoNo로 안정화한다 - 정렬 결과가 매번 같아야 테스트가 선다.
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
// 이 보정이 빠지면 순서를 바꿀 때 재생 중인 항목이 바뀐다.
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
```

- [ ] **Step 4: 통과를 확인한다**

Run: `node --test test/queue-add.test.js`
Expected: PASS, 13 tests

- [ ] **Step 5: 커밋**

```bash
git add src/common/queue.js test/queue-add.test.js
git commit -m "feat: T2 큐 담기와 오래된 순 정렬

currentIndex를 위치가 아니라 videoNo 앵커로 보정한다. 위치로만 다루면
더 오래된 항목이 앞에 끼어들 때 재생 중인 항목이 바뀐다.

publishedAt은 고정 폭 문자열이라 문자열 비교로 정렬한다. Date 파싱을
피하면 시간대 해석이 끼어들 여지가 없고, 같은 날 조각들의 시각 순서가
자동으로 해결된다."
```

---

### Task 3: `queue.js` — 순서 변경·삭제·다음 항목

가장 버그가 나기 쉬운 지점이다. 스펙 9.1절이 이 항목을 단위 테스트 1순위로 지정했다.

**Files:**
- Modify: `src/common/queue.js`
- Test: `test/queue-order.test.js`

**Interfaces:**
- Consumes: Task 2의 `createEmptyQueue`, `addItems`, 내부 `anchorOf`/`restoreAnchor`
- Produces:
  - `moveItem(queue, fromIndex, toIndex) => Queue`
  - `removeItem(queue, videoNo) => Queue`
  - `reverseOrder(queue) => Queue`
  - `clearQueue(queue) => Queue`
  - `setCurrentByVideoNo(queue, videoNo) => Queue` — 없으면 큐를 그대로 반환
  - `updateProgress(queue, videoNo, seconds, playerDuration) => Queue` — `seconds/playerDuration >= 0.95`면 `done: true`
  - `markUnavailable(queue, videoNo) => Queue`
  - `findNext(queue) => Item | null` — `currentIndex` **이후**에서 `done`·`unavailable` 아닌 첫 항목

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`test/queue-order.test.js`:

```js
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
});

test('removeItem: 항목을 뺀다', () => {
  const q = removeItem(base(), 2);
  assert.deepEqual(nos(q), [1, 3, 4]);
});

test('removeItem: 현재 항목이 아닌 것을 빼도 현재 항목은 그대로다', () => {
  let q = setCurrentByVideoNo(base(), 3);
  q = removeItem(q, 1);
  assert.equal(q.items[q.currentIndex].videoNo, 3);
});

test('removeItem: 현재 항목을 빼면 같은 위치를 가리킨다', () => {
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

test('updateProgress: 경계값 - 94%는 아직 아니다', () => {
  assert.equal(updateProgress(base(), 2, 188, 200).items[1].done, false);
  assert.equal(updateProgress(base(), 2, 190, 200).items[1].done, true);
  assert.equal(updateProgress(base(), 2, 200, 200).items[1].done, true);
});

test('updateProgress: playerDuration이 0이나 NaN이면 done 판정을 하지 않는다', () => {
  // loadedmetadata 전에는 duration이 NaN이다. 이때 done으로 찍으면
  // 보지도 않은 항목이 완료로 넘어간다.
  assert.equal(updateProgress(base(), 2, 10, 0).items[1].done, false);
  assert.equal(updateProgress(base(), 2, 10, NaN).items[1].done, false);
});

test('updateProgress: 없는 videoNo는 큐를 바꾸지 않는다', () => {
  const q = base();
  assert.deepEqual(updateProgress(q, 999, 10, 100).items, q.items);
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

test('findNext: 뒤로 되돌아가지 않는다 - 무한 순환 방지', () => {
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
```

- [ ] **Step 2: 실패를 확인한다**

Run: `node --test test/queue-order.test.js`
Expected: FAIL — `moveItem is not a function` 등

- [ ] **Step 3: 구현을 덧붙인다**

`src/common/queue.js` 끝에 추가:

```js
// 완료 판정 기준. video.duration의 95%를 넘기면 봤다고 본다.
// 엔딩 크레딧이나 방송 종료 화면을 끝까지 볼 필요는 없다.
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
  // 현재 항목을 뺐으면 앵커가 사라진다. 그때는 같은 위치를 가리킨다 -
  // 뒤로 밀리면 이미 본 것을 다시 보게 되므로 앞으로 두지 않는다.
  const fallback = anchor === videoNo ? idx : queue.currentIndex;
  return { ...queue, items, currentIndex: restoreAnchor(items, anchor === videoNo ? null : anchor, fallback) };
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
  // 보지도 않은 항목이 done으로 넘어간다.
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

// currentIndex 이후만 본다. 앞쪽으로 되돌아가면 큐가 무한히 순환한다.
export function findNext(queue) {
  for (let i = queue.currentIndex + 1; i < queue.items.length; i++) {
    const it = queue.items[i];
    if (!it.done && !it.unavailable) return it;
  }
  return null;
}
```

- [ ] **Step 4: 통과를 확인한다**

Run: `node --test test/`
Expected: PASS, 44 tests (format 8 + add 13 + order 23)

- [ ] **Step 5: 커밋**

```bash
git add src/common/queue.js test/queue-order.test.js
git commit -m "feat: T3 순서 변경·삭제·다음 항목 계산

findNext는 currentIndex 이후만 본다. 앞쪽으로 되돌아가면 앞의 미시청
항목과 현재 항목 사이를 무한히 왕복한다.

현재 항목을 뺄 때는 같은 위치를 가리킨다. 뒤로 밀면 이미 본 것을
다시 보게 된다.

updateProgress는 playerDuration이 NaN이면 done 판정을 건너뛴다.
loadedmetadata 전 duration이 NaN인데 그대로 비율을 계산하면 보지도
않은 항목이 완료로 넘어간다."
```

---

### Task 4: `chzzk-api.js` — 목록 API 호출과 정규화

**Files:**
- Create: `src/common/chzzk-api.js`
- Create: `test/fixtures/videos-page0.json`
- Test: `test/chzzk-api.test.js`

**Interfaces:**
- Consumes: 없음
- Produces:
  - `normalizeVideo(raw) => Item | null` — 필수 필드(`videoNo`, `videoTitle`, `publishDate`, `duration`) 누락 시 `null`
  - `buildVideosUrl(channelId, page, size) => string`
  - `fetchAllReplays(channelId, {fetchImpl, size, concurrency}) => Promise<{items: Item[], skipped: number}>`
  - `ApiError` — `class ApiError extends Error { constructor(message, {status}) }`

- [ ] **Step 1: 픽스처를 만든다**

`test/fixtures/videos-page0.json` — 실제 API 응답의 축약본. 오킹TV 실측값을 쓴다.

```json
{
  "code": 200,
  "message": null,
  "content": {
    "page": 0,
    "size": 2,
    "totalCount": 5,
    "totalPages": 3,
    "data": [
      {
        "videoNo": 15175460,
        "videoId": "600AE005E9D9CE62B80D6B9438F8028AAF5E",
        "videoTitle": "등갈비",
        "videoType": "REPLAY",
        "publishDate": "2026-09-13 15:31:22",
        "thumbnailImageUrl": "https://livecloud-thumb.akamaized.net/a.jpg",
        "duration": 4507,
        "channel": {
          "channelId": "0f9a3b4fbb0e7137d1f0b4d70563031c",
          "channelName": "오킹TV"
        }
      },
      {
        "videoNo": 15174856,
        "videoTitle": "등갈비",
        "videoType": "REPLAY",
        "publishDate": "2026-09-13 14:15:57",
        "thumbnailImageUrl": "https://livecloud-thumb.akamaized.net/b.jpg",
        "duration": 3443,
        "channel": {
          "channelId": "0f9a3b4fbb0e7137d1f0b4d70563031c",
          "channelName": "오킹TV"
        }
      }
    ]
  }
}
```

- [ ] **Step 2: 실패하는 테스트를 쓴다**

`test/chzzk-api.test.js`:

```js
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
  assert.equal(it.channelName, '오킹TV');
  assert.equal(it.progress, 0);
  assert.equal(it.done, false);
});

test('normalizeVideo: 필수 필드가 없으면 null', () => {
  assert.equal(normalizeVideo({ videoTitle: 'x', publishDate: 'y', duration: 1 }), null);
  assert.equal(normalizeVideo({ videoNo: 1, publishDate: 'y', duration: 1 }), null);
  assert.equal(normalizeVideo({ videoNo: 1, videoTitle: 'x', duration: 1 }), null);
  assert.equal(normalizeVideo({ videoNo: 1, videoTitle: 'x', publishDate: 'y' }), null);
  assert.equal(normalizeVideo(null), null);
});

test('normalizeVideo: duration 0은 유효하다', () => {
  // 실측에 24초짜리도 있고 0도 나올 수 있다. 0을 누락으로 보면 항목이 사라진다.
  const it = normalizeVideo({ videoNo: 1, videoTitle: 'x', publishDate: 'y', duration: 0 });
  assert.equal(it.duration, 0);
});

test('normalizeVideo: 썸네일과 채널이 없어도 통과한다', () => {
  const it = normalizeVideo({ videoNo: 1, videoTitle: 'x', publishDate: 'y', duration: 5 });
  assert.equal(it.thumb, '');
  assert.equal(it.channelName, '');
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

function fakeFetch(pages) {
  return async (url) => {
    const page = Number(new URL(url).searchParams.get('page'));
    const body = pages[page];
    if (!body) return { ok: false, status: 500, json: async () => ({}) };
    return { ok: true, status: 200, json: async () => body };
  };
}

test('fetchAllReplays: totalPages만큼 순회해 모두 모은다', async () => {
  const mk = (page, nos) => ({
    code: 200,
    content: {
      page, size: 2, totalCount: 5, totalPages: 3,
      data: nos.map((n) => ({
        videoNo: n, videoTitle: `t${n}`, publishDate: `2026-09-0${n} 00:00:00`,
        duration: n * 10, channel: { channelId: CH, channelName: '오킹TV' }
      }))
    }
  });
  const { items, skipped } = await fetchAllReplays(CH, {
    fetchImpl: fakeFetch([mk(0, [5, 4]), mk(1, [3, 2]), mk(2, [1])]),
    size: 2
  });
  assert.equal(items.length, 5);
  assert.equal(skipped, 0);
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
  const fail = async () => ({ ok: false, status: 503, json: async () => ({}) });
  await assert.rejects(() => fetchAllReplays(CH, { fetchImpl: fail }), ApiError);
});

test('fetchAllReplays: 뒤 페이지 하나가 실패해도 나머지는 살린다', async () => {
  const mk = (page, nos) => ({
    code: 200,
    content: {
      page, size: 1, totalCount: 2, totalPages: 2,
      data: nos.map((n) => ({
        videoNo: n, videoTitle: `t${n}`, publishDate: `2026-09-0${n} 00:00:00`, duration: 10
      }))
    }
  });
  let call = 0;
  const flaky = async (url) => {
    const page = Number(new URL(url).searchParams.get('page'));
    call++;
    if (page === 1) return { ok: false, status: 500, json: async () => ({}) };
    return { ok: true, status: 200, json: async () => mk(0, [1]) };
  };
  const { items, failedPages } = await fetchAllReplays(CH, { fetchImpl: flaky, size: 1 });
  assert.equal(items.length, 1);
  assert.deepEqual(failedPages, [1]);
  assert.ok(call >= 2);
});

test('fetchAllReplays: data가 비면 빈 결과를 돌려준다', async () => {
  const empty = { code: 200, content: { page: 0, size: 2, totalCount: 0, totalPages: 0, data: [] } };
  const { items } = await fetchAllReplays(CH, { fetchImpl: fakeFetch([empty]) });
  assert.deepEqual(items, []);
});
```

- [ ] **Step 3: 실패를 확인한다**

Run: `node --test test/chzzk-api.test.js`
Expected: FAIL — 모듈 없음

- [ ] **Step 4: 구현**

`src/common/chzzk-api.js`:

```js
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
  // duration 0은 유효한 값이다 (실측에 24초짜리가 있다). null/undefined만 누락으로 본다.
  const hasDuration = raw.duration !== null && raw.duration !== undefined;
  if (!raw.videoNo || !raw.videoTitle || !raw.publishDate || !hasDuration) return null;
  return {
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

  // 첫 페이지 실패는 치명적이다 - totalPages를 모르면 아무것도 못 한다.
  const first = await getPage(fetchImpl, channelId, 0, size);
  const content = first?.content ?? {};
  const totalPages = Number(content.totalPages) || 0;

  const rawItems = [...(content.data ?? [])];
  const failedPages = [];

  if (totalPages > 1) {
    const tasks = [];
    for (let p = 1; p < totalPages; p++) {
      tasks.push(async () => {
        try {
          const body = await getPage(fetchImpl, channelId, p, size);
          return { page: p, data: body?.content?.data ?? [] };
        } catch {
          // 뒤 페이지 하나가 실패해도 받은 것은 살린다.
          // 전부 버리면 사용자는 아무것도 담지 못한다.
          return { page: p, data: null };
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
    if (it) items.push(it);
    else {
      skipped++;
      console.warn('[chzzk-add-ons] 항목을 건너뜀 — 필수 필드 누락', raw?.videoNo);
    }
  }
  return { items, skipped, failedPages, totalCount: Number(content.totalCount) || items.length };
}
```

- [ ] **Step 5: 통과를 확인한다**

Run: `node --test test/`
Expected: PASS, 54 tests

- [ ] **Step 6: 커밋**

```bash
git add src/common/chzzk-api.js test/chzzk-api.test.js test/fixtures/
git commit -m "feat: T4 목록 API 호출과 응답 정규화

duration 0을 누락으로 보지 않는다. 실측에 24초짜리 다시보기가 있고
0도 나올 수 있는데, 누락 처리하면 그 항목이 조용히 사라진다.

뒤 페이지 하나가 실패해도 받은 것은 살린다. 전부 버리면 사용자는
아무것도 담지 못한다. 실패한 페이지 번호를 돌려주어 패널이 알린다.

첫 페이지 실패만 치명적으로 다룬다 - totalPages를 모르면 순회할 수 없다."
```

---

### Task 5: `store.js` — 저장소 접근

**Files:**
- Create: `src/common/store.js`
- Test: `test/store.test.js`

**Interfaces:**
- Consumes: Task 2·3의 `createEmptyQueue`, `QUEUE_VERSION`
- Produces:
  - `KEY_QUEUE = 'queue'`, `KEY_UI = 'ui'`
  - `createStore(storageArea) => Store` — 테스트를 위해 저장 영역을 주입받는다
  - `Store` = `{loadQueue(), saveQueue(q), loadUi(), saveUi(ui), subscribe(cb) => unsubscribe}`
  - `defaultUi() => {panelOpen: false}`
  - 버전 불일치 시 `loadQueue()`는 `{queue: createEmptyQueue(), reset: true}`를 반환한다

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`test/store.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStore, defaultUi, KEY_QUEUE } from '../src/common/store.js';
import { createEmptyQueue, addItems } from '../src/common/queue.js';

// chrome.storage.local의 최소 대역. 실제 API 형태(get/set이 객체를 주고받음)를 흉내낸다.
function fakeArea(initial = {}) {
  let data = { ...initial };
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
      for (const l of listeners) l(changes, 'local');
    },
    onChanged: {
      addListener: (l) => listeners.push(l),
      removeListener: (l) => {
        const i = listeners.indexOf(l);
        if (i !== -1) listeners.splice(i, 1);
      }
    },
    _data: () => data
  };
}

test('loadQueue: 비어 있으면 빈 큐를 준다', async () => {
  const s = createStore(fakeArea());
  const { queue, reset } = await s.loadQueue();
  assert.equal(queue.items.length, 0);
  assert.equal(queue.currentIndex, -1);
  assert.equal(reset, false);
});

test('saveQueue → loadQueue 왕복', async () => {
  const area = fakeArea();
  const s = createStore(area);
  const q = addItems(createEmptyQueue(), [
    { videoNo: 1, title: 'a', publishedAt: '2026-09-01 00:00:00', duration: 10 }
  ]);
  await s.saveQueue(q);
  const { queue } = await s.loadQueue();
  assert.equal(queue.items.length, 1);
  assert.equal(queue.items[0].videoNo, 1);
});

test('loadQueue: 버전이 다르면 빈 큐로 초기화하고 reset을 알린다', async () => {
  const area = fakeArea({ [KEY_QUEUE]: { version: 99, items: [{ videoNo: 1 }], currentIndex: 0 } });
  const { queue, reset } = await createStore(area).loadQueue();
  assert.equal(queue.items.length, 0);
  assert.equal(reset, true);
});

test('loadQueue: 형태가 깨져 있어도 터지지 않는다', async () => {
  const area = fakeArea({ [KEY_QUEUE]: 'not an object' });
  const { queue, reset } = await createStore(area).loadQueue();
  assert.equal(queue.items.length, 0);
  assert.equal(reset, true);
});

test('loadUi: 기본값을 준다', async () => {
  const { panelOpen } = await createStore(fakeArea()).loadUi();
  assert.equal(panelOpen, defaultUi().panelOpen);
});

test('saveUi → loadUi 왕복', async () => {
  const s = createStore(fakeArea());
  await s.saveUi({ panelOpen: true });
  assert.equal((await s.loadUi()).panelOpen, true);
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

test('subscribe: 해지하면 더 받지 않는다', async () => {
  const s = createStore(fakeArea());
  const seen = [];
  const off = s.subscribe((q) => seen.push(q));
  off();
  await s.saveQueue(createEmptyQueue());
  assert.equal(seen.length, 0);
});

test('saveQueue: 쓰기 실패를 throw하지 않고 false로 알린다', async () => {
  const area = fakeArea();
  area.set = async () => { throw new Error('quota'); };
  const ok = await createStore(area).saveQueue(createEmptyQueue());
  assert.equal(ok, false);
});
```

- [ ] **Step 2: 실패를 확인한다**

Run: `node --test test/store.test.js`
Expected: FAIL — 모듈 없음

- [ ] **Step 3: 구현**

`src/common/store.js`:

```js
// chrome.storage를 아는 유일한 파일이다.
// 저장 영역을 주입받는 이유는 테스트 때문이다 - chrome 전역 없이 검증된다.
import { createEmptyQueue, QUEUE_VERSION } from './queue.js';

export const KEY_QUEUE = 'queue';
export const KEY_UI = 'ui';

export function defaultUi() {
  return { panelOpen: false };
}

function isValidQueue(v) {
  return !!v && typeof v === 'object' && Array.isArray(v.items) && v.version === QUEUE_VERSION;
}

export function createStore(storageArea) {
  const subscribers = new Set();
  let bridge = null;

  // storage.onChanged는 다른 탭의 변경도 전달한다.
  // 덕분에 목록 탭과 시청 탭이 같은 큐를 보게 된다.
  function ensureBridge() {
    if (bridge) return;
    bridge = (changes) => {
      if (!(KEY_QUEUE in changes)) return;
      const next = changes[KEY_QUEUE].newValue;
      const queue = isValidQueue(next) ? next : createEmptyQueue();
      for (const cb of subscribers) cb(queue);
    };
    storageArea.onChanged.addListener(bridge);
  }

  return {
    async loadQueue() {
      try {
        const got = await storageArea.get(KEY_QUEUE);
        const raw = got?.[KEY_QUEUE];
        if (raw === undefined) return { queue: createEmptyQueue(), reset: false };
        // 버전이 다르거나 형태가 깨졌으면 빈 큐로 간다.
        // reset을 올려 패널이 사용자에게 알릴 수 있게 한다 - 조용히 비우지 않는다.
        if (!isValidQueue(raw)) return { queue: createEmptyQueue(), reset: true };
        return { queue: raw, reset: false };
      } catch (e) {
        console.warn('[chzzk-add-ons] 큐를 읽지 못했습니다', e);
        return { queue: createEmptyQueue(), reset: true };
      }
    },

    async saveQueue(queue) {
      try {
        await storageArea.set({ [KEY_QUEUE]: queue });
        return true;
      } catch (e) {
        console.warn('[chzzk-add-ons] 큐를 저장하지 못했습니다', e);
        return false;
      }
    },

    async loadUi() {
      try {
        const got = await storageArea.get(KEY_UI);
        return { ...defaultUi(), ...(got?.[KEY_UI] ?? {}) };
      } catch {
        return defaultUi();
      }
    },

    async saveUi(ui) {
      try {
        await storageArea.set({ [KEY_UI]: ui });
        return true;
      } catch {
        return false;
      }
    },

    subscribe(cb) {
      ensureBridge();
      subscribers.add(cb);
      return () => subscribers.delete(cb);
    }
  };
}
```

- [ ] **Step 4: 통과를 확인한다**

Run: `node --test test/`
Expected: PASS, 63 tests

- [ ] **Step 5: 커밋**

```bash
git add src/common/store.js test/store.test.js
git commit -m "feat: T5 저장소 접근 계층

저장 영역을 주입받는다. chrome 전역 없이 Node에서 테스트되기 때문이다.

버전 불일치나 깨진 형태를 만나면 빈 큐로 가되 reset을 올려 패널이
알리게 한다. 조용히 비우면 사용자는 큐가 왜 사라졌는지 알 수 없다.

쓰기 실패는 throw하지 않고 false를 돌려준다. 저장 실패로 패널 조작이
멈추는 것보다 실패를 표시하고 계속 동작하는 편이 낫다."
```

---

### Task 6: `manifest.json`과 `boot.js` — 주입 골격

여기서 처음으로 브라우저에 올린다. 패널 내용 없이 "주입되고 라우팅이 감지된다"만 확인한다.

**Files:**
- Create: `manifest.json`
- Create: `src/content/boot.js`
- Create: `src/sw.js`
- Create: `src/content/loader.js`
- Modify: `tools/harness.js` (Task 13에서 완성, 여기서는 시나리오 1의 전신인 주입 확인만)

**Interfaces:**
- Consumes: Task 5의 `createStore`
- Produces:
  - `publishDebugState({pageType, queueLength})` — `document.documentElement`에 `data-chzzk-addons`(JSON)를 쓴다. **`window`에 쓰지 않는다** — isolated world라 하니스에 보이지 않는다 (스펙 4.4절)
  - `detectPageType(pathname) => 'videos' | 'watch' | 'other'`
  - `parseVideoNo(pathname) => number | null`
  - `parseChannelId(pathname) => string | null`
- Test: `test/route.test.js`

- [ ] **Step 1: 라우팅 판정 테스트를 쓴다**

경로 판정은 순수 함수이므로 브라우저 없이 테스트한다.
`src/content/route.js`로 분리해 `boot.js`가 쓰게 한다.

`test/route.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectPageType, parseVideoNo, parseChannelId } from '../src/content/route.js';

test('detectPageType: 다시보기 목록', () => {
  assert.equal(detectPageType('/0f9a3b4fbb0e7137d1f0b4d70563031c/videos'), 'videos');
});

test('detectPageType: 영상 페이지', () => {
  assert.equal(detectPageType('/video/15168378'), 'watch');
});

test('detectPageType: 그 외', () => {
  assert.equal(detectPageType('/'), 'other');
  assert.equal(detectPageType('/0f9a3b4fbb0e7137d1f0b4d70563031c'), 'other');
  assert.equal(detectPageType('/0f9a3b4fbb0e7137d1f0b4d70563031c/community'), 'other');
  assert.equal(detectPageType('/live/abc'), 'other');
});

test('parseVideoNo: 숫자를 꺼낸다', () => {
  assert.equal(parseVideoNo('/video/15168378'), 15168378);
  assert.equal(parseVideoNo('/video/15168378/'), 15168378);
});

test('parseVideoNo: 영상 페이지가 아니면 null', () => {
  assert.equal(parseVideoNo('/0f9a/videos'), null);
  assert.equal(parseVideoNo('/video/abc'), null);
});

test('parseChannelId: 목록 경로에서 채널 id를 꺼낸다', () => {
  assert.equal(parseChannelId('/0f9a3b4fbb0e7137d1f0b4d70563031c/videos'), '0f9a3b4fbb0e7137d1f0b4d70563031c');
});

test('parseChannelId: 목록 경로가 아니면 null', () => {
  assert.equal(parseChannelId('/video/15168378'), null);
  assert.equal(parseChannelId('/'), null);
});
```

- [ ] **Step 2: 실패를 확인한다**

Run: `node --test test/route.test.js`
Expected: FAIL — 모듈 없음

- [ ] **Step 3: `route.js`를 구현한다**

`src/content/route.js`:

```js
// 경로 판정만 한다. DOM을 보지 않으므로 Node에서 테스트된다.

// 채널 id는 32자 hex다. 이 형태로 제한하면 /live/, /설정 같은 경로가 걸리지 않는다.
const VIDEOS_RE = /^\/([0-9a-f]{32})\/videos\/?$/;
const WATCH_RE = /^\/video\/(\d+)\/?$/;

export function detectPageType(pathname) {
  if (VIDEOS_RE.test(pathname)) return 'videos';
  if (WATCH_RE.test(pathname)) return 'watch';
  return 'other';
}

export function parseVideoNo(pathname) {
  const m = pathname.match(WATCH_RE);
  return m ? Number(m[1]) : null;
}

export function parseChannelId(pathname) {
  const m = pathname.match(VIDEOS_RE);
  return m ? m[1] : null;
}
```

- [ ] **Step 4: 통과를 확인한다**

Run: `node --test test/route.test.js`
Expected: PASS, 7 tests

- [ ] **Step 5: `manifest.json`을 쓴다**

MV3 content script는 ES 모듈로 직접 선언할 수 없다. 그래서 클래식 스크립트 `loader.js`를 넣고 동적 `import()`로 모듈을 끌어온다. 그러려면 `src/**`가 `web_accessible_resources`에 있어야 한다.

```json
{
  "manifest_version": 3,
  "name": "치지직 애드온 — 다시보기 재생목록",
  "version": "0.1.0",
  "description": "치지직 다시보기를 원하는 순서로 담아 이어서 봅니다.",
  "permissions": ["storage"],
  "host_permissions": [
    "https://chzzk.naver.com/*",
    "https://api.chzzk.naver.com/*"
  ],
  "background": { "service_worker": "src/sw.js", "type": "module" },
  "action": { "default_title": "재생목록 열기" },
  "content_scripts": [
    {
      "matches": ["https://chzzk.naver.com/*"],
      "js": ["src/content/loader.js"],
      "run_at": "document_idle"
    }
  ],
  "web_accessible_resources": [
    {
      "resources": ["src/*", "src/*/*"],
      "matches": ["https://chzzk.naver.com/*"]
    }
  ]
}
```

- [ ] **Step 6: `loader.js`를 쓴다**

`src/content/loader.js`:

```js
// MV3 content script는 ES 모듈로 선언할 수 없다.
// 클래식 스크립트에서 동적 import로 모듈 그래프를 끌어온다.
(async () => {
  try {
    const url = chrome.runtime.getURL('src/content/boot.js');
    const mod = await import(url);
    await mod.start();
  } catch (e) {
    console.error('[chzzk-add-ons] 부팅에 실패했습니다', e);
  }
})();
```

- [ ] **Step 7: `boot.js`를 쓴다**

`src/content/boot.js`:

```js
import { detectPageType } from './route.js';

const VERSION = '0.1.0';

// 하니스가 주입 성공과 현재 페이지 타입을 읽는 창구다.
// window가 아니라 DOM에 쓴다 - content script는 isolated world에서 돌아서
// window에 심은 값이 page.evaluate(main world)에 보이지 않는다 (스펙 4.4절).
function publishDebugState(pageType) {
  document.documentElement.setAttribute(
    'data-chzzk-addons',
    JSON.stringify({ pageType, version: VERSION })
  );
}

let detachCurrent = null;
let lastPath = null;

async function attachFor(pageType) {
  if (detachCurrent) {
    detachCurrent();
    detachCurrent = null;
  }
  // 페이지별 모듈은 Task 9·10에서 붙인다. 지금은 골격만 세운다.
  publishDebugState(pageType);
}

async function route() {
  const path = location.pathname;
  if (path === lastPath) return;
  lastPath = path;
  await attachFor(detectPageType(path));
}

// 치지직은 SPA다. pushState/replaceState를 감싸야 내부 이동을 감지할 수 있다.
// 원래 함수를 보존해 호출하고, 우리 훅은 그 뒤에 얹는다.
function installRouteHooks() {
  for (const name of ['pushState', 'replaceState']) {
    const original = history[name];
    history[name] = function (...args) {
      const r = original.apply(this, args);
      route();
      return r;
    };
  }
  window.addEventListener('popstate', route);
}

export async function start() {
  installRouteHooks();
  await route();
}
```

- [ ] **Step 8: `sw.js`를 쓴다**

`src/sw.js`:

```js
// 아이콘 클릭을 활성 탭에 전달하는 것 외에는 아무 일도 하지 않는다.
// MV3 service worker는 수시로 죽으므로 상태를 여기 두지 않는다.
chrome.action.onClicked.addListener(async (tab) => {
  if (!tab?.id) return;
  try {
    await chrome.tabs.sendMessage(tab.id, { type: 'chzzk-addons/toggle-panel' });
  } catch {
    // content script가 없는 탭이면 조용히 지나간다. 사용자가 할 일이 없다.
  }
});
```

- [ ] **Step 9: 하니스로 주입을 확인한다**

`tools/recon.js`의 `EXT`를 저장소 루트(`resolve(HERE, '..')`)로 바꾸고 껍데기 대신 실제 확장을 로드해 확인한다. 임시 수정이므로 커밋하지 않고, 확인 후 되돌린다.

Run: `node tools/recon.js`
Expected: 목록 페이지에서 `window.__chzzkAddons.pageType === 'videos'`, 영상 페이지에서 `'watch'`.

콘솔에 `부팅에 실패했습니다`가 보이면 `web_accessible_resources`의 경로 패턴이 원인일 가능성이 가장 높다. `src/*` 한 줄로는 하위 디렉터리가 안 잡힐 수 있으므로 `src/**`나 개별 경로 나열로 바꿔 본다.

- [ ] **Step 10: 커밋**

```bash
git add manifest.json src/sw.js src/content/ test/route.test.js
git commit -m "feat: T6 MV3 주입 골격과 SPA 라우팅 감지

MV3 content script는 ES 모듈로 선언할 수 없어 클래식 loader.js에서
동적 import로 모듈 그래프를 끌어온다. 그래서 src/**가
web_accessible_resources에 있어야 한다.

채널 id를 32자 hex로 제한해 /live/ 같은 경로가 목록으로 오인되지 않게 했다.

pushState/replaceState를 감싼다. SPA 내부 이동에서는 content script가
재실행되지 않으므로 이것 없이는 페이지 전환을 알 수 없다."
```

---

### Task 7: 패널 렌더

**Files:**
- Create: `src/panel/panel.css`
- Create: `src/panel/panel.js`
- Modify: `src/content/boot.js` (패널 마운트)

**Interfaces:**
- Consumes: Task 1의 `formatDurationKo`/`formatClock`/`formatDateShort`, Task 2의 `totalDuration`
- Produces:
  - `mountPanel({onIntent}) => PanelHandle`
  - `PanelHandle` = `{render(queue, status), setOpen(bool), isOpen(), destroy()}`
  - `status` = `{message: string|null, tone: 'info'|'error'}` — 스펙 8장 에러 문구가 여기로 들어온다
  - `onIntent(intent)` — `intent`는 `{type: 'move', from, to}`, `{type: 'remove', videoNo}`, `{type: 'reverse'}`, `{type: 'clear'}`, `{type: 'play', videoNo}`, `{type: 'resume'}`, `{type: 'close'}` 중 하나

- [ ] **Step 1: `panel.css`를 쓴다**

목업(`docs/mockups/playlist-mockup.html`)의 패널 부분을 기준으로 한다. 치지직의 민트가 아니라 보라(`#8E80FF`)를 우리 색으로 쓴다 — 사용자가 무엇이 확장인지 구별할 수 있어야 한다.

```css
/* shadow root에 주입되므로 :host부터 시작한다. 치지직 CSS와 양방향 격리된다. */
:host {
  all: initial;
  position: fixed;
  top: 0;
  right: 0;
  z-index: 2147483000;
  font-family: 'Malgun Gothic', 'Apple SD Gothic Neo', sans-serif;
}
.panel {
  width: 352px;
  max-width: 100vw;
  height: 100vh;
  display: flex;
  flex-direction: column;
  background: #1E2023;
  color: #F1F3F5;
  border-left: 1px solid #000;
  box-shadow: -8px 0 28px rgba(0, 0, 0, .45);
  box-sizing: border-box;
}
.panel[hidden] { display: none; }
.head { padding: 14px 14px 12px; border-bottom: 1px solid #000; }
.row1 { display: flex; align-items: center; gap: 8px; }
.name { font-size: 13.5px; font-weight: 600; flex: 1; }
.stat { font-size: 11px; color: #98A0A8; margin-top: 6px; font-variant-numeric: tabular-nums; }
.prog { height: 3px; background: #383C42; border-radius: 2px; margin-top: 9px; }
.prog > i { display: block; height: 100%; background: #8E80FF; border-radius: 2px; }
.status { margin: 10px 14px 0; padding: 8px 10px; border-radius: 4px; font-size: 12px; line-height: 1.5; }
.status[hidden] { display: none; }
.status.info { background: rgba(142, 128, 255, .14); border: 1px solid rgba(142, 128, 255, .4); }
.status.error { background: rgba(224, 96, 72, .14); border: 1px solid rgba(224, 96, 72, .45); }
.rows { flex: 1; overflow-y: auto; }
.empty { padding: 28px 16px; color: #98A0A8; font-size: 12.5px; line-height: 1.7; }
.row { display: flex; gap: 9px; padding: 9px 12px 9px 8px; border-bottom: 1px solid #191B1E; align-items: flex-start; }
.row.now { background: rgba(142, 128, 255, .12); box-shadow: inset 2px 0 0 #8E80FF; }
.row.done { opacity: .5; }
.row.gone { opacity: .5; text-decoration: line-through; }
.row.dragover { box-shadow: inset 0 2px 0 #8E80FF; }
.grip { color: #5A6169; cursor: grab; font-size: 12px; padding-top: 2px; user-select: none; }
.idx { font-family: monospace; font-size: 11px; color: #98A0A8; width: 18px; text-align: right; padding-top: 2px; font-variant-numeric: tabular-nums; }
.meta { flex: 1; min-width: 0; cursor: pointer; }
.t { font-size: 12px; font-weight: 500; line-height: 1.35; }
.s { font-size: 10.5px; color: #98A0A8; margin-top: 2px; font-variant-numeric: tabular-nums; }
.bar { height: 2px; background: #383C42; margin-top: 5px; border-radius: 1px; }
.bar > i { display: block; height: 100%; background: #05F29B; border-radius: 1px; }
.ctl { display: flex; flex-direction: column; gap: 1px; }
.ctl > button { background: none; border: 0; color: #5A6169; cursor: pointer; font-size: 9px; padding: 2px 3px; font-family: monospace; }
.ctl > button:hover { color: #F1F3F5; }
.foot { padding: 11px 12px; border-top: 1px solid #000; display: flex; flex-wrap: wrap; gap: 7px; align-items: center; }
button.btn { font: inherit; font-size: 12px; font-weight: 500; padding: 6px 11px; border-radius: 4px; cursor: pointer; border: 1px solid #383C42; background: #2A2D31; color: #F1F3F5; }
button.btn:hover { background: #383C42; }
button.btn.primary { background: #5C4BD6; border-color: #8E80FF; color: #fff; }
button.btn.primary:hover { background: #8E80FF; }
button.btn:disabled { opacity: .45; cursor: default; }
:focus-visible { outline: 2px solid #8E80FF; outline-offset: 2px; }
.x { background: none; border: 0; color: #98A0A8; cursor: pointer; font-size: 15px; line-height: 1; padding: 2px 4px; }
.spacer { flex: 1; }
@media (prefers-reduced-motion: reduce) { * { transition: none !important; animation: none !important; } }
```

- [ ] **Step 2: `panel.js`를 쓴다**

```js
import { formatDurationKo, formatClock, formatDateShort } from '../common/format.js';
import { totalDuration } from '../common/queue.js';

const HOST_ID = 'chzzk-addons-panel-host';

// 치지직 리렌더 트리 밖에 붙인다. documentElement 직하에 두면 React가
// body 아래를 갈아치워도 패널이 살아남는다. Shadow DOM은 CSS를 양방향 격리한다.
function createHost() {
  const existing = document.getElementById(HOST_ID);
  if (existing) return existing;
  const host = document.createElement('div');
  host.id = HOST_ID;
  document.documentElement.appendChild(host);
  return host;
}

async function loadCss() {
  const url = chrome.runtime.getURL('src/panel/panel.css');
  const res = await fetch(url);
  return res.text();
}

export async function mountPanel({ onIntent }) {
  const host = createHost();
  const root = host.shadowRoot ?? host.attachShadow({ mode: 'open' });
  root.innerHTML = '';

  const style = document.createElement('style');
  style.textContent = await loadCss();
  root.appendChild(style);

  const panel = document.createElement('div');
  panel.className = 'panel';
  panel.hidden = true;
  panel.innerHTML = `
    <div class="head">
      <div class="row1">
        <span class="name">지금 보는 큐</span>
        <button class="x" id="ca-close" aria-label="닫기">✕</button>
      </div>
      <div class="stat" id="ca-stat"></div>
      <div class="prog"><i id="ca-prog" style="width:0%"></i></div>
    </div>
    <div class="status" id="ca-status" hidden></div>
    <div class="rows" id="ca-rows"></div>
    <div class="foot">
      <button class="btn primary" id="ca-resume">이어서 재생</button>
      <button class="btn" id="ca-reverse">순서 뒤집기</button>
      <span class="spacer"></span>
      <button class="btn" id="ca-clear">비우기</button>
    </div>
  `;
  root.appendChild(panel);

  const $ = (id) => root.getElementById(id);
  const rows = $('ca-rows');

  $('ca-close').addEventListener('click', () => onIntent({ type: 'close' }));
  $('ca-resume').addEventListener('click', () => onIntent({ type: 'resume' }));
  $('ca-reverse').addEventListener('click', () => onIntent({ type: 'reverse' }));
  $('ca-clear').addEventListener('click', () => onIntent({ type: 'clear' }));

  rows.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-act]');
    if (btn) {
      const i = Number(btn.dataset.i);
      const act = btn.dataset.act;
      if (act === 'up') onIntent({ type: 'move', from: i, to: i - 1 });
      else if (act === 'down') onIntent({ type: 'move', from: i, to: i + 1 });
      else if (act === 'remove') onIntent({ type: 'remove', videoNo: Number(btn.dataset.no) });
      return;
    }
    const meta = e.target.closest('.meta');
    if (meta) onIntent({ type: 'play', videoNo: Number(meta.dataset.no) });
  });

  let handle;

  function render(queue, status = { message: null, tone: 'info' }) {
    const items = queue.items;
    const doneCount = items.filter((i) => i.done).length;
    $('ca-stat').textContent = items.length
      ? `${items.length}개 · 총 ${formatDurationKo(totalDuration(items))} · ${doneCount}개 시청 완료`
      : '담긴 항목이 없습니다';
    $('ca-prog').style.width = items.length ? `${(doneCount / items.length) * 100}%` : '0%';

    const st = $('ca-status');
    st.hidden = !status.message;
    st.className = `status ${status.tone}`;
    st.textContent = status.message ?? '';

    $('ca-resume').disabled = items.length === 0;
    $('ca-reverse').disabled = items.length < 2;
    $('ca-clear').disabled = items.length === 0;

    if (items.length === 0) {
      rows.innerHTML = `<div class="empty">다시보기 목록에서 <b>전체 담기</b>를 누르면
        오래된 방송부터 순서대로 담깁니다.</div>`;
      return;
    }

    rows.innerHTML = '';
    items.forEach((it, i) => {
      const row = document.createElement('div');
      const cls = ['row'];
      if (i === queue.currentIndex) cls.push('now');
      if (it.done) cls.push('done');
      if (it.unavailable) cls.push('gone');
      row.className = cls.join(' ');
      row.draggable = true;
      row.dataset.i = String(i);

      const sub = it.unavailable
        ? '볼 수 없는 영상입니다'
        : it.done
          ? `${formatDateShort(it.publishedAt)} · 시청 완료`
          : it.progress > 0
            ? `${formatDateShort(it.publishedAt)} · ${formatClock(it.progress)} / ${formatClock(it.duration)}`
            : `${formatDateShort(it.publishedAt)} · ${formatDurationKo(it.duration)}`;

      const barPct = it.duration > 0 && !it.done ? Math.min(100, (it.progress / it.duration) * 100) : 0;

      row.innerHTML = `
        <span class="grip" aria-hidden="true">⠿</span>
        <span class="idx">${i + 1}</span>
        <span class="meta" data-no="${it.videoNo}" role="button" tabindex="0">
          <span class="t"></span>
          <span class="s">${sub}</span>
          ${barPct > 0 ? `<span class="bar"><i style="width:${barPct}%"></i></span>` : ''}
        </span>
        <span class="ctl">
          <button data-act="up" data-i="${i}" aria-label="위로">▲</button>
          <button data-act="down" data-i="${i}" aria-label="아래로">▼</button>
          <button data-act="remove" data-i="${i}" data-no="${it.videoNo}" aria-label="빼기">✕</button>
        </span>
      `;
      // 제목은 textContent로 넣는다. 방송 제목에 <> 같은 문자가 들어올 수 있다.
      row.querySelector('.t').textContent = it.title;
      rows.appendChild(row);
    });
  }

  // 드래그 정렬. 키보드로는 ▲▼ 버튼을 쓴다.
  let dragFrom = null;
  rows.addEventListener('dragstart', (e) => {
    const row = e.target.closest('.row');
    if (!row) return;
    dragFrom = Number(row.dataset.i);
    e.dataTransfer.effectAllowed = 'move';
  });
  rows.addEventListener('dragover', (e) => {
    const row = e.target.closest('.row');
    if (!row || dragFrom === null) return;
    e.preventDefault();
    for (const r of rows.querySelectorAll('.row.dragover')) r.classList.remove('dragover');
    row.classList.add('dragover');
  });
  rows.addEventListener('drop', (e) => {
    const row = e.target.closest('.row');
    if (!row || dragFrom === null) return;
    e.preventDefault();
    const to = Number(row.dataset.i);
    row.classList.remove('dragover');
    if (to !== dragFrom) onIntent({ type: 'move', from: dragFrom, to });
    dragFrom = null;
  });
  rows.addEventListener('dragend', () => {
    dragFrom = null;
    for (const r of rows.querySelectorAll('.row.dragover')) r.classList.remove('dragover');
  });

  handle = {
    render,
    setOpen(open) { panel.hidden = !open; },
    isOpen() { return !panel.hidden; },
    destroy() { host.remove(); }
  };
  return handle;
}
```

- [ ] **Step 3: `boot.js`에 패널을 마운트한다**

`src/content/boot.js`를 아래로 교체한다.

```js
import { detectPageType } from './route.js';
import { createStore } from '../common/store.js';
import { mountPanel } from '../panel/panel.js';
import {
  moveItem, removeItem, reverseOrder, clearQueue, createEmptyQueue
} from '../common/queue.js';

const VERSION = '0.1.0';

const store = createStore(chrome.storage.local);
let panel = null;
let queue = createEmptyQueue();
let status = { message: null, tone: 'info' };
let detachCurrent = null;
let lastPath = null;

function publishDebugState(pageType) {
  // 하니스가 주입·상태를 읽는 창구. DOM에 쓴다 - isolated world라
  // window에 심으면 page.evaluate에 보이지 않는다 (스펙 4.4절).
  document.documentElement.setAttribute('data-chzzk-addons', JSON.stringify({
    pageType, version: VERSION, queueLength: queue.items.length
  }));
}

function setStatus(message, tone = 'info') {
  status = { message, tone };
  panel?.render(queue, status);
}

async function commit(next) {
  queue = next;
  const ok = await store.saveQueue(queue);
  if (!ok) setStatus('저장하지 못했습니다. 잠시 후 다시 시도해 주세요.', 'error');
  else panel?.render(queue, status);
  publishDebugState(detectPageType(location.pathname));
}

async function onIntent(intent) {
  switch (intent.type) {
    case 'close':
      panel.setOpen(false);
      await store.saveUi({ panelOpen: false });
      break;
    case 'move':
      await commit(moveItem(queue, intent.from, intent.to));
      break;
    case 'remove':
      await commit(removeItem(queue, intent.videoNo));
      break;
    case 'reverse':
      await commit(reverseOrder(queue));
      break;
    case 'clear':
      await commit(clearQueue(queue));
      break;
    case 'play':
    case 'resume':
      // Task 10에서 실제 이동을 붙인다.
      break;
  }
}

async function attachFor(pageType) {
  if (detachCurrent) {
    detachCurrent();
    detachCurrent = null;
  }
  publishDebugState(pageType);
}

async function route() {
  const path = location.pathname;
  if (path === lastPath) return;
  lastPath = path;
  await attachFor(detectPageType(path));
}

function installRouteHooks() {
  for (const name of ['pushState', 'replaceState']) {
    const original = history[name];
    history[name] = function (...args) {
      const r = original.apply(this, args);
      route();
      return r;
    };
  }
  window.addEventListener('popstate', route);
}

export async function start() {
  const loaded = await store.loadQueue();
  queue = loaded.queue;

  panel = await mountPanel({ onIntent });
  const ui = await store.loadUi();
  panel.setOpen(ui.panelOpen);
  if (loaded.reset) {
    setStatus('저장된 재생목록을 읽을 수 없어 비웠습니다. 다시 담아 주세요.', 'error');
  } else {
    panel.render(queue, status);
  }

  // 다른 탭에서 큐가 바뀌어도 따라온다.
  store.subscribe((next) => {
    queue = next;
    panel?.render(queue, status);
  });

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg?.type !== 'chzzk-addons/toggle-panel') return;
    const open = !panel.isOpen();
    panel.setOpen(open);
    store.saveUi({ panelOpen: open });
  });

  installRouteHooks();
  await route();
}
```

- [ ] **Step 4: 하니스로 패널을 확인한다**

Run: `node tools/recon.js` (Task 6 Step 9와 같이 실제 확장을 로드하도록 임시 수정)
Expected: `#chzzk-addons-panel-host`가 `documentElement`의 자식으로 존재한다. `storage.local`에 `ui.panelOpen = true`를 심고 새로고침하면 패널이 보인다.

- [ ] **Step 5: 커밋**

```bash
git add src/panel/ src/content/boot.js
git commit -m "feat: T7 Shadow DOM 패널 렌더

documentElement 직하에 호스트를 붙인다. body 아래에 두면 치지직 React가
그 서브트리를 갈아치울 때 패널이 통째로 사라진다.

방송 제목은 textContent로 넣는다. innerHTML로 넣으면 제목에 든 <> 문자가
마크업으로 해석된다.

보라색을 우리 색으로 쓴다. 치지직의 민트와 구별되어야 사용자가 무엇이
확장이 넣은 UI인지 알 수 있다."
```

---

### Task 8: 목록 페이지 — 툴바와 담기 버튼

**Files:**
- Create: `src/content/videos-page.js`
- Modify: `src/content/boot.js` (`attachFor`에서 부착)

**Interfaces:**
- Consumes: Task 0이 확정한 셀렉터, Task 4의 `fetchAllReplays`, Task 2의 `addItems`, Task 3의 `removeItem`
- Produces:
  - `attachVideosPage({channelId, getQueue, commit, setStatus, openPanel}) => detach`
  - 툴바 DOM id: `chzzk-addons-toolbar` (하니스 시나리오 1이 이 id를 찾는다)

- [ ] **Step 1: 구현**

`src/content/videos-page.js`:

```js
import { fetchAllReplays } from '../common/chzzk-api.js';
import { addItems, removeItem, totalDuration } from '../common/queue.js';
import { formatDurationKo } from '../common/format.js';

const TOOLBAR_ID = 'chzzk-addons-toolbar';
const BTN_CLASS = 'chzzk-addons-add';

// Task 0의 정찰 결과에 따라 확정한 기준점.
// 클래스명에 의존하지 않는다 - 치지직은 해시 클래스를 쓰므로 배포마다 바뀐다.
const CARD_LINK = 'a[href*="/video/"]';

function videoNoFromLink(a) {
  const m = a.getAttribute('href')?.match(/\/video\/(\d+)/);
  return m ? Number(m[1]) : null;
}

// 카드 경계는 링크에서 올라가며 찾는다. 썸네일과 제목을 모두 품는
// 가장 가까운 조상을 카드로 본다.
function cardOf(a) {
  return a.closest('li, article') ?? a.parentElement;
}

function injectStyleOnce() {
  if (document.getElementById('chzzk-addons-inline-style')) return;
  const s = document.createElement('style');
  s.id = 'chzzk-addons-inline-style';
  // 치지직 페이지에 직접 넣는 스타일이므로 접두사를 붙여 충돌을 피한다.
  s.textContent = `
    #${TOOLBAR_ID}{display:flex;flex-wrap:wrap;gap:8px;align-items:center;
      margin:12px 0;padding:10px 12px;border-radius:5px;
      background:rgba(142,128,255,.12);border:1px solid rgba(142,128,255,.42);
      font-family:'Malgun Gothic','Apple SD Gothic Neo',sans-serif;color:#F1F3F5}
    #${TOOLBAR_ID} .tag{font-size:10px;font-weight:700;letter-spacing:.1em;
      color:#8E80FF;border:1px solid rgba(142,128,255,.5);padding:2px 6px;border-radius:3px}
    #${TOOLBAR_ID} button{font:inherit;font-size:12px;font-weight:500;padding:6px 11px;
      border-radius:4px;cursor:pointer;border:1px solid #383C42;background:#2A2D31;color:#F1F3F5}
    #${TOOLBAR_ID} button.primary{background:#5C4BD6;border-color:#8E80FF;color:#fff}
    #${TOOLBAR_ID} button:disabled{opacity:.45;cursor:default}
    #${TOOLBAR_ID} .count{font-size:11.5px;color:#98A0A8;margin-left:auto}
    .${BTN_CLASS}{position:absolute;left:5px;top:5px;z-index:5;
      font-family:'Malgun Gothic',sans-serif;font-size:10.5px;font-weight:600;
      padding:3px 7px;border-radius:3px;cursor:pointer;
      background:rgba(12,12,14,.86);color:#8E80FF;border:1px solid rgba(142,128,255,.55)}
    .${BTN_CLASS}.in{background:#5C4BD6;color:#fff}
  `;
  document.head.appendChild(s);
}

export function attachVideosPage({ channelId, getQueue, commit, setStatus, openPanel }) {
  injectStyleOnce();

  const toolbar = document.createElement('div');
  toolbar.id = TOOLBAR_ID;
  toolbar.innerHTML = `
    <span class="tag">재생목록</span>
    <button class="primary" data-act="add-all">전체 담기 · 오래된 순</button>
    <button data-act="open">재생목록 열기</button>
    <span class="count"></span>
  `;

  const countEl = toolbar.querySelector('.count');

  function refreshCount() {
    const q = getQueue();
    countEl.textContent = q.items.length
      ? `담은 항목 ${q.items.length}개 · ${formatDurationKo(totalDuration(q.items))}`
      : '담은 항목 없음';
  }

  // 툴바를 목록 위에 꽂는다. 첫 카드의 조상 중 여러 카드를 품은 것이 목록 컨테이너다.
  function mountToolbar() {
    const firstLink = document.querySelector(CARD_LINK);
    if (!firstLink) return false;
    const card = cardOf(firstLink);
    const container = card?.parentElement;
    if (!container) return false;
    container.parentElement.insertBefore(toolbar, container);
    return true;
  }

  function decorateCards() {
    for (const a of document.querySelectorAll(CARD_LINK)) {
      const no = videoNoFromLink(a);
      if (no === null) continue;
      const card = cardOf(a);
      if (!card || card.querySelector(`.${BTN_CLASS}`)) continue;
      if (getComputedStyle(card).position === 'static') card.style.position = 'relative';

      const btn = document.createElement('button');
      btn.className = BTN_CLASS;
      btn.dataset.no = String(no);
      card.appendChild(btn);
    }
    syncCardButtons();
  }

  function syncCardButtons() {
    const inQueue = new Set(getQueue().items.map((i) => i.videoNo));
    for (const btn of document.querySelectorAll(`.${BTN_CLASS}`)) {
      const no = Number(btn.dataset.no);
      const has = inQueue.has(no);
      btn.textContent = has ? '✓ 담김' : '＋ 담기';
      btn.classList.toggle('in', has);
    }
  }

  async function addAll() {
    const btn = toolbar.querySelector('[data-act="add-all"]');
    btn.disabled = true;
    btn.textContent = '담고 있습니다…';
    try {
      const { items, skipped, failedPages } = await fetchAllReplays(channelId);
      await commit(addItems(getQueue(), items));
      let msg = `${items.length}개를 오래된 순으로 담았습니다.`;
      if (skipped > 0) msg += ` ${skipped}개는 정보가 모자라 건너뛰었습니다.`;
      if (failedPages.length > 0) msg += ` ${failedPages.length}개 페이지를 받지 못했습니다. 다시 눌러 주세요.`;
      setStatus(msg, failedPages.length > 0 ? 'error' : 'info');
      openPanel();
    } catch (e) {
      setStatus('다시보기 목록을 가져오지 못했습니다. 잠시 후 다시 시도해 주세요.', 'error');
      console.warn('[chzzk-add-ons] 전체 담기 실패', e);
    } finally {
      btn.disabled = false;
      btn.textContent = '전체 담기 · 오래된 순';
      refreshCount();
      syncCardButtons();
    }
  }

  function onToolbarClick(e) {
    const act = e.target.closest('button')?.dataset.act;
    if (act === 'add-all') addAll();
    else if (act === 'open') openPanel();
  }

  async function onCardClick(e) {
    const btn = e.target.closest(`.${BTN_CLASS}`);
    if (!btn) return;
    // 카드 전체가 링크다. 담기 버튼을 눌렀을 때 영상으로 이동하면 안 된다.
    e.preventDefault();
    e.stopPropagation();
    const no = Number(btn.dataset.no);
    const q = getQueue();
    if (q.items.some((i) => i.videoNo === no)) {
      await commit(removeItem(q, no));
    } else {
      const a = document.querySelector(`${CARD_LINK}[href*="/video/${no}"]`);
      const card = a ? cardOf(a) : null;
      // 카드에서 긁을 수 있는 정보는 제목뿐이다. 나머지는 전체 담기가 채운다.
      const title = card?.querySelector('[class*="title"], h3, strong')?.textContent?.trim() ?? `영상 ${no}`;
      await commit(addItems(q, [{
        videoNo: no, title, channelId,
        publishedAt: '', duration: 0, thumb: ''
      }]));
      setStatus('개별로 담은 항목은 날짜 정보가 없어 맨 앞에 놓입니다. 전체 담기를 쓰면 순서가 맞습니다.', 'info');
    }
    refreshCount();
    syncCardButtons();
  }

  if (!mountToolbar()) {
    setStatus('다시보기 목록을 찾지 못해 담기 버튼을 넣지 못했습니다. 페이지를 새로고침해 주세요.', 'error');
  }
  decorateCards();
  refreshCount();

  // 치지직이 페이지를 더 그리면 새 카드에도 버튼을 붙인다.
  const mo = new MutationObserver(() => {
    if (!document.getElementById(TOOLBAR_ID)) mountToolbar();
    decorateCards();
  });
  mo.observe(document.body, { childList: true, subtree: true });

  toolbar.addEventListener('click', onToolbarClick);
  document.addEventListener('click', onCardClick, true);

  return function detach() {
    mo.disconnect();
    toolbar.removeEventListener('click', onToolbarClick);
    document.removeEventListener('click', onCardClick, true);
    toolbar.remove();
    for (const b of document.querySelectorAll(`.${BTN_CLASS}`)) b.remove();
  };
}
```

- [ ] **Step 2: `boot.js`의 `attachFor`를 채운다**

```js
import { attachVideosPage } from './videos-page.js';
import { parseChannelId } from './route.js';

async function attachFor(pageType) {
  if (detachCurrent) {
    detachCurrent();
    detachCurrent = null;
  }
  if (pageType === 'videos') {
    const channelId = parseChannelId(location.pathname);
    if (channelId) {
      detachCurrent = attachVideosPage({
        channelId,
        getQueue: () => queue,
        commit,
        setStatus,
        openPanel: async () => {
          panel.setOpen(true);
          await store.saveUi({ panelOpen: true });
        }
      });
    }
  }
  publishDebugState(pageType);
}
```

- [ ] **Step 3: 하니스로 확인한다**

Run: `node tools/recon.js`
Expected: 목록 페이지에 `#chzzk-addons-toolbar`가 있고 `.chzzk-addons-add` 버튼이 카드 수만큼 있다. "전체 담기"를 누르면 `storage.local.queue.items.length === 65`.

- [ ] **Step 4: 커밋**

```bash
git add src/content/videos-page.js src/content/boot.js
git commit -m "feat: T8 목록 페이지 툴바와 담기 버튼

카드를 클래스명으로 찾지 않는다. 치지직은 해시 클래스를 쓰므로 배포마다
바뀐다. a[href*=\"/video/\"]를 기준점으로 잡고 closest()로 경계를 올라간다.

담기 버튼 클릭에서 preventDefault와 stopPropagation을 모두 한다.
카드 전체가 링크라서 막지 않으면 영상으로 이동해 버린다.

툴바 부착에 실패하면 패널에 알린다. 전체 담기로 우회할 수 있으므로
기능이 죽지는 않지만 사용자는 왜 버튼이 없는지 알아야 한다."
```

---

### Task 9: 영상 페이지 — 진행 저장과 이어보기

**Files:**
- Create: `src/content/watch-page.js`
- Modify: `src/content/boot.js`

**Interfaces:**
- Consumes: Task 3의 `setCurrentByVideoNo`·`updateProgress`, Task 0이 확정한 플레이어 구조
- Produces:
  - `attachWatchPage({videoNo, getQueue, commit, setStatus}) => detach`
  - `waitForVideo(timeoutMs) => Promise<HTMLVideoElement|null>`
  - 디버깅 창구: `document.documentElement`의 `data-chzzk-addons-watch`(JSON) = `{videoNo, inQueue, hooked}`. **`window`에 쓰지 않는다** (스펙 4.4절)

- [ ] **Step 1: 구현**

`src/content/watch-page.js`:

```js
import { setCurrentByVideoNo, updateProgress } from '../common/queue.js';

const VIDEO_WAIT_MS = 15000;
const SAVE_INTERVAL_MS = 5000;
const RESUME_MIN_SEC = 10;

// 플레이어는 늦게 마운트된다. 없으면 기다린다.
export function waitForVideo(timeoutMs = VIDEO_WAIT_MS) {
  const found = document.querySelector('video');
  if (found) return Promise.resolve(found);
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      mo.disconnect();
      resolve(null);
    }, timeoutMs);
    const mo = new MutationObserver(() => {
      const v = document.querySelector('video');
      if (!v) return;
      clearTimeout(timer);
      mo.disconnect();
      resolve(v);
    });
    mo.observe(document.documentElement, { childList: true, subtree: true });
  });
}

export function attachWatchPage({ videoNo, getQueue, commit, setStatus }) {
  let video = null;
  let lastSaved = 0;
  let disposed = false;
  const cleanups = [];

  // 하니스가 읽는 창구. DOM에 쓴다 - isolated world라 window는 안 보인다.
  const watchState = { videoNo, inQueue: false, hooked: false };
  function publishWatchState(patch = {}) {
    Object.assign(watchState, patch);
    document.documentElement.setAttribute('data-chzzk-addons-watch', JSON.stringify(watchState));
  }
  publishWatchState();

  function inQueue() {
    return getQueue().items.some((i) => i.videoNo === videoNo);
  }

  async function flushProgress() {
    if (!video || disposed) return;
    const t = video.currentTime;
    await commit(updateProgress(getQueue(), videoNo, t, video.duration));
    lastSaved = t;
  }

  function onTimeUpdate() {
    if (!video) return;
    // 5초마다만 쓴다. timeupdate는 초당 4회 정도 오므로 매번 쓰면
    // storage 쓰기가 폭주한다.
    if (Math.abs(video.currentTime - lastSaved) < SAVE_INTERVAL_MS / 1000) return;
    flushProgress();
  }

  function restorePosition() {
    const item = getQueue().items.find((i) => i.videoNo === videoNo);
    if (!item || !video) return;
    const d = video.duration;
    if (!Number.isFinite(d) || d <= 0) return;
    // 끝에 거의 다 온 항목은 되돌리지 않는다. 바로 다음으로 넘어가야 한다.
    if (item.progress > RESUME_MIN_SEC && item.progress < d - RESUME_MIN_SEC) {
      video.currentTime = item.progress;
    }
  }

  (async () => {
    // 큐에 없는 영상이면 아무것도 하지 않는다. 일반 시청을 방해하지 않는다.
    if (!inQueue()) {
      publishWatchState({ inQueue: false, hooked: false });
      return;
    }
    publishWatchState({ inQueue: true });
    await commit(setCurrentByVideoNo(getQueue(), videoNo));

    video = await waitForVideo();
    if (!video || disposed) {
      setStatus('플레이어를 찾지 못해 자동 넘김을 쓸 수 없습니다. 재생목록은 그대로 쓸 수 있습니다.', 'error');
      return;
    }
    publishWatchState({ hooked: true });

    // MSE 스트리밍이라 loadedmetadata 전에는 currentTime 쓰기가 무시된다.
    if (video.readyState >= 1) restorePosition();
    else video.addEventListener('loadedmetadata', restorePosition, { once: true });

    video.addEventListener('timeupdate', onTimeUpdate);
    cleanups.push(() => video.removeEventListener('timeupdate', onTimeUpdate));

    // 탭을 숨기거나 떠날 때 마지막 위치를 흘려 넣는다.
    // 새로고침 중 마지막 5초를 잃지 않기 위한 것이다.
    const onHide = () => { if (document.visibilityState === 'hidden') flushProgress(); };
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('pagehide', flushProgress);
    cleanups.push(() => document.removeEventListener('visibilitychange', onHide));
    cleanups.push(() => window.removeEventListener('pagehide', flushProgress));
  })();

  return function detach() {
    disposed = true;
    for (const fn of cleanups) fn();
    cleanups.length = 0;
  };
}
```

- [ ] **Step 2: `boot.js`에 연결한다**

`attachFor`의 `pageType === 'watch'` 분기와 `play`/`resume` 의도를 채운다.

```js
import { attachWatchPage } from './watch-page.js';
import { parseVideoNo } from './route.js';

// attachFor 안에 추가
if (pageType === 'watch') {
  const videoNo = parseVideoNo(location.pathname);
  if (videoNo !== null) {
    detachCurrent = attachWatchPage({ videoNo, getQueue: () => queue, commit, setStatus });
  }
}

// onIntent의 play/resume 분기 교체
case 'play':
  location.assign(`/video/${intent.videoNo}`);
  break;
case 'resume': {
  const cur = queue.items[queue.currentIndex];
  if (cur) location.assign(`/video/${cur.videoNo}`);
  break;
}
```

- [ ] **Step 3: 하니스로 확인한다**

Run: `node tools/recon.js`
Expected: 큐에 심어 둔 영상 페이지에서 `window.__chzzkAddonsWatch.hooked === true`. `currentTime`을 300으로 밀고 6초 뒤 `storage.local.queue.items[i].progress`가 300 근처. 새로고침하면 그 위치에서 시작한다. 큐에 없는 영상에서는 `inQueue === false`이고 `hooked === false`.

- [ ] **Step 4: 커밋**

```bash
git add src/content/watch-page.js src/content/boot.js
git commit -m "feat: T9 진행 저장과 이어보기 복원

timeupdate는 초당 4회쯤 오므로 매번 저장하면 storage 쓰기가 폭주한다.
5초 간격으로 제한하고, visibilitychange와 pagehide에서 마지막 값을
흘려 넣어 새로고침 중 마지막 구간을 잃지 않게 했다.

MSE 스트리밍이라 loadedmetadata 전에는 currentTime 쓰기가 무시된다.
readyState를 보고 이미 준비됐으면 즉시, 아니면 이벤트를 기다린다.

끝에 거의 다 온 항목은 위치를 되돌리지 않는다. 되돌리면 종료 감지가
바로 다시 걸려 무한히 같은 지점을 맴돈다."
```

---

### Task 10: 영상 페이지 — 종료 감지와 다음 항목 전환

**Files:**
- Modify: `src/content/watch-page.js`
- Create: `src/content/upnext.js`

**Interfaces:**
- Consumes: Task 3의 `findNext`, Task 1의 `formatDurationKo`·`formatDateShort`
- Produces:
  - `showUpNext({item, seconds, onPlay, onCancel}) => {destroy()}` — 플레이어 위 카드
  - `hideUpNext()`
  - 카드 DOM id: `chzzk-addons-upnext` (하니스 시나리오 7이 찾는다)

- [ ] **Step 1: `upnext.js`를 쓴다**

```js
import { formatDurationKo, formatDateShort } from '../common/format.js';

const ID = 'chzzk-addons-upnext';

export function hideUpNext() {
  document.getElementById(ID)?.remove();
}

// 플레이어 위에 얹는다. video의 조상 중 position이 static이 아닌 것을
// 기준으로 삼고, 없으면 body에 붙여 화면 오른쪽 아래에 고정한다.
function anchorFor(video) {
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
  box.style.cssText = host
    ? 'position:absolute;right:16px;bottom:72px;z-index:50;'
    : 'position:fixed;right:16px;bottom:16px;z-index:2147483000;';
  box.style.cssText += `
    width:272px;max-width:calc(100vw - 32px);box-sizing:border-box;
    background:rgba(10,10,12,.93);border:1px solid #383C42;border-radius:5px;
    padding:11px;color:#F1F3F5;
    font-family:'Malgun Gothic','Apple SD Gothic Neo',sans-serif;`;
  box.innerHTML = `
    <div style="font-size:9.5px;letter-spacing:.13em;color:#8E80FF;font-weight:700">
      다음 항목 · <span data-sec>${seconds}</span>초 후
    </div>
    <div data-title style="font-size:12.5px;font-weight:600;margin-top:5px;line-height:1.35"></div>
    <div style="font-size:10.5px;color:#98A0A8;margin-top:2px">
      ${formatDateShort(item.publishedAt)} · ${formatDurationKo(item.duration)}
    </div>
    <div style="display:flex;gap:6px;margin-top:10px">
      <button data-act="play" style="font:inherit;font-size:12px;font-weight:500;padding:6px 11px;
        border-radius:4px;cursor:pointer;background:#5C4BD6;border:1px solid #8E80FF;color:#fff">바로 재생</button>
      <button data-act="cancel" style="font:inherit;font-size:12px;padding:6px 11px;border-radius:4px;
        cursor:pointer;background:#2A2D31;border:1px solid #383C42;color:#F1F3F5">취소</button>
    </div>`;
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
    clearInterval(timer);
    if (act === 'play') onPlay();
    else {
      hideUpNext();
      onCancel();
    }
  });

  return { destroy() { clearInterval(timer); hideUpNext(); } };
}
```

- [ ] **Step 2: `watch-page.js`에 종료 감지를 붙인다**

`attachWatchPage` 안에 추가한다.

```js
import { findNext } from '../common/queue.js';
import { showUpNext, hideUpNext } from './upnext.js';

const NEXT_LEAD_SEC = 10;
const COUNTDOWN_SEC = 8;
```

`onTimeUpdate`를 아래로 교체하고 상태 변수를 더한다.

```js
let upnext = null;
let cancelled = false;   // 사용자가 이번 영상에서 취소했는가
let advancing = false;   // 이미 넘어가는 중인가 - 중복 이동을 막는다

function goNext() {
  if (advancing) return;
  const next = findNext(getQueue());
  if (!next) {
    setStatus('재생목록을 끝까지 봤습니다. 순서를 바꾸거나 더 담아 보세요.', 'info');
    return;
  }
  advancing = true;
  flushProgress().finally(() => location.assign(`/video/${next.videoNo}`));
}

function maybeOfferNext() {
  if (!video || cancelled || advancing || upnext) return;
  const d = video.duration;
  if (!Number.isFinite(d) || d <= 0) return;
  if (d - video.currentTime > NEXT_LEAD_SEC) return;
  const next = findNext(getQueue());
  if (!next) {
    setStatus('재생목록을 끝까지 봤습니다. 순서를 바꾸거나 더 담아 보세요.', 'info');
    cancelled = true;   // 매 tick마다 문구를 다시 쓰지 않는다
    return;
  }
  upnext = showUpNext({
    video,
    item: next,
    seconds: COUNTDOWN_SEC,
    onPlay: goNext,
    onCancel: () => { cancelled = true; upnext = null; }
  });
}

function onTimeUpdate() {
  if (!video) return;
  if (Math.abs(video.currentTime - lastSaved) >= SAVE_INTERVAL_MS / 1000) flushProgress();
  maybeOfferNext();
}
```

`video` 훅 설정부에 `ended`를 보조로 더한다.

```js
// ended는 광고나 중간 삽입에서 오지 않는 경우가 있어 보조로만 쓴다.
// timeupdate가 이미 10초 전에 카드를 띄웠을 것이다.
const onEnded = () => { if (!cancelled && !advancing) goNext(); };
video.addEventListener('ended', onEnded);
cleanups.push(() => video.removeEventListener('ended', onEnded));
```

`detach`에 정리를 더한다.

```js
upnext?.destroy();
hideUpNext();
```

- [ ] **Step 3: 하니스로 확인한다**

Run: `node tools/recon.js`
Expected: 큐 항목 영상에서 `video.currentTime = video.duration - 5`로 밀면 3초 안에 `#chzzk-addons-upnext`가 나타난다. 8초 더 기다리면 URL이 다음 항목의 `videoNo`로 바뀐다.

- [ ] **Step 4: 커밋**

```bash
git add src/content/upnext.js src/content/watch-page.js
git commit -m "feat: T10 종료 감지와 다음 항목 전환

종료 10초 전에 timeupdate로 개입한다. 치지직 자체 자동재생보다 먼저
잡아야 우리 순서가 이긴다. ended는 광고나 중간 삽입에서 오지 않는
경우가 있어 보조로만 듣는다.

advancing 플래그로 중복 이동을 막는다. timeupdate와 ended가 함께
걸리면 location.assign이 두 번 호출된다.

마지막 항목에서는 전환하지 않고 문구만 띄운다. cancelled를 세워
매 tick마다 같은 문구를 다시 쓰지 않게 했다."
```

---

### Task 11: 검증 하니스 완성

**Files:**
- Create: `tools/harness.js`
- Delete: `tools/recon.js` (역할을 하니스가 흡수한다)
- Delete: `tools/fixtures/smoke-ext/`

**Interfaces:**
- Consumes: 지금까지의 모든 DOM id — `chzzk-addons-toolbar`, `chzzk-addons-panel-host`, `chzzk-addons-upnext`, 그리고 `documentElement`의 `data-chzzk-addons` / `data-chzzk-addons-watch`
- Produces: `tools/out/result.json` — `[{scenario, name, passed, ms, error, screenshot}]`

> **주의 — 아래 시나리오 본문은 T0 발견 이후 고쳐 써야 한다.**
> 원래 계획은 `page.evaluate(() => chrome.storage...)`와
> `page.waitForFunction(async () => chrome.storage...)`로 큐를 읽었다.
> **main world에는 `chrome.storage`가 없어 전부 동작하지 않는다** (스펙 4.4절).
> 고칠 점 세 가지:
> 1. `readQueue`/`writeQueue`/`setPanelOpen`은 `page`가 아니라 `browser`를 받는다 (위 헬퍼).
> 2. 큐 변화를 기다릴 때 `page.waitForFunction` 대신 `readQueue(browser)`를
>    폴링하는 헬퍼(`waitFor(fn, ms)`)를 쓴다.
> 3. `window.__chzzkAddons*` 확인은 `debugState(page)` / `watchState(page)`로 바꾼다.
>
> 아래 본문의 DOM 셀렉터·판정 조건·타임아웃은 그대로 유효하다.

- [ ] **Step 1: 하니스를 쓴다**

`tools/harness.js`:

```js
// 스펙 9.2절 시나리오를 실행한다.
// CLI: node tools/harness.js [--scenario N] [--headful]
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

import { resolveChrome, extensionArgs } from './chrome-path.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const PROFILE = resolve(HERE, '.profile');
const OUT = resolve(HERE, 'out');

const CHANNEL = '0f9a3b4fbb0e7137d1f0b4d70563031c';
const VIDEOS_URL = `https://chzzk.naver.com/${CHANNEL}/videos?videoType=REPLAY`;

const SCENARIO_TIMEOUT_MS = 60000;
const TOTAL_TIMEOUT_MS = 10 * 60 * 1000;

const args = process.argv.slice(2);
const only = args.includes('--scenario') ? Number(args[args.indexOf('--scenario') + 1]) : null;

// 설치된 정식판은 커맨드라인 확장 로드를 차단한다 (스펙 4.4절).
// Chrome for Testing + headful 조합만 동작한다. T0에서 확인했다.
async function launch() {
  const chrome = resolveChrome();
  console.log(`브라우저: ${chrome.kind}`);
  return puppeteer.launch({
    executablePath: chrome.path,
    userDataDir: PROFILE,
    headless: false,
    args: extensionArgs(ROOT)
  });
}

// main world에는 chrome.storage가 없고, content script의 isolated world에는
// puppeteer가 들어갈 수 없다. 그래서 확장의 service worker 타깃에서 읽고 쓴다.
// service worker는 유휴 시 죽으므로 매번 다시 확보한다 (스펙 4.4절).
async function sw(browser) {
  const match = (t) => t.type() === 'service_worker' && t.url().startsWith('chrome-extension://');
  const target = (await browser.targets()).find(match)
    ?? await browser.waitForTarget(match, { timeout: 15000 });
  const worker = await target.worker();
  if (!worker) throw new Error('service worker 핸들을 얻지 못했다');
  return worker;
}

async function readQueue(browser) {
  const w = await sw(browser);
  return w.evaluate(async () => (await chrome.storage.local.get('queue')).queue ?? null);
}
async function writeQueue(browser, queue) {
  const w = await sw(browser);
  await w.evaluate(async (q) => chrome.storage.local.set({ queue: q }), queue);
}
async function setPanelOpen(browser, open) {
  const w = await sw(browser);
  await w.evaluate(async (o) => chrome.storage.local.set({ ui: { panelOpen: o } }), open);
}

// 페이지에서 확장 상태를 읽는다. DOM 속성이므로 main world에서 보인다.
async function debugState(page) {
  return page.evaluate(() => {
    const raw = document.documentElement.getAttribute('data-chzzk-addons');
    return raw ? JSON.parse(raw) : null;
  });
}
async function watchState(page) {
  return page.evaluate(() => {
    const raw = document.documentElement.getAttribute('data-chzzk-addons-watch');
    return raw ? JSON.parse(raw) : null;
  });
}

function seededQueue(items) {
  return { version: 1, items, currentIndex: 0 };
}

async function gotoVideos(page) {
  await page.goto(VIDEOS_URL, { waitUntil: 'networkidle2', timeout: 45000 });
  await page.waitForFunction(() => window.__chzzkAddons?.pageType === 'videos', { timeout: 20000 });
}

const scenarios = [
  {
    n: 1,
    name: '목록 페이지에 툴바·카드 버튼 주입',
    async run(page) {
      await gotoVideos(page);
      await page.waitForSelector('#chzzk-addons-toolbar', { timeout: 15000 });
      const count = await page.$$eval('.chzzk-addons-add', (els) => els.length);
      if (count === 0) throw new Error('담기 버튼이 하나도 붙지 않았다');
    }
  },
  {
    n: 2,
    name: '전체 담기 → 큐가 오래된 순으로 채워짐',
    async run(page) {
      await writeQueue(page, { version: 1, items: [], currentIndex: -1 });
      await gotoVideos(page);
      await page.waitForSelector('#chzzk-addons-toolbar [data-act="add-all"]', { timeout: 15000 });
      await page.click('#chzzk-addons-toolbar [data-act="add-all"]');
      await page.waitForFunction(
        async () => ((await chrome.storage.local.get('queue')).queue?.items?.length ?? 0) > 50,
        { timeout: 40000 }
      );
      const q = await readQueue(page);
      const dates = q.items.map((i) => i.publishedAt);
      const sorted = [...dates].sort();
      if (JSON.stringify(dates) !== JSON.stringify(sorted)) throw new Error('오래된 순이 아니다');
      if (q.items.length < 60) throw new Error(`담긴 수가 적다: ${q.items.length}`);
    }
  },
  {
    n: 3,
    name: '패널 열림 + 순서 변경 저장',
    async run(page) {
      await gotoVideos(page);
      await setPanelOpen(page, true);
      await page.reload({ waitUntil: 'networkidle2' });
      await page.waitForFunction(
        () => !!document.getElementById('chzzk-addons-panel-host')?.shadowRoot?.querySelector('.row'),
        { timeout: 20000 }
      );
      const before = (await readQueue(page)).items.map((i) => i.videoNo);
      await page.evaluate(() => {
        const root = document.getElementById('chzzk-addons-panel-host').shadowRoot;
        root.querySelectorAll('.row')[1].querySelector('button[data-act="up"]').click();
      });
      await page.waitForFunction(
        async (first) => (await chrome.storage.local.get('queue')).queue.items[0].videoNo !== first,
        { timeout: 10000 }, before[0]
      );
      const after = (await readQueue(page)).items.map((i) => i.videoNo);
      if (after[0] !== before[1]) throw new Error('순서 변경이 저장되지 않았다');
    }
  },
  {
    n: 4,
    name: '새로고침 후 큐·패널 상태 복원',
    async run(page) {
      await gotoVideos(page);
      await setPanelOpen(page, true);
      const before = (await readQueue(page)).items.length;
      await page.reload({ waitUntil: 'networkidle2' });
      await page.waitForFunction(
        () => document.getElementById('chzzk-addons-panel-host')?.shadowRoot
          ?.querySelector('.panel')?.hidden === false,
        { timeout: 20000 }
      );
      const after = (await readQueue(page)).items.length;
      if (after !== before) throw new Error(`큐 길이가 달라졌다: ${before} → ${after}`);
    }
  },
  {
    n: 5,
    name: 'SPA 내부 이동 후 패널 생존 (D1 핵심 가정)',
    async run(page) {
      await gotoVideos(page);
      await setPanelOpen(page, true);
      await page.reload({ waitUntil: 'networkidle2' });
      await page.waitForSelector('#chzzk-addons-panel-host', { timeout: 20000 });
      // 목록의 첫 영상 링크를 클릭해 SPA 이동을 유발한다.
      await page.evaluate(() => document.querySelector('a[href*="/video/"]').click());
      await page.waitForFunction(() => location.pathname.startsWith('/video/'), { timeout: 20000 });
      const alive = await page.evaluate(
        () => !!document.getElementById('chzzk-addons-panel-host')?.shadowRoot?.querySelector('.panel')
      );
      if (!alive) throw new Error('SPA 이동 후 패널이 사라졌다');
      const t = await page.evaluate(() => window.__chzzkAddons?.pageType);
      if (t !== 'watch') throw new Error(`라우팅 감지 실패: ${t}`);
    }
  },
  {
    n: 6,
    name: 'currentTime 쓰기로 seek 동작',
    async run(page) {
      const q = await readQueue(page);
      const target = q.items.find((i) => i.duration > 600) ?? q.items[0];
      await page.goto(`https://chzzk.naver.com/video/${target.videoNo}`, { waitUntil: 'networkidle2', timeout: 45000 });
      await page.waitForSelector('video', { timeout: 30000 });
      const r = await page.evaluate(async () => {
        const v = document.querySelector('video');
        if (v.readyState < 1) await new Promise((res) => v.addEventListener('loadedmetadata', res, { once: true }));
        const before = v.currentTime;
        v.currentTime = before + 120;
        await new Promise((res) => setTimeout(res, 2000));
        return { before, after: v.currentTime };
      });
      if (Math.abs(r.after - (r.before + 120)) > 10) throw new Error(`seek 실패: ${JSON.stringify(r)}`);
    }
  },
  {
    n: 7,
    name: '종료 10초 전 다음 항목 카드 + 전환',
    async run(page) {
      const q = await readQueue(page);
      const [a, b] = q.items;
      await writeQueue(page, seededQueue([a, b]));
      await page.goto(`https://chzzk.naver.com/video/${a.videoNo}`, { waitUntil: 'networkidle2', timeout: 45000 });
      await page.waitForFunction(() => window.__chzzkAddonsWatch?.hooked === true, { timeout: 30000 });
      // 12시간 영상을 기다릴 수 없으므로 끝 근처로 밀어 종료를 유발한다.
      await page.evaluate(() => {
        const v = document.querySelector('video');
        v.currentTime = v.duration - 5;
      });
      await page.waitForSelector('#chzzk-addons-upnext', { timeout: 20000 });
      await page.waitForFunction(
        (next) => location.pathname === `/video/${next}`,
        { timeout: 25000 }, b.videoNo
      );
    }
  },
  {
    n: 8,
    name: '이어보기: seek → 새로고침 → 위치 복원',
    async run(page) {
      const q = await readQueue(page);
      const target = q.items.find((i) => i.duration > 900) ?? q.items[0];
      await writeQueue(page, seededQueue([{ ...target, progress: 0, done: false }]));
      await page.goto(`https://chzzk.naver.com/video/${target.videoNo}`, { waitUntil: 'networkidle2', timeout: 45000 });
      await page.waitForFunction(() => window.__chzzkAddonsWatch?.hooked === true, { timeout: 30000 });
      await page.evaluate(() => { document.querySelector('video').currentTime = 300; });
      await page.waitForFunction(
        async () => ((await chrome.storage.local.get('queue')).queue.items[0].progress ?? 0) > 250,
        { timeout: 20000 }
      );
      await page.reload({ waitUntil: 'networkidle2' });
      await page.waitForFunction(() => window.__chzzkAddonsWatch?.hooked === true, { timeout: 30000 });
      const pos = await page.waitForFunction(
        () => {
          const v = document.querySelector('video');
          return v && v.currentTime > 250 ? v.currentTime : false;
        },
        { timeout: 25000 }
      ).then((h) => h.jsonValue());
      if (!(pos > 250)) throw new Error(`복원 실패: ${pos}`);
    }
  }
];

function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, rej) => setTimeout(() => rej(new Error(`타임아웃 ${ms}ms: ${label}`)), ms))
  ]);
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const list = only ? scenarios.filter((s) => s.n === only) : scenarios;
  const results = [];
  const browser = await launch();
  const deadline = Date.now() + TOTAL_TIMEOUT_MS;

  try {
    for (const s of list) {
      if (Date.now() > deadline) {
        results.push({ scenario: s.n, name: s.name, passed: false, ms: 0, error: '전체 타임아웃' });
        continue;
      }
      const page = await browser.newPage();
      const logs = [];
      page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
      const t0 = Date.now();
      let passed = true;
      let error = null;
      let shot = null;
      try {
        await withTimeout(s.run(page), SCENARIO_TIMEOUT_MS, `시나리오 ${s.n}`);
      } catch (e) {
        passed = false;
        error = e.message;
        shot = resolve(OUT, `fail-${s.n}.png`);
        await page.screenshot({ path: shot }).catch(() => { shot = null; });
        writeFileSync(resolve(OUT, `fail-${s.n}.log`), logs.join('\n'), 'utf8');
      }
      results.push({ scenario: s.n, name: s.name, passed, ms: Date.now() - t0, error, screenshot: shot });
      console.log(`${passed ? 'PASS' : 'FAIL'} ${s.n} ${s.name}${error ? ` — ${error}` : ''}`);
      await page.close().catch(() => {});
    }
  } finally {
    // 사용자의 Chrome을 이름으로 죽이지 않기 위해, 우리가 띄운 것만 닫는다.
    await browser.close().catch(() => {});
  }

  writeFileSync(resolve(OUT, 'result.json'), JSON.stringify(results, null, 2), 'utf8');
  const failed = results.filter((r) => !r.passed);
  console.log(`\n${results.length - failed.length}/${results.length} 통과`);
  process.exit(failed.length > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error('HARNESS FAILED:', e);
  process.exit(1);
});
```

- [ ] **Step 2: 정찰 도구를 치운다**

```bash
git rm -r tools/recon.js tools/fixtures/smoke-ext
```

- [ ] **Step 3: 전체 실행**

Run: `node tools/harness.js`
Expected: `8/8 통과`. 실패한 시나리오는 `tools/out/fail-N.png`와 `fail-N.log`를 보고 원인을 찾는다. 추측으로 고치지 않는다.

- [ ] **Step 4: 결과를 진행 기록에 옮긴다**

`tools/out/result.json`을 읽어 `docs/progress.md`의 하니스 시나리오 표를 채운다. 확인 시각과 `git rev-parse --short HEAD`의 값을 함께 적는다.

- [ ] **Step 5: 커밋**

```bash
git add tools/ docs/progress.md
git commit -m "test: T11 검증 하니스 완성

시나리오별 하드 타임아웃을 둔다. 멈춘 채로 세션을 태우는 것이 최악의
실패 방식이다. --scenario N으로 하나만 돌릴 수 있게 해 하나 고치려고
여덟 개를 다 돌리지 않는다.

결과를 result.json에 기계가 읽을 형태로 쓴다. 로그를 눈으로 훑어
통과를 판단하면 근거 없는 기록이 남는다.

실제 API를 쓰는 시나리오는 2번 하나뿐이다. 나머지는 storage에 큐를
직접 심어 시작한다 - 비공식 API를 반복해서 때리지 않기 위한 것이다."
```

---

### Task 12: 문서와 머지

**Files:**
- Modify: `README.md`
- Create: `docs/manual-test.md`
- Modify: `docs/progress.md`

- [ ] **Step 1: `README.md`에 설치·사용법을 쓴다**

```markdown
# chzzk-add-ons

치지직(CHZZK)을 크롬에서 시청할 때 부족한 기능을 채워 넣는 크롬 확장 프로그램.

## 다시보기 재생목록

치지직은 다시보기 목록은 제공하지만 재생목록이 없다. 정렬은 최신순과
인기순 둘뿐이고, 연속재생은 최신에서 과거로 거슬러 가는 방향으로만 흐른다.
그래서 한동안 보지 못해 쌓인 방송을 몰아보면 이야기가 거꾸로 흐른다.

이 확장은 다시보기를 담아 **원하는 순서로 이어보게** 한다.

- **전체 담기** — 채널의 모든 다시보기를 오래된 순으로 한 번에 담는다.
  같은 날 여러 조각으로 나뉜 방송도 시각 순서로 정렬된다.
- **순서 바꾸기** — 패널에서 끌어 옮기거나 ▲▼ 버튼을 쓴다.
- **연속 재생** — 영상이 끝나면 목록의 다음 항목으로 넘어간다.
- **이어보기** — 항목마다 어디까지 봤는지 기억한다. 새로고침해도 유지된다.

## 설치

빌드가 필요 없다. 저장소를 내려받아 그대로 로드한다.

1. `git clone https://github.com/Yoonkyu-Lee/chzzk-add-ons.git`
2. 크롬에서 `chrome://extensions` 열기
3. 오른쪽 위 **개발자 모드** 켜기
4. **압축해제된 확장 프로그램을 로드합니다** 누르고 내려받은 폴더 선택

## 사용법

1. 스트리머의 다시보기 목록 페이지로 간다
   (`chzzk.naver.com/{채널}/videos`)
2. 목록 위에 생긴 **전체 담기 · 오래된 순**을 누른다
3. 오른쪽 패널에서 순서를 확인하고 **이어서 재생**을 누른다
4. 영상이 끝나면 다음 항목으로 넘어간다. 끝나기 10초 전에 카드가 떠서
   바로 넘기거나 취소할 수 있다

패널은 확장 아이콘을 눌러 열고 닫는다.

## 개발

- 단위 테스트: `npm test`
- 통합 검증: `npm run harness` (또는 `node tools/harness.js --scenario 5`)
- 설계 문서: `docs/superpowers/specs/`
- 작업 규칙: `CLAUDE.md`

## 한계

치지직의 비공식 API와 페이지 구조에 의존한다. 사이트가 개편되면 동작하지
않을 수 있다. 그런 경우 패널에 무엇이 실패했는지 표시된다.
```

- [ ] **Step 2: `docs/manual-test.md`를 쓴다**

```markdown
# 수동 확인 시나리오

하니스로 자동화하기 어려운 것만 여기 남긴다.
`node tools/harness.js`가 다루는 8개 시나리오는 스펙 9.2절에 있다.

## M1. 실제 장시간 연속재생

하니스는 `currentTime`을 끝으로 밀어 전환을 유발한다. 실제 재생과
다를 여지가 남는다.

1. 짧은 다시보기 두 개(각 5분 이하)를 담는다
2. 첫 항목을 끝까지 실제로 재생한다
3. 확인: 10초 전 카드가 뜨는가, 8초 뒤 다음 항목으로 넘어가는가,
   치지직 자체 자동재생이 먼저 다른 영상으로 끌고 가지 않는가

## M2. 치지직 자동재생과의 경쟁

1. 치지직 플레이어 설정에서 자동재생을 **켜 둔다**
2. M1을 반복한다
3. 확인: 우리 순서가 이기는가. 지면 패널에 안내 문구가 필요하다

## M3. 로그인 필요 영상

하니스 프로필에는 로그인이 없다.

1. 로그인한 크롬에서 구독자 전용 다시보기를 큐에 담는다
2. 확인: 재생되는가. 안 되면 `unavailable`로 표시되고 다음으로 넘어가는가

## M4. 성인 인증 영상

1. 성인 인증이 필요한 다시보기를 큐에 담는다
2. 확인: 큐가 멈추지 않고 다음으로 넘어가는가

## M5. 삭제된 영상

1. 큐에 담은 뒤 스트리머가 삭제한 영상이 있을 때
2. 확인: `unavailable` 표시 후 다음으로 진행하는가

## M6. 여러 탭 동시 사용

1. 목록 페이지와 영상 페이지를 각각 다른 탭에서 연다
2. 목록 탭에서 순서를 바꾼다
3. 확인: 영상 탭의 패널에도 반영되는가

## M7. 장시간 방치

1. 큐를 담고 12시간 뒤에 다시 연다
2. 확인: MV3 service worker가 죽은 뒤에도 패널과 큐가 정상인가
   (service worker에 상태를 두지 않았으므로 문제없어야 한다)
```

- [ ] **Step 3: 완료 기준을 확인한다**

스펙 10장의 8개 조건을 하나씩 확인하고 `docs/progress.md`의 표를 채운다.
**원문 출력을 근거로만 채운다.** 만족하지 못한 항목이 있으면 끝났다고
표시하지 않고 무엇이 왜 남았는지 적는다.

- [ ] **Step 4: 커밋하고 머지한다**

```bash
git add README.md docs/
git commit -m "docs: T12 설치·사용법과 수동 확인 시나리오

하니스가 currentTime을 밀어 전환을 유발하므로 실제 장시간 재생과
다를 여지가 남는다. 그 간극과 로그인·성인인증처럼 자동화할 수 없는
경로를 수동 시나리오로 남겼다."

git checkout main
git merge --no-ff feat/replay-playlist -m "feat: 다시보기 재생목록 v1

치지직에 없는 재생목록을 확장으로 채웠다. 채널 전체를 오래된 순으로
담고, 순서를 바꾸고, 끝나면 다음으로 넘어가고, 어디까지 봤는지 기억한다.

스펙 10장의 완료 기준을 만족한 상태에서 머지한다."
git push origin main
```

---

## Self-Review

**1. 스펙 커버리지**

| 스펙 | 담당 |
|---|---|
| 2장 목표 1 (담기) | T8 |
| 2장 목표 2 (순서 바꾸기) | T3, T7 |
| 2장 목표 3 (연속 재생) | T10 |
| 2장 목표 4 (이어보기) | T9 |
| 3장 D1 Shadow DOM 패널 | T7 |
| 3장 D2 API 직접 호출 | T4 |
| 3장 D3 오래된 순 기본 | T2 |
| 3장 D4 storage.local | T5 |
| 3장 D5 timeupdate 종료 감지 | T10 |
| 3장 D6 큐 하나 | T5 (키 하나), T7 (이름 고정) |
| 3장 D7 빌드 없음 | T0 (package.json), T6 (manifest) |
| 4.3 미확인 항목 | T0 |
| 5장 파일 구조·모듈 경계 | 전체 |
| 6장 데이터 모델 | T2, T5 |
| 7.1 담기 | T8 |
| 7.2 패널 | T7 |
| 7.3 연속 재생 1~9 | T9 (1~4, 6), T10 (5, 7, 8, 9) |
| 7.4 라우팅 감지 | T6 |
| 8장 에러 표 8행 | API 실패·스키마 T8, 셀렉터 T8, video 못 찾음 T9, unavailable T3+M5, 버전 불일치 T5+T7, 쓰기 실패 T5+T7 |
| 9.1 단위 테스트 | T1~T5 |
| 9.2 하니스 + 요구사항 | T11 |
| 9.3 수동 확인 | T12 |
| 10장 완료 기준 | T12 Step 3 |

빈 칸 없음.

**2. 플레이스홀더 점검**

"TBD", "적절히 처리", "테스트를 쓴다"(코드 없이) 없음. 모든 코드 단계에
실제 코드가 있다. T0 Step 7의 대안 4개는 "막히면 무엇을 하라"를 구체적으로
적은 것이므로 플레이스홀더가 아니다.

**3. 타입 일관성 점검**

- `Item` 필드명이 T2(`withDefaults`), T4(`normalizeVideo`), T7(패널 렌더)에서 동일하다:
  `videoNo/title/channelId/channelName/publishedAt/duration/thumb/progress/done/unavailable`
- `Queue` = `{version, items, currentIndex}`가 T2·T3·T5·T11에서 동일하다
- `store.loadQueue()`는 `{queue, reset}`을 반환하고 T7 `start()`가 그 형태로 받는다
- `saveQueue`는 boolean을 반환하고 T7 `commit`이 그것으로 판단한다
- `onIntent` 타입 7개가 T7(발신)과 T7·T9(수신)에서 일치한다
- `setStatus(message, tone)` 시그니처가 T7·T8·T9·T10에서 동일하다
- `findNext(queue) => Item | null`이 T3(정의)과 T10(사용)에서 일치한다
- 하니스가 찾는 DOM id 3개가 각 구현 파일의 상수와 일치한다:
  `chzzk-addons-toolbar`(T8), `chzzk-addons-panel-host`(T7), `chzzk-addons-upnext`(T10)
- 하니스가 읽는 전역 2개가 정의와 일치한다: `__chzzkAddons`(T6), `__chzzkAddonsWatch`(T9)

불일치 없음.
