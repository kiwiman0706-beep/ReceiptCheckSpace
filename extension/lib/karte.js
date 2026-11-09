// カルテ表示。デジカルは埋め込み（iframe）を拒否するため、別ウインドウで開いて連動させる。
// 表示方式を変えるときは、このファイルだけを差し替える（show(url) / arrange(url) を持つオブジェクトを返す）。
//
// - デジカル用のウインドウを1つだけ開き、行を選ぶたびにそのタブのURLを書き換える
//   （ハッシュだけ変わるので、デジカルの画面全体は読み込み直さずに切り替わる）
// - 最初に開くとき、ビューアを画面の左、デジカルを右に並べる
// - デジカルのウインドウが閉じられていたら、次に行を選んだときに開き直す

const SESSION_KEY = 'rv:karteWindow';
const VIEWER_WIDTH = 480;

async function getSavedTab() {
  const { [SESSION_KEY]: saved } = await chrome.storage.session.get(SESSION_KEY);
  if (!saved) return null;
  try {
    return await chrome.tabs.get(saved.tabId);
  } catch {
    return null;
  }
}

/** この画面（ビューアがいるモニター）の作業領域 */
function screenArea() {
  return {
    left: screen.availLeft ?? 0,
    top: screen.availTop ?? 0,
    width: screen.availWidth,
    height: screen.availHeight,
  };
}

/** ビューアを左に、デジカルを右に並べる位置 */
function layout(viewerWin) {
  const area = screenArea();
  const viewerWidth = Math.min(
    Math.max(viewerWin.state === 'normal' ? viewerWin.width : VIEWER_WIDTH, 360),
    Math.floor(area.width / 2),
  );
  return {
    viewer: { left: area.left, top: area.top, width: viewerWidth, height: area.height },
    karte: { left: area.left + viewerWidth, top: area.top, width: area.width - viewerWidth, height: area.height },
  };
}

async function placeViewer(me, bounds) {
  try {
    if (me.state !== 'normal') await chrome.windows.update(me.id, { state: 'normal' });
    await chrome.windows.update(me.id, bounds);
  } catch { /* 位置合わせに失敗しても続ける */ }
}

async function openKarteWindow(url, bounds) {
  let win;
  try {
    win = await chrome.windows.create({ url, type: 'normal', focused: false, ...bounds });
  } catch {
    // 画面の構成によっては位置指定が拒否されるので、そのときは位置なしで開く
    win = await chrome.windows.create({ url, type: 'normal', focused: false });
  }
  await chrome.storage.session.set({ [SESSION_KEY]: { windowId: win.id, tabId: win.tabs[0].id } });
  return win;
}

class WindowView {
  /** 行のカルテを表示する */
  async show(url) {
    const tab = await getSavedTab();
    if (tab) {
      await chrome.tabs.update(tab.id, { url });
      // 最小化されていたら戻す（フォーカスはビューアに残す）
      const win = await chrome.windows.get(tab.windowId);
      if (win.state === 'minimized') await chrome.windows.update(win.id, { state: 'normal' });
      return;
    }
    const me = await chrome.windows.getCurrent();
    const pos = layout(me);
    await placeViewer(me, pos.viewer);
    await openKarteWindow(url, pos.karte);
  }

  /** ビューアとデジカルを左右に並べ直す（デジカルのウインドウがなければ開く） */
  async arrange(url) {
    const me = await chrome.windows.getCurrent();
    const pos = layout(me);
    await placeViewer(me, pos.viewer);
    const tab = await getSavedTab();
    if (tab) {
      await chrome.windows.update(tab.windowId, { state: 'normal' });
      await chrome.windows.update(tab.windowId, pos.karte);
      await chrome.windows.update(tab.windowId, { focused: true });
      await chrome.windows.update(me.id, { focused: true });
    } else if (url) {
      await openKarteWindow(url, pos.karte);
    }
  }
}

export function createKarteView() {
  return new WindowView();
}
