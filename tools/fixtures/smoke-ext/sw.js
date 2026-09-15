// 하니스가 storage를 읽고 쓰는 창구가 될 수 있는지 확인하기 위한 것.
// main world의 page.evaluate에는 chrome.storage가 없으므로, 하니스는
// 이 service worker 타깃에 붙어 evaluate해야 한다.
console.log('[smoke-sw] service worker booted');
