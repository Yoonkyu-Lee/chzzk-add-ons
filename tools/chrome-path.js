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
    '--no-default-browser-check'
  ];
}
