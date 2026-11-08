// 右ペイン（カルテ表示）。SPEC 3.5 の方式を差し替えられるよう、ここ1か所にまとめる。
//
//   方式A 'iframe' … ビューア内の iframe にデジカルを表示。
//                    デジカルが埋め込みを拒否するヘッダーを返す場合に備え、この拡張機能のページから
//                    埋め込んだときだけ X-Frame-Options / CSP を外すルールを登録する（方式Aの間だけ）。
//   方式B 'window' … デジカル用のウインドウを別に開き、行を選ぶたびにそのタブのURLを書き換える。
//
// どちらも show(url) を呼ぶだけでよい。

const RULE_ID = 1;
const SESSION_KEY = 'rv:karteWindow';

async function enableFrameRule() {
  await chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: [RULE_ID],
    addRules: [{
      id: RULE_ID,
      priority: 1,
      action: {
        type: 'modifyHeaders',
        responseHeaders: [
          { header: 'x-frame-options', operation: 'remove' },
          { header: 'content-security-policy', operation: 'remove' },
        ],
      },
      condition: {
        requestDomains: ['digikar.jp'],
        resourceTypes: ['sub_frame'],
        initiatorDomains: [chrome.runtime.id],
      },
    }],
  });
}

async function disableFrameRule() {
  await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds: [RULE_ID] });
}

function sameDocument(a, b) {
  return a && b && a.split('#')[0] === b.split('#')[0];
}

class IframeView {
  constructor(container) {
    this.container = container;
    this.frame = null;
  }

  async start() {
    await enableFrameRule();
  }

  async stop() {
    this.frame?.remove();
    this.frame = null;
    await disableFrameRule();
  }

  async show(url) {
    if (!this.frame) {
      this.container.textContent = '';
      this.frame = document.createElement('iframe');
      this.frame.className = 'karte-frame';
      this.frame.title = '該当カルテ';
      this.frame.referrerPolicy = 'no-referrer';
      this.frame.src = url;
      this.container.append(this.frame);
      return;
    }
    // ハッシュだけ違うときは、ページ全体を読み込み直さずに切り替える
    if (sameDocument(this.frame.src, url)) {
      try { this.frame.contentWindow.location.replace(url); return; } catch { /* 下へ */ }
    }
    this.frame.src = url;
  }
}

class WindowView {
  constructor() {
    this.width = 520;
  }

  async start() {
    await disableFrameRule();
  }

  async stop() {}

  async #getTab() {
    const { [SESSION_KEY]: saved } = await chrome.storage.session.get(SESSION_KEY);
    if (!saved) return null;
    try {
      return await chrome.tabs.get(saved.tabId);
    } catch {
      return null;
    }
  }

  async show(url) {
    const tab = await this.#getTab();
    if (tab) {
      await chrome.tabs.update(tab.id, { url });
      return;
    }
    // ビューアを左、デジカルを右に並べる
    const me = await chrome.windows.getCurrent();
    const left = screen.availLeft ?? 0;
    const top = screen.availTop ?? 0;
    const height = screen.availHeight;
    const viewerWidth = Math.min(Math.max(me.width || this.width, 360), Math.floor(screen.availWidth / 2));
    try {
      await chrome.windows.update(me.id, { state: 'normal' });
      await chrome.windows.update(me.id, { left, top, width: viewerWidth, height });
    } catch { /* 位置合わせに失敗しても続ける */ }
    let win;
    try {
      win = await chrome.windows.create({
        url, type: 'normal', focused: false,
        left: left + viewerWidth, top, width: screen.availWidth - viewerWidth, height,
      });
    } catch {
      // 画面の構成によっては位置指定が拒否されるので、そのときは位置なしで開く
      win = await chrome.windows.create({ url, type: 'normal', focused: false });
    }
    await chrome.storage.session.set({ [SESSION_KEY]: { windowId: win.id, tabId: win.tabs[0].id } });
  }
}

export function createKarteView(mode, container) {
  return mode === 'window' ? new WindowView() : new IframeView(container);
}
