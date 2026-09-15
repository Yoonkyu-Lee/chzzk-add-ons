// 남아 있는 하니스 브라우저를 정리한다. npm run harness:clean
//
// 프로필 경로로만 식별한다. 사람이 쓰는 Chrome은 절대 건드리지 않는다.
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sweepStaleBrowsers } from './chrome-path.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const profiles = [resolve(HERE, '.profile'), resolve(HERE, '.profile-headless'),
  resolve(HERE, '.probe-profile')];

let total = 0;
for (const p of profiles) total += sweepStaleBrowsers({ profile: p, quiet: true });
console.log(total > 0 ? `정리 완료: ${total}개` : '정리할 하니스 브라우저가 없습니다.');
