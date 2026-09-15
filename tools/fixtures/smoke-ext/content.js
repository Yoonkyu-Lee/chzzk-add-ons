// 확장 주입 판정용. 세 경로로 표식을 남겨 어느 것이 관측 가능한지 가린다.
//
// content script는 기본적으로 isolated world에서 돈다. 그래서 window에 심은
// 값은 page.evaluate(main world)에서 보이지 않는다. DOM은 두 world가 공유한다.
document.documentElement.setAttribute('data-chzzk-smoke', 'ok');
window.__CHZZK_SMOKE__ = 'ok';
console.log('[smoke] content script ran on', location.pathname);
