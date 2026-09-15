// 경로 판정만 한다. DOM을 보지 않으므로 Node에서 테스트된다.

// 채널 id는 32자 hex다. 이 형태로 제한하면 /live/videos 같은 경로가
// 목록으로 오인되어 엉뚱한 채널에 툴바를 붙이는 일이 없다.
const VIDEOS_RE = /^\/([0-9a-f]{32})\/videos\/?$/;
const WATCH_RE = /^\/video\/(\d+)\/?$/;

export function detectPageType(pathname) {
  if (VIDEOS_RE.test(pathname)) return 'videos';
  if (WATCH_RE.test(pathname)) return 'watch';
  return 'other';
}

export function parseVideoNo(pathname) {
  const m = String(pathname).match(WATCH_RE);
  return m ? Number(m[1]) : null;
}

export function parseChannelId(pathname) {
  const m = String(pathname).match(VIDEOS_RE);
  return m ? m[1] : null;
}
