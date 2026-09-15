# 진행 기록

**이 파일이 유일하게 믿을 수 있는 현재 상태다.** 대화 컨텍스트는 요약되거나
사라질 수 있다. 여기 적히지 않은 것은 없었던 일로 취급한다.

갱신 규칙은 `CLAUDE.md`의 "세션 재개 절차"와 "기록 규칙"에 있다.

---

## 지금 하는 일

> 항상 한 줄. 재개하는 세션이 가장 먼저 읽는 줄이다.

T6 진행 중 — manifest + boot.js 주입 골격. T0~T5 완료, 단위 테스트 83개 통과.

## 조사 중인 문제

> 디버깅에 들어가면 여기에 증상·시도·가설을 적는다. 이걸 적지 않고 세션이
> 끊기면 다음 세션이 같은 시도를 반복한다. 해결되면 "없음"으로 되돌리고
> 알게 된 사실은 스펙이나 아래 "환경 사실"로 옮긴다.

없음

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
| T6 | `manifest.json` + `boot.js` 주입 골격 | `[ ]` | | |
| T7 | Shadow DOM 패널 렌더 | `[ ]` | | |
| T8 | 목록 페이지 툴바·담기 버튼 | `[ ]` | | |
| T9 | 진행 저장·이어보기 복원 | `[ ]` | | |
| T10 | 종료 감지·다음 항목 전환 | `[ ]` | | |
| T11 | 검증 하니스 완성 | `[ ]` | | |
| T12 | README·수동 시나리오·머지 | `[ ]` | | |

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
| — | — | 아직 없음 |

### 하니스 시나리오 (스펙 9.2절)

| # | 시나리오 | 상태 | 확인 시각 | SHA |
|---|----------|------|-----------|-----|
| 1 | 목록 페이지에 툴바·카드 버튼 주입 | — | | |
| 2 | 전체 담기 → 큐가 오래된 순으로 채워짐 | — | | |
| 3 | 패널 열림 + 순서 변경 저장 | — | | |
| 4 | 새로고침 후 큐·패널 상태 복원 | — | | |
| 5 | SPA 내부 이동 후 패널 생존 (D1 핵심 가정) | — | | |
| 6 | `currentTime` 쓰기로 seek 동작 | — | | |
| 7 | 종료 10초 전 다음 항목 카드 + 전환 | — | | |
| 8 | 이어보기: seek → 새로고침 → 위치 복원 | — | | |

### 완료 기준 (스펙 10장)

| # | 조건 | 상태 |
|---|------|------|
| 1 | `node --test` 전부 통과 | — |
| 2 | 하니스 시나리오 1~8 통과 + 스크린샷 증빙 | — |
| 3 | 오킹TV 전체 담기 → 65개가 오래된 순 | — |
| 4 | 큐 영상 종료 시 다음 항목 자동 전환 | — |
| 5 | 재생 중 새로고침 후 같은 위치에서 이어짐 | — |
| 6 | 큐에 없는 영상 페이지에서 무간섭 | — |
| 7 | README에 설치·사용법 | — |
| 8 | 에러 표 경로 중 재현 가능한 것 실제 확인 | — |

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
| seek | `currentTime` 쓰기 동작 확인 (1.483 → 62.292) | 2026-09-15 |

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
