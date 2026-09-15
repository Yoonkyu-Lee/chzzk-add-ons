// 실행할 Chrome 바이너리를 고른다.
//
// 설치된 Chrome 정식판(152)은 커맨드라인 확장 로드를 정책으로 차단한다.
// --load-extension, --disable-features 우회, --enable-unsafe-extension-debugging을
// 모두 시도했지만 chrome-extension: 타깃이 아예 생기지 않았다 (progress.md P1).
// 그래서 자동화 전용 빌드인 Chrome for Testing을 쓴다.
//
// 내려받기: npx @puppeteer/browsers install chrome@stable --path tools/.browser
import { existsSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const BROWSER_DIR = resolve(HERE, '.browser/chrome');
const INSTALLED_STABLE = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

// 여러 버전이 깔려 있으면 가장 최신을 쓴다.
function findChromeForTesting() {
  if (!existsSync(BROWSER_DIR)) return null;
  const dirs = readdirSync(BROWSER_DIR).sort().reverse();
  for (const d of dirs) {
    const exe = resolve(BROWSER_DIR, d, 'chrome-win64/chrome.exe');
    if (existsSync(exe)) return exe;
  }
  return null;
}

export function resolveChrome({ allowInstalled = false } = {}) {
  const cft = findChromeForTesting();
  if (cft) return { path: cft, kind: 'chrome-for-testing' };
  if (allowInstalled && existsSync(INSTALLED_STABLE)) {
    return { path: INSTALLED_STABLE, kind: 'installed-stable' };
  }
  throw new Error(
    'Chrome for Testing이 없습니다. 아래를 먼저 실행해 주세요.\n' +
    '  npx @puppeteer/browsers install chrome@stable --path tools/.browser'
  );
}

// 확장을 올린 브라우저를 띄울 때 쓰는 공통 인자.
export function extensionArgs(extPath) {
  return [
    `--disable-extensions-except=${extPath}`,
    `--load-extension=${extPath}`,
    '--no-first-run',
    '--no-default-browser-check',
    // 목록 페이지도 DRM 플레이어를 띄운다. 자동재생을 막으면 렌더러 부담이 줄고
    // 검증이 안정된다. 우리 기능은 명시적 currentTime 조작으로 검증하므로
    // 자동재생에 의존하지 않는다.
    '--autoplay-policy=user-gesture-required',
    '--mute-audio'
  ];
}

// 치지직 목록 페이지에서 카드가 렌더될 때까지 기다린다.
// domcontentloaded는 SPA 하이드레이션 전이라 너무 이르고,
// networkidle2는 스트리밍 때문에 영원히 정착하지 않는다 (progress.md P2).
export const CARD_LINK_SELECTOR = 'a[href*="/video/"]';

export async function gotoAndWaitCards(page, url, { timeout = 60000 } = {}) {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout });
  await page.waitForSelector(CARD_LINK_SELECTOR, { timeout });
}

// 렌더러가 잠깐 바빠도 CDP 호출이 죽지 않게 넉넉히 준다.
export const PROTOCOL_TIMEOUT = 120000;
