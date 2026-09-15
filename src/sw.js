// 아이콘 클릭을 활성 탭에 전달하는 것 외에는 아무 일도 하지 않는다.
// MV3 service worker는 수시로 죽으므로 상태를 여기 두지 않는다.
chrome.action.onClicked.addListener(async (tab) => {
  if (!tab?.id) return;
  try {
    await chrome.tabs.sendMessage(tab.id, { type: 'chzzk-addons/toggle-panel' });
  } catch {
    // content script가 없는 탭이면 조용히 지나간다. 사용자가 할 일이 없다.
  }
});
