// 초 단위 길이와 API 날짜 문자열을 사람이 읽는 형태로 바꾼다. 순수 함수만 있다.

// 내림을 쓴다. 반올림하면 42675초(11.85시간)가 "12시간"으로 보여
// 실제보다 길어진다.
function safeSeconds(value) {
  const n = Math.floor(Number(value));
  return Number.isFinite(n) && n > 0 ? n : 0;
}

export function formatDurationKo(seconds) {
  const s = safeSeconds(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h}시간 ${m}분` : `${m}분`;
}

// 플레이어 눈금용. video.duration이 소수이므로 초를 버린다.
export function formatClock(seconds) {
  const s = safeSeconds(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`;
}

// API의 publishDate는 'YYYY-MM-DD HH:mm:ss' 고정 폭이다.
// Date로 파싱하지 않는다 — 시간대 해석이 끼어들면 표시가 환경에 따라 흔들린다.
// 형식이 맞지 않으면 원문을 그대로 보여준다. 화면이 비는 것보다 낫다.
export function formatDateShort(publishedAt) {
  const raw = publishedAt === null || publishedAt === undefined ? '' : String(publishedAt);
  const m = raw.match(/^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})/);
  if (!m) return raw;
  return `${m[2]}-${m[3]} ${m[4]}:${m[5]}`;
}
