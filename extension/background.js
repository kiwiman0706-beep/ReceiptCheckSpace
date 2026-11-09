// ツールバーのアイコンを押したら、ビューアのウインドウを開く（開いていれば前面に出す）
const VIEWER = chrome.runtime.getURL('viewer.html');

/** 開いているビューアを前面に出す。見つからない・出せないときは false */
async function focusExisting() {
  let contexts = [];
  try {
    contexts = await chrome.runtime.getContexts({ contextTypes: ['TAB'], documentUrls: [VIEWER] });
  } catch (e) {
    console.warn('getContexts に失敗', e);
    return false;
  }
  for (const c of contexts) {
    try {
      const win = await chrome.windows.get(c.windowId);
      // 最小化されていると「前面に出す」だけでは見えないので、元に戻す
      const patch = { focused: true };
      if (win.state === 'minimized') patch.state = 'normal';
      await chrome.windows.update(c.windowId, patch);
      if (c.tabId >= 0) await chrome.tabs.update(c.tabId, { active: true });
      return true;
    } catch (e) {
      console.warn('既存のビューアを前面に出せませんでした', e);
    }
  }
  return false;
}

/** いま使っている Chrome ウインドウの位置と大きさ（その画面に開くため） */
async function currentBounds() {
  try {
    const w = await chrome.windows.getLastFocused({ windowTypes: ['normal'] });
    if (w && w.state !== 'minimized' && w.width > 200 && w.height > 200) {
      return { left: w.left, top: w.top, width: w.width, height: w.height };
    }
  } catch { /* ウインドウがない */ }
  return null;
}

async function createViewer() {
  const { 'rv:settings': s } = await chrome.storage.local.get('rv:settings');
  const bounds = await currentBounds();
  const opts = { url: VIEWER, type: 'popup', focused: true };
  const windowMode = s?.karteMode === 'window';
  if (bounds) {
    Object.assign(opts, bounds);
    if (windowMode) opts.width = Math.min(bounds.width, Math.max(360, s.paneWidth || 460) + 40);
  } else if (windowMode) {
    Object.assign(opts, { width: Math.max(360, s.paneWidth || 460) + 40, height: 900 });
  }
  let win;
  try {
    win = await chrome.windows.create(opts);
  } catch (e) {
    // 位置の指定が拒否されたら（画面構成が変わったときなど）、位置なしで開く
    console.warn('位置を指定して開けなかったので、位置なしで開きます', e);
    win = await chrome.windows.create({ url: VIEWER, type: 'popup', focused: true });
  }
  if (!windowMode) {
    try { await chrome.windows.update(win.id, { state: 'maximized' }); } catch { /* そのままの大きさで使う */ }
  }
}

async function openViewer() {
  if (await focusExisting()) return;
  await createViewer();
}

chrome.action.onClicked.addListener(() => {
  openViewer().catch(async (e) => {
    console.error('ビューアを開けませんでした', e);
    // 最後の手段：普通のタブとして開く
    try { await chrome.tabs.create({ url: VIEWER }); } catch (e2) { console.error(e2); }
  });
});
