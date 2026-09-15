# 진행 기록

**이 파일이 유일하게 믿을 수 있는 현재 상태다.** 대화 컨텍스트는 요약되거나
사라질 수 있다. 여기 적히지 않은 것은 없었던 일로 취급한다.

갱신 규칙은 `CLAUDE.md`의 "세션 재개 절차"와 "기록 규칙"에 있다.

---

## 지금 하는 일

> 항상 한 줄. 재개하는 세션이 가장 먼저 읽는 줄이다.

v1 완료. 단위 95/95 + 하니스 11/11 @ e2d6b78. 완료 기준 8개 전부 충족. 남은 것은 docs/manual-test.md의 수동 확인 10건.

## 조사 중인 문제

> 디버깅에 들어가면 여기에 증상·시도·가설을 적는다. 이걸 적지 않고 세션이
> 끊기면 다음 세션이 같은 시도를 반복한다. 해결되면 "없음"으로 되돌리고
> 알게 된 사실은 스펙이나 아래 "환경 사실"로 옮긴다.

없음

### 해결된 문제 기록 3

#### P3 — 전환은 되는데 완료로 찍히지 않고, 검증이 매번 다르게 실패한다 → **해결 (2026-09-15)**

세 가지가 겹쳐 있었다. 하나씩 분리해야 했다.

**원인 A: 플레이어가 끝에서 처음으로 되돌린다 (제품 결함)**

카운트다운을 초 단위로 관측한 결과 `currentTime`이 `3578 → 1`로 튀고 다시
증가했다 (`ended: false`). 즉 치지직 플레이어는 영상이 끝나면 **다음으로
넘기는 것이 아니라 같은 영상을 처음부터 다시 재생한다.**

그 상태의 `currentTime`을 저장하면 다 본 항목의 진행이 1초로 덮인다.
게다가 `location.assign`이 `pagehide`를 발생시키고 그 핸들러의
`flushProgress`가 바로 이 값을 쓴다. 그래서 방금 완료로 찍은 항목이
`progress: 13, done: false`로 되돌아갔다.

→ `flushProgress`에 `if (advancing) return`을 넣고, 완료 판정은 종료 시점의
`currentTime`을 다시 읽지 않고 `lastGoodDuration`으로 확정한다.

**원인 B: 감지 창이 1초도 안 될 수 있다 (검증 문제)**

끝으로 seek한 뒤 플레이어가 곧 되돌리므로 `timeupdate` 한 번을 놓치면
카드가 뜨지 않는다. → 프로브가 카드가 뜰 때까지 반복해서 민다.

**원인 C: DRM 메타데이터 로딩이 비결정적이다 (환경 제약)**

같은 명령을 연달아 돌려도 `readyState`가 4까지 가기도 하고 0에 머물기도 한다.
확장의 개입 때문이 아니다 — 큐가 비었을 때도 실패했고 훅이 걸렸을 때도
성공했다 (`tools/probe-drm.js`, `--seed`로 양쪽 확인).
headless에서는 **항상** 실패한다.

→ `tools/watch-session.js`의 `withReadyWatchPage`가 브라우저 세션을 갈아
끼우며 최대 3회 재시도한다. 메타데이터가 확보된 시도에서만 본문을 실행한다.

**잘못 짚었던 가설들** (다시 시도하지 말 것)

| 가설 | 반증 |
|---|---|
| `page.reload()`가 DRM을 깨뜨린다 | `goto`로 바꿔도 같았다 |
| 세션의 두 번째 영상 페이지부터 깨진다 | 첫 로드에서도 실패했다 |
| 목록 페이지를 먼저 열면 DRM을 소모한다 | 목록을 안 열어도 실패했다 |
| 확장의 훅이 DRM 로딩을 막는다 | 큐를 심은 쪽이 오히려 성공했다 |

**확인된 결과**
카드 등장(`.pzp` 앵커) → 8초 카운트다운 → `/video/15204257`로 전환 →
A가 `done: true, progress: 3582` → `currentIndex`가 B(1)로 이동.
마지막 항목에서는 전환하지 않고 문구만 띄운다 (`stillOnLast: true`, `noCard: true`).

### 해결된 문제 기록 2

#### P2 — 목록 페이지에 툴바가 붙지 않고 렌더러가 멈춘다 → **해결 (2026-09-15)**

**증상**
`tools/probe-videos.js`가 `#chzzk-addons-toolbar`를 20초 기다려도 못 찾는다.
진단(`tools/diag.js`)에서:

- `panelHost: true`, `styleTag: true` → **확장은 정상 주입되고
  `attachVideosPage`도 실행됐다.** 스타일 태그는 그 함수가 넣는다.
- `videoLinks: 0` (t+2s, t+4s) → 카드가 아직 렌더되지 않았다.
- 그 직후 `ProtocolError: Runtime.callFunctionOn timed out` → **렌더러가 멈췄다.**
- 콘솔에 PlayReady DRM 경고가 9회 반복 → 목록 페이지도 플레이어를 띄운다.

**원인 판단 두 가지**

1. 네비게이션 대기 방식. `networkidle2`는 스트리밍 때문에 **영원히 안 정착**해
   45초 타임아웃이 났고, `domcontentloaded`는 **너무 이르다**(SPA 하이드레이션 전).
   → `domcontentloaded` + `waitForSelector('a[href*="/video/"]')`로 간다.
2. **우리 MutationObserver가 렌더러를 멈춘 것으로 본다.**
   `mo.observe(document.body, {childList:true, subtree:true})`의 콜백이
   매 변경마다 `querySelectorAll`과 `getComputedStyle`을 돈다.
   치지직 플레이어가 끊임없이 DOM을 건드리므로 이 콜백이 폭주한다.
   `getComputedStyle`은 레이아웃을 강제해 비용이 크다.
   → 콜백을 디바운스하고, 관련 없는 변경에는 일하지 않게 한다.

두 번째는 하니스 문제가 아니라 **제품 결함**이다. 실제 사용자 브라우저에서도
목록 페이지가 느려진다.

**시도한 것**

| # | 접근 | 결과 |
|---|------|------|
| 1 | `networkidle2`로 대기 | 실패 — 45초 타임아웃, 정착하지 않음 |
| 2 | `domcontentloaded`로 대기 | 실패 — 너무 이름, 4초에도 링크 0개 |
| 3 | 진단으로 원인 분리 | 성공 — 주입은 정상, 카드 미렌더 + 렌더러 정지 확인 |
| 4 | MutationObserver 250ms 디바운스 + 우리 요소 변경 무시 | **성공** |
| 5 | `gotoAndWaitCards` (domcontentloaded + waitForSelector) + `protocolTimeout` 120s | **성공** |

**확인된 결과**
툴바 주입, 링크 36개 → 버튼 18개(중복 제거), 전체 담기 65개 `ascending: true`,
같은 날 조각 시각순 (09-13 01:33 → 14:15 → 15:31).

**남은 교훈**
디바운스 없는 MutationObserver는 제품 결함이었다. 하니스가 아니라 실제
사용자 브라우저에서도 목록 페이지를 느리게 만든다. 치지직은 목록 페이지에서도
DRM 플레이어를 띄워 DOM 변경이 끊이지 않는다.

### 해결된 문제 기록

#### P1 — puppeteer가 MV3 확장을 로드하지 못한다 → **해결 (2026-09-15)**

원인이 **두 개**였다. 둘 다 고쳐야 통과했다.

**원인 A: 설치된 Chrome 정식판(152)이 커맨드라인 확장 로드를 차단한다.**

| # | 접근 | 정식판 152 | Chrome for Testing 153 |
|---|------|-----------|------------------------|
| 1 | `--disable-extensions-except` + `--load-extension` | 실패 | **성공** |
| 2 | 1 + `ignoreDefaultArgs: ['--disable-extensions']` | 실패 | — |
| 3 | 1 + `--disable-features=DisableLoadExtensionCommandLineSwitch` | 실패 | — |
| 4 | 2 + 3 동시 | 실패 | — |
| 5 | 4 + `--enable-unsafe-extension-debugging` | 실패 | — |

→ **Chrome for Testing을 쓴다.** `npm run setup:browser`로 내려받고
`tools/chrome-path.js`가 경로를 해석한다. 플래그 우회는 더 시도하지 않는다.

**원인 B: 판정 방법이 틀렸다.**

content script는 **isolated world**에서 돈다. 거기서 `window.__CHZZK_SMOKE__`에
심은 값은 `page.evaluate`(main world)에 보이지 않는다. 실측 `viaWindow: false`,
`viaDom: true`, `viaConsole: true`.

또한 background script가 없는 확장은 `chrome-extension:` 타깃을 만들지 않는다.
그래서 "타깃 0개"는 로드 실패의 증거가 아니었다. 이 오판이 원인 A를
과대평가하게 만들었다.

→ 판정과 디버깅 창구는 **`documentElement`의 data 속성**으로 한다. DOM은 공유된다.

**파생 결론: 하니스의 storage 접근 경로**

main world에 `chrome.storage`가 없으므로 계획 원안의
`page.evaluate(() => chrome.storage...)`는 전부 동작하지 않는다.
확장의 **service worker 타깃**에서 읽고 쓴다. `tools/probe-storage.js`로
왕복 확인 완료 (`{hello:'world', n:42}` 복원, `extPageStorageOk: true`).

---

## 작업 항목

상태: `[ ]` 미착수 · `[~]` 진행 중 · `[x]` 완료 · `[!]` 막힘

세부 단계와 코드는 `docs/superpowers/plans/2026-09-15-replay-playlist.md`에 있다.

| ID | 항목 | 상태 | 커밋 | 시도한 접근 |
|----|------|------|------|-------------|
| T0 | 하니스 스모크 테스트 + 치지직 DOM 정찰 | `[x]` | | 정식판 Chrome 실패 → Chrome for Testing 성공 |
| T1 | `format.js` 시간·날짜 포맷 | `[x]` | | 테스트 9개 통과 |
| T2 | `queue.js` 담기·오래된 순 정렬 | `[x]` | | 테스트 15개 통과 |
| T3 | `queue.js` 순서 변경·삭제·다음 항목 | `[x]` | | 테스트 29개 통과 (누적 53) |
| T4 | `chzzk-api.js` 호출·정규화 | `[x]` | | 테스트 14개 통과 (누적 67) |
| T5 | `store.js` 저장소 접근 | `[x]` | | 테스트 16개 통과 (누적 83) |
| T6 | `manifest.json` + `boot.js` 주입 골격 | `[x]` | | route 테스트 8개, 하니스로 pageType videos/watch 판정 확인 |
| T7 | Shadow DOM 패널 렌더 | `[x]` | | probe-panel로 렌더·순서변경·새로고침 복원·XSS 이스케이프 확인 |
| T8 | 목록 페이지 툴바·담기 버튼 | `[x]` | | P2 해결. 전체 담기 65개 오래된 순 확인 |
| T9 | 진행 저장·이어보기 복원 | `[x]` | | probe-watch로 무간섭·진행저장 300초·새로고침 복원 확인 |
| T10 | 종료 감지·다음 항목 전환 | `[x]` | | P3 해결. 카드→전환→done→currentIndex 이동, 마지막 항목 문구 확인 |
| T11 | 검증 하니스 완성 | `[x]` | | 8/8 통과. SPA 라우팅 폴링 대비책 추가 |
| T12 | README·수동 시나리오·머지 | `[x]` | | 완료 기준 8개 전부 충족 |

**T0이 먼저다.** MV3 확장을 puppeteer로 로드할 수 없으면 검증 계획 전체가
무너진다. 기능 코드보다 앞에 두어 5분째에 알게 한다. 동시에 스펙 4.3절의
미확인 셀렉터를 사실로 바꿔 T8·T9의 추측을 없앤다.

---

## 검증 기록

각 행은 **원문 출력을 근거로만** 채운다. 확인 당시의 커밋 SHA를 함께 적는다.
그 SHA 이후 `src/`가 바뀌면 그 통과는 **무효**로 보고 다시 돌린다.

### 단위 테스트

| 확인 시각 | SHA | 결과 |
|---|---|---|
| 2026-09-15 03:47 | `e2d6b78` | 95/95 통과 |

### 하니스 시나리오 (스펙 9.2절)

`npm run harness` 출력과 `tools/out/result.json`이 근거다.
스펙 9.2절의 8개에 9·10번을 더했다 — 완료 기준 6번과 8번을 증빙할
시나리오가 없었기 때문이다.

| # | 시나리오 | 상태 | 확인 시각 | SHA |
|---|----------|------|-----------|-----|
| 1 | 목록 페이지에 툴바·카드 버튼 주입 | 통과 | 2026-09-15 03:47 | `e2d6b78` |
| 2 | 전체 담기 → 큐가 오래된 순으로 채워짐 | 통과 | 2026-09-15 03:47 | `e2d6b78` |
| 3 | 패널 열림 + 순서 변경 저장 | 통과 | 2026-09-15 03:47 | `e2d6b78` |
| 4 | 새로고침 후 큐·패널 상태 복원 | 통과 | 2026-09-15 03:47 | `e2d6b78` |
| 5 | SPA 내부 이동 후 패널 생존 (D1 핵심 가정) | 통과 | 2026-09-15 03:47 | `e2d6b78` |
| 6 | `currentTime` 쓰기로 seek 동작 | 통과 | 2026-09-15 03:47 | `e2d6b78` |
| 7 | 종료 10초 전 다음 항목 카드 + 전환 | 통과 | 2026-09-15 03:47 | `e2d6b78` |
| 8 | 이어보기: seek → 재로드 → 위치 복원 | 통과 | 2026-09-15 03:47 | `e2d6b78` |
| 9 | 큐에 없는 영상 페이지에서 무간섭 | 통과 | 2026-09-15 03:47 | `e2d6b78` |
| 10 | 큐 버전 불일치 → 패널이 알린다 | 통과 | 2026-09-15 03:47 | `e2d6b78` |
| 11 | 목록 API 장애 → 패널이 알린다 | 통과 | 2026-09-15 03:47 | `e2d6b78` |

### 완료 기준 (스펙 10장)

| # | 조건 | 상태 | 근거 |
|---|------|------|------|
| 1 | `node --test` 전부 통과 | 충족 | 95/95 @ `e2d6b78` |
| 2 | 하니스 시나리오 통과 + 증빙 | 충족 | 11/11 @ `e2d6b78`, `tools/out/result.json` |
| 3 | 오킹TV 전체 담기 → 65개가 오래된 순 | 충족 | 시나리오 2 (`count: 65`, `ascending: true`) |
| 4 | 큐 영상 종료 시 다음 항목 자동 전환 | 충족 | 시나리오 7 (`aDone`, `currentIndex` 이동) |
| 5 | 재생 중 재로드 후 같은 위치에서 이어짐 | 충족 | 시나리오 8 (저장 300 → 복원 300+) |
| 6 | 큐에 없는 영상 페이지에서 무간섭 | 충족 | 시나리오 9 |
| 7 | README에 설치·사용법 | 충족 | `README.md` |
| 8 | 에러 경로 중 재현 가능한 것 실제 확인 | 충족 | 아래 참고 |

### 완료 기준 8번의 범위

하니스와 단위 테스트로 실제 확인한 에러 경로:

- 큐 버전 불일치 → 패널 문구 + storage 초기화 (시나리오 10)
- 목록 API 장애 → 패널 문구, 큐 무오염, 버튼 복구 (시나리오 11)
- API 스키마 이상 항목 스킵 + 개수 보고 (`chzzk-api.test.js`)
- 뒤 페이지 실패 시 나머지 살리기 + `failedPages` 보고 (`chzzk-api.test.js`)
- storage 쓰기 실패 시 throw 대신 false (`store.test.js`)
- 깨진 storage 값 방어 (`store.test.js`)

**확인하지 못한 경로** (재현이 사용자 계정·네트워크에 달려 있다):

- 카드 셀렉터 불일치 — 치지직이 개편되어야 재현된다
- `<video>` 15초 내 미발견 — DRM 실패 시 발생하지만 비결정적이다
- 삭제·접근 불가 영상 `unavailable` 처리 — `docs/manual-test.md` M3~M5

---

## 환경 사실

다시 알아내지 않도록 확인된 것만 적는다. 확인 날짜를 붙인다.

| 항목 | 값 | 확인 |
|---|---|---|
| Chrome | `152.0.7977.84` | 2026-09-15 |
| Chrome 실행 경로 | `C:\Program Files\Google\Chrome\Application\chrome.exe` | 2026-09-15 |
| node / npm | `v24.11.0` / `11.6.1` | 2026-09-15 |
| 작업 브랜치 | `feat/replay-playlist` | — |
| 테스트 채널 | 오킹TV `0f9a3b4fbb0e7137d1f0b4d70563031c`, 다시보기 65개 / 9페이지 | 2026-09-15 |
| 테스트 영상 | `14689850` — `<video>` 직접 접근 확인, iframe 0개, MSE `blob:` src | 2026-09-15 |
| Claude-in-Chrome 도구 | `chzzk.naver.com` **차단됨**. 재시도 금물, 하니스 사용 | 2026-09-15 |
| 하니스 프로필 경로 | `tools/.profile/` (gitignore) — **이 경로로만 프로세스 식별** | — |
| PowerShell 특이점 | `git push` 등이 stderr로 출력해 `NativeCommandError`처럼 보임. 실패가 아님 | 2026-09-15 |
| PowerShell 특이점 2 | here-string 안의 큰따옴표가 네이티브 인자 전달에서 깨진다. **커밋 메시지에 `"`를 쓰지 말 것.** 필요하면 파일에 쓰고 `git commit -F` | 2026-09-15 |
| **하니스 브라우저** | **Chrome for Testing 153.0.8010.36.** 정식판 152는 확장 로드 차단. `npm run setup:browser` / `tools/chrome-path.js` | 2026-09-15 |
| content script world | **isolated.** `window`에 심은 값은 `page.evaluate`에 안 보임. 창구는 `documentElement`의 data 속성 | 2026-09-15 |
| 하니스 storage 경로 | main world에 `chrome.storage` 없음 → **service worker 타깃**에서 evaluate. 유휴 시 죽으므로 매번 재확보 | 2026-09-15 |
| `CARD_LINK` | `a[href*="/video/"]` — 카드당 **2개**(썸네일+제목), 중복 처리 주의 | 2026-09-15 |
| 카드 경계 | `link.closest('li')` (`li._item_*`). `article` 없음 | 2026-09-15 |
| 목록 컨테이너 | 카드의 `parentElement` (`ul._list_*`). 툴바는 그 앞에 꽂음 | 2026-09-15 |
| 플레이어 앵커 | `.pzp` (prismplayer 루트, relative). `<video>` 바로 위는 `.webplayer-internal-source-wrapper` | 2026-09-15 |
| 클래스명 | **해시 포함** (`_thumbnail_1xtdq_10`) → 셀렉터로 쓰지 말 것 | 2026-09-15 |
| 단일 영상 API | `GET api.chzzk.naver.com/service/v2/videos/{videoNo}` — 인증 없이 200, 목록 항목과 **같은 스키마**. 개별 담기에 사용 | 2026-09-15 |
| 목록 페이지 대기 | `networkidle2`는 정착 안 함, `domcontentloaded`는 너무 이름 → `gotoAndWaitCards` 사용 | 2026-09-15 |
| **headless와 DRM** | headless에서는 VOD가 **절대** 재생되지 않음 (readyState 0). 검증은 headed 필수. 프로필도 분리해야 함 | 2026-09-15 |
| DRM 로딩 비결정성 | 같은 조건에서 성공/실패가 갈린다. `withReadyWatchPage`로 세션 재시도 | 2026-09-15 |
| 플레이어 종료 동작 | 영상이 끝나면 **같은 영상을 처음부터 다시 재생**한다 (3578 to 1, ended false). 다음으로 넘기지 않는다 | 2026-09-15 |
| seek | `currentTime` 쓰기 동작 확인 (1.483 → 62.292) | 2026-09-15 |
| 관찰 | 영상 페이지에서 `PAGEERROR: q` 가 뜬다. 한 글자 minified 예외라 치지직 자체 번들의 것으로 본다. 우리 코드는 minify 안 하므로 메시지가 읽힌다. 기능 영향 없음 | 2026-09-15 |

---

## 막힌 항목

접근 3개를 시도해도 안 된 항목을 여기로 옮긴다. 무엇을 시도했고 왜 안 됐는지 적는다.

없음

---

## v2 후보

작업 중 떠오른 것을 여기 적고 v1 범위에 끌어오지 않는다.

- 재생목록 여러 개 · 이름 짓기
- 여러 채널 섞기
- "안 본 것만" 필터
- 목록 내보내기 / 불러오기
- 구간 건너뛰기 (시작 n분 스킵)
