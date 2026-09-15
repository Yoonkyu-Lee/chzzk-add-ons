// 실행할 Chrome 바이너리를 고른다.
//
// 설치된 Chrome 정식판(152)은 커맨드라인 확장 로드를 정책으로 차단한다.
// --load-extension, --disable-features 우회, --enable-unsafe-extension-debugging을
// 모두 시도했지만 chrome-extension: 타깃이 아예 생기지 않았다 (progress.md P1).
// 그래서 자동화 전용 빌드인 Chrome for Testing을 쓴다.
//
// 내려받기: npx @puppeteer/browsers install chrome@stable --path tools/.browser
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

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
    // 자동재생을 막으면 timeupdate가 흐르지 않아 종료 감지를 검증할 수 없다.
    // 실측으로 --autoplay-policy=user-gesture-required를 넣었을 때
    // 플레이어가 beforeplay에서 멈춰 카드가 뜨지 않았다.
    '--autoplay-policy=no-user-gesture-required',
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

const ROOT = resolve(HERE, '..');
const HARNESS_PROFILE = resolve(HERE, '.profile');

// 사람이 쓰는 Chrome을 절대 건드리지 않기 위해 프로필 경로로만 식별한다.
// 이름 기준 종료(taskkill /IM chrome.exe)는 금지다 — 사용자 브라우저가 죽는다.
export function sweepStaleBrowsers({ profile = HARNESS_PROFILE, quiet = false } = {}) {
  if (process.platform !== 'win32') return 0;
  const marker = profile.replace(/\\/g, '\\\\');
  const ps = `Get-CimInstance Win32_Process -Filter "Name='chrome.exe'" `
    + `| Where-Object { $_.CommandLine -like '*${profile.replace(/'/g, "''")}*' } `
    + '| ForEach-Object { try { Stop-Process -Id $_.ProcessId -Force -ErrorAction Stop; 1 } catch { 0 } } '
    + '| Measure-Object -Sum | Select-Object -ExpandProperty Sum';
  try {
    const out = execFileSync('powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', ps],
      { encoding: 'utf8', timeout: 20000 });
    const n = Number(String(out).trim()) || 0;
    if (n > 0 && !quiet) console.log(`남아 있던 하니스 브라우저 ${n}개를 정리했습니다.`);
    return n;
  } catch {
    // 정리 실패는 치명적이지 않다. 프로필 잠금이 걸리면 launch가 알려준다.
    void marker;
    return 0;
  }
}

// 모든 검증 도구가 이 한 곳으로 브라우저를 띄운다. 설정이 갈라지지 않게 한다.
//
// 기본은 headful이다. 치지직 VOD는 DRM이라 headless에서 재생되지 않는다 —
// readyState가 0에서 올라가지 않고 duration이 NaN으로 남는다
// (tools/probe-drm.js 실측). 확장 주입 자체는 headless에서도 되므로
// 영상이 필요 없는 확인만 --headless로 돌릴 수 있다.
//
// 창을 확실히 닫는 것이 이 함수의 두 번째 책임이다. 기억에 의존하지 않는다.
//   - 띄우기 전에 남아 있던 우리 브라우저를 정리한다
//   - 프로세스가 어떻게 끝나든 닫도록 exit/SIGINT/예외 훅을 건다
//   - 시작 탭을 재사용한다. newPage를 쓰면 탭이 하나 더 열린다
export async function launchHarness({ ext = ROOT, profile } = {}) {
  const headless = process.argv.includes('--headless');
  // headed와 headless는 프로필을 나눈다. 같이 쓰면 headless 실행이 프로필의
  // DRM(PlayReady/Widevine) 상태를 망가뜨려, 이후 headed 실행에서도 영상
  // 메타데이터가 오지 않는다 — readyState가 0에 머물고 duration이 NaN이 된다.
  // 프로필을 지우면 복구되는 것으로 원인을 확인했다.
  profile = profile ?? (headless ? `${HARNESS_PROFILE}-headless` : HARNESS_PROFILE);
  sweepStaleBrowsers({ profile });

  const chrome = resolveChrome();
  const browser = await puppeteer.launch({
    executablePath: chrome.path,
    userDataDir: profile,
    headless,
    protocolTimeout: PROTOCOL_TIMEOUT,
    args: extensionArgs(ext)
  });

  let closed = false;
  const close = async () => {
    if (closed) return;
    closed = true;
    await browser.close().catch(() => {});
  };
  // node가 정상 종료하든 Ctrl+C로 끊기든 예외로 죽든 창을 닫는다.
  process.once('exit', () => { if (!closed) sweepStaleBrowsers({ profile, quiet: true }); });
  for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
    process.once(sig, async () => {
      await close();
      process.exit(130);
    });
  }
  process.once('uncaughtException', async (e) => {
    console.error('예외로 종료합니다:', e?.message);
    await close();
    process.exit(1);
  });
  process.once('unhandledRejection', async (e) => {
    console.error('미처리 거부로 종료합니다:', e?.message ?? e);
    await close();
    process.exit(1);
  });

  const page = (await browser.pages())[0] ?? await browser.newPage();
  console.log(`브라우저: ${chrome.kind} / ${headless ? 'headless' : 'headed'}`);
  return { browser, page, chrome, close };
}
