// P1 전용 프로브: puppeteer가 MV3 확장을 로드하는 조합을 찾는다.
// chzzk를 반복해서 때리지 않기 위해 example.com에서 판정한다.
// 조합을 하나씩 시도하고 결과를 표로 찍는다.
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { rmSync } from 'node:fs';
import puppeteer from 'puppeteer-core';
import { resolveChrome } from './chrome-path.js';

const HERE = dirname(fileURLToPath(import.meta.url));
// --installed 를 주면 설치된 정식판으로 비교 실행한다.
const useInstalled = process.argv.includes('--installed');
const chrome = useInstalled
  ? { path: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', kind: 'installed-stable' }
  : resolveChrome();
const CHROME = chrome.path;
const EXT = resolve(HERE, 'fixtures/smoke-ext');
const PROBE_URL = 'https://example.com/';

// 조합마다 프로필을 비운다. 이전 시도의 확장 설치 상태가 남으면
// 어느 플래그가 효과를 냈는지 알 수 없다.
const PROFILE = resolve(HERE, '.probe-profile');

const attempts = [
  {
    name: '1. 기본 (disable-extensions-except + load-extension)',
    opts: {
      args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`]
    }
  },
  {
    name: '2. + ignoreDefaultArgs: --disable-extensions',
    opts: {
      ignoreDefaultArgs: ['--disable-extensions'],
      args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`]
    }
  },
  {
    name: '3. + DisableLoadExtensionCommandLineSwitch 해제',
    opts: {
      args: [
        `--disable-extensions-except=${EXT}`,
        `--load-extension=${EXT}`,
        '--disable-features=DisableLoadExtensionCommandLineSwitch'
      ]
    }
  },
  {
    name: '4. 2 + 3 동시',
    opts: {
      ignoreDefaultArgs: ['--disable-extensions'],
      args: [
        `--disable-extensions-except=${EXT}`,
        `--load-extension=${EXT}`,
        '--disable-features=DisableLoadExtensionCommandLineSwitch'
      ]
    }
  },
  {
    name: '5. 4 + enable-unsafe-extension-debugging',
    opts: {
      ignoreDefaultArgs: ['--disable-extensions'],
      args: [
        `--disable-extensions-except=${EXT}`,
        `--load-extension=${EXT}`,
        '--disable-features=DisableLoadExtensionCommandLineSwitch',
        '--enable-unsafe-extension-debugging',
        '--silent-debugger-extension-api'
      ]
    }
  }
];

async function tryOne(attempt) {
  try {
    rmSync(PROFILE, { recursive: true, force: true });
  } catch {
    // 잠금이 걸려 있으면 그대로 진행한다. 결과 해석에만 영향이 있다.
  }
  let browser = null;
  try {
    browser = await puppeteer.launch({
      executablePath: CHROME,
      userDataDir: PROFILE,
      headless: false,
      ...attempt.opts,
      args: [...attempt.opts.args, '--no-first-run', '--no-default-browser-check']
    });
    const page = await browser.newPage();
    const sawLog = [];
    page.on('console', (m) => { if (m.text().includes('[smoke]')) sawLog.push(m.text()); });
    await page.goto(PROBE_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await new Promise((r) => setTimeout(r, 2000));

    // 세 경로를 따로 본다. DOM은 world를 넘나들고, window는 넘나들지 않는다.
    const viaDom = await page
      .evaluate(() => document.documentElement.getAttribute('data-chzzk-smoke') === 'ok')
      .catch(() => false);
    const viaWindow = await page.evaluate(() => window.__CHZZK_SMOKE__ === 'ok').catch(() => false);
    const viaConsole = sawLog.length > 0;

    const targets = (await browser.targets())
      .map((t) => `${t.type()}:${t.url().slice(0, 60)}`)
      .filter((s) => s.includes('chrome-extension'));
    const version = await browser.version();
    return { injected: viaDom || viaConsole, viaDom, viaWindow, viaConsole, targets, version };
  } catch (e) {
    return { injected: false, error: e.message, targets: [] };
  } finally {
    await browser?.close().catch(() => {});
  }
}

console.log(`브라우저: ${chrome.kind}\n  ${CHROME}\n`);

const results = [];
for (const a of attempts) {
  const r = await tryOne(a);
  results.push({ name: a.name, ...r });
  console.log(`${r.injected ? 'OK  ' : 'FAIL'} ${a.name}` +
    `  dom=${r.viaDom} window=${r.viaWindow} console=${r.viaConsole}` +
    (r.error ? ` — ${r.error}` : '') +
    (r.targets.length ? `  [ext targets: ${r.targets.length}]` : ''));
  if (r.injected) break;
}

const win = results.find((r) => r.injected);
console.log('\n=== 결론 ===');
if (win) {
  console.log('성공한 조합:', win.name);
  console.log('Chrome:', win.version);
  console.log('확장 타깃:', JSON.stringify(win.targets, null, 2));
} else {
  console.log('모든 조합 실패. Chrome for Testing 또는 raw CDP로 내려가야 한다.');
  console.log(JSON.stringify(results, null, 2));
}
try {
  rmSync(PROFILE, { recursive: true, force: true });
} catch {
  // 정리 실패는 치명적이지 않다. 다음 실행이 다시 지운다.
}
