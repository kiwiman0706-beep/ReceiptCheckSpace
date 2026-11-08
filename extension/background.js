// ツールバーのアイコンを押したら、ビューアのウインドウを開く（開いていれば前面に出す）
const VIEWER = chrome.runtime.getURL('viewer.html');

chrome.action.onClicked.addListener(async () => {
  const contexts = await chrome.runtime.getContexts({ contextTypes: ['TAB'], documentUrls: [VIEWER] });
  if (contexts.length > 0) {
    const c = contexts[0];
    await chrome.windows.update(c.windowId, { focused: true });
    if (c.tabId >= 0) await chrome.tabs.update(c.tabId, { active: true });
    return;
  }
  const { 'rv:settings': s } = await chrome.storage.local.get('rv:settings');
  if (s?.karteMode === 'window') {
    await chrome.windows.create({ url: VIEWER, type: 'popup', width: Math.max(360, s.paneWidth || 460) + 40, height: 900 });
  } else {
    await chrome.windows.create({ url: VIEWER, type: 'popup', state: 'maximized' });
  }
});
