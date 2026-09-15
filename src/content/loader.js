// MV3 content script는 ES 모듈로 선언할 수 없다.
// 클래식 스크립트에서 동적 import로 모듈 그래프를 끌어온다.
// 그래서 src/**가 web_accessible_resources에 등록돼 있어야 한다.
(async () => {
  try {
    const url = chrome.runtime.getURL('src/content/boot.js');
    const mod = await import(url);
    await mod.start();
  } catch (e) {
    console.error('[chzzk-add-ons] 부팅에 실패했습니다', e);
  }
})();
