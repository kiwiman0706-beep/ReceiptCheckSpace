// ビューア画面
import { decodeBytes } from './lib/csv.js';
import { parseReceiptCsv, ymLabel, comparePatientNo, ReceiptFormatError } from './lib/receipt.js';
import { applyReload, summaryText, isSameList, isOlderThan } from './lib/diff.js';
import * as store from './lib/store.js';
import { createKarteView } from './lib/karte.js';
import { extractCsvFiles, needsPassword, ZipError, ZipPasswordError } from './lib/zip.js';
import { parseExportedAt } from './lib/receipt.js';

const $ = (id) => document.getElementById(id);
const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
};

const state = {
  settings: null,
  rec: null,          // 表示中の月の記録
  lastSummary: null,  // 直近に読み込んだときの要約（この画面を開いている間だけ）
  collapsedGroups: new Set(),
  visibleKeys: [],    // 画面に出ている行（キーボード移動用）
  karte: null,
};

const STATUS_LABEL = { new: '新規', cont: '継続', recheck: '要再確認' };

// ---------------------------------------------------------------- 起動
async function init() {
  state.settings = await store.getSettings();
  if (state.settings.autoDelete) {
    const removed = await store.deleteOlderThan(state.settings.autoDeleteDays);
    if (removed.length) toast(`古いデータを削除しました：${removed.map(ymLabel).join('、')}`);
  }
  applyLayoutSettings();
  state.karte = createKarteView();
  bindEvents();

  const idx = await store.getIndex();
  const ym = idx.current || Object.keys(idx.months).sort().pop();
  if (ym) state.rec = await store.getMonth(ym);
  await renderMonthSelect();
  renderAll();
  if (state.rec?.lastSelected) selectRow(state.rec.lastSelected, { scroll: true });
  $('list').focus();
}

function applyLayoutSettings() {
  const s = state.settings;
  $('stateFilter').value = s.stateFilter;
  $('sortSelect').value = s.sort;
  $('groupToggle').checked = !!s.groupByPatient;
}

async function saveSettings(patch) {
  Object.assign(state.settings, patch);
  await store.saveSettings(state.settings);
}

// ---------------------------------------------------------------- 読み込み
async function loadFiles(fileList) {
  const files = [...fileList].sort((a, b) => a.name.localeCompare(b.name));
  for (const f of files) {
    // eslint-disable-next-line no-await-in-loop
    await loadFile(f);
  }
}

async function loadFile(file) {
  if (/\.pdf$/i.test(file.name)) {
    toast('PDFには未対応です。同じ一覧のCSVファイルを読み込んでください。', true);
    return;
  }
  if (/\.zip$/i.test(file.name)) {
    const csvs = await openZip(file);
    for (const c of csvs) {
      // eslint-disable-next-line no-await-in-loop
      await loadCsvBytes(c.bytes, c.name);
    }
    return;
  }
  await loadCsvBytes(new Uint8Array(await file.arrayBuffer()), file.name);
}

/**
 * パスワード付き ZIP から CSV を取り出す。記憶したパスワードで開けなければ入力してもらう。
 * 戻り値：[{ name, bytes }]（キャンセル・失敗なら空）
 */
async function openZip(file) {
  let buf;
  try {
    buf = new Uint8Array(await file.arrayBuffer());
    let files;
    if (!needsPassword(buf)) {
      files = await extractCsvFiles(buf);
    } else {
      let pw = await store.getZipPassword();
      let reason = pw ? '' : 'ZIPのパスワードを入力してください。';
      let remember = false;
      for (;;) {
        if (!pw) {
          // eslint-disable-next-line no-await-in-loop
          const ans = await askPassword(file.name, reason);
          if (!ans) return [];
          ({ password: pw, remember } = ans);
        }
        try {
          // eslint-disable-next-line no-await-in-loop
          files = await extractCsvFiles(buf, pw);
          // eslint-disable-next-line no-await-in-loop
          if (remember) { await store.saveZipPassword(pw); toast('パスワードを記憶しました'); }
          break;
        } catch (e) {
          if (!(e instanceof ZipPasswordError)) throw e;
          pw = '';
          reason = 'パスワードが違います。もう一度入力してください。';
        }
      }
    }
    if (files.length === 0) {
      toast('ZIPの中にCSVファイルがありませんでした。', true);
      return [];
    }
    // 中のCSVの名前に出力日時がなければ、ZIPの名前から取る
    return files.map((f) => ({ ...f, name: parseExportedAt(f.name) ? f.name : file.name.replace(/\.zip$/i, '.csv') }));
  } catch (e) {
    toast(e instanceof ZipError ? e.message : `ZIPを開けませんでした：${e.message}`, true);
    return [];
  }
}

function askPassword(fileName, reason) {
  const dlg = $('pwDialog');
  $('pwFile').textContent = fileName;
  $('pwReason').textContent = reason;
  $('pwAsk').value = '';
  $('pwRemember').checked = true;
  dlg.returnValue = '';
  dlg.showModal();
  $('pwAsk').focus();
  return new Promise((resolve) => {
    dlg.addEventListener('close', () => {
      const password = $('pwAsk').value;
      $('pwAsk').value = '';
      resolve(dlg.returnValue === 'ok' && password ? { password, remember: $('pwRemember').checked } : null);
      $('list').focus({ preventScroll: true });
    }, { once: true });
  });
}

async function loadCsvBytes(bytes, fileName) {
  const file = { name: fileName };
  let parsed;
  try {
    parsed = parseReceiptCsv(decodeBytes(bytes), file.name);
  } catch (e) {
    toast(e instanceof ReceiptFormatError ? e.message : `読み込めませんでした：${e.message}`, true);
    return;
  }
  const ym = parsed.ym || state.rec?.ym;
  if (!ym) {
    toast('診療年月がわかりませんでした。デジカルが出力したCSVか確認してください。', true);
    return;
  }
  const prev = await store.getMonth(ym);
  if (isSameList(prev, parsed)) {
    state.rec = prev;
    await store.setCurrent(ym);
    await renderMonthSelect();
    renderAll();
    toast('前回と同じ一覧です（変更はありません）');
    return;
  }
  if (isOlderThan(prev, parsed)
    && !window.confirm(`前回読み込んだ一覧（${fmtExported(prev.exportedAt)}）より古い一覧（${fmtExported(parsed.exportedAt)}）です。読み込みますか？`)) {
    return;
  }
  const { record, summary } = applyReload(prev, parsed, ym);
  await store.saveMonth(record, { makeCurrent: true });
  state.rec = record;
  state.lastSummary = summary;
  state.collapsedGroups.clear();
  await renderMonthSelect();
  renderAll();
  const warn = parsed.warnings.length ? `（注意 ${parsed.warnings.length}件：${parsed.warnings[0]}${parsed.warnings.length > 1 ? ' ほか' : ''}）` : '';
  toast(`${ymLabel(ym)}分を読み込みました。${summary.count === 0 && !summary.first ? 'すべて解消しました。' : summaryText(summary)}${warn}`);
  if (record.lastSelected) selectRow(record.lastSelected, { scroll: true });
}

function fmtExported(s) {
  if (!s) return '出力日時不明';
  const [d, t] = s.split('T');
  const [y, m, dd] = d.split('-');
  return `${y}/${Number(m)}/${Number(dd)} ${t}`;
}

// ---------------------------------------------------------------- 保存
let saveTimer = null;
function saveRecordSoon() {
  clearTimeout(saveTimer);
  const rec = state.rec;
  saveTimer = setTimeout(() => store.saveMonth(rec), 300);
}
function saveRecordNow() {
  clearTimeout(saveTimer);
  if (state.rec) return store.saveMonth(state.rec);
  return null;
}
window.addEventListener('pagehide', () => { saveRecordNow(); });

// ---------------------------------------------------------------- 描画
async function renderMonthSelect() {
  const idx = await store.getIndex();
  const months = Object.keys(idx.months).sort().reverse();
  const sel = $('monthSelect');
  sel.replaceChildren(...months.map((ym) => {
    const o = el('option', null, `${ymLabel(ym)}分`);
    o.value = ym;
    return o;
  }));
  sel.value = state.rec?.ym || '';
  sel.hidden = months.length < 2;
  $('monthTitle').hidden = months.length >= 2;
  $('monthTitle').textContent = state.rec ? `${ymLabel(state.rec.ym)}分` : '一覧が読み込まれていません';
}

function renderAll() {
  renderFilterOptions();
  renderSummary();
  renderList();
  renderFooter();
  renderMemo();
}

function fillSelect(select, values, allLabel = 'すべて') {
  const cur = select.value;
  const opts = [el('option', null, allLabel)];
  opts[0].value = '';
  for (const v of values) {
    const o = el('option', null, v);
    o.value = v;
    opts.push(o);
  }
  select.replaceChildren(...opts);
  select.value = values.includes(cur) ? cur : '';
}

function renderFilterOptions() {
  const rows = state.rec?.rows || [];
  const uniq = (arr) => [...new Set(arr.filter(Boolean))];
  fillSelect($('categoryFilter'), uniq(rows.map((r) => r.category)));
  fillSelect($('doctorFilter'), uniq(rows.map((r) => r.doctorName)).sort((a, b) => a.localeCompare(b, 'ja')));
  fillSelect($('insuranceFilter'), uniq(rows.flatMap((r) => r.insuranceList)).sort((a, b) => a.localeCompare(b, 'ja')), 'すべて（含む）');
}

function renderSummary() {
  const box = $('summary');
  box.replaceChildren();
  const rec = state.rec;
  if (!rec) {
    box.textContent = 'デジカルの「要確認レセプト一覧」（CSV、またはパスワード付きZIPのまま）をこの画面にドロップするか、「ファイルを選択」で読み込んでください。';
    return;
  }
  const last = state.lastSummary || rec.history.at(-1)?.summary;
  const line1 = el('div', null, `${fmtExported(rec.exportedAt)} 出力分`);
  box.append(line1);
  if (last) {
    const s = { ...last };
    const t = el('div');
    if (!s.first && s.recheck > 0) {
      t.append(`前回 ${s.prevCount}件 → 今回 ${s.count}件（解消 ${s.resolved}／継続 ${s.cont}／新規 ${s.added}）。`);
      t.append(el('span', 'warn', `済にしたのに残っている行：${s.recheck}件`));
    } else {
      t.textContent = summaryText(s);
    }
    box.append(t);
  }
}

function rowState(r) { return state.rec.done[r.key] ? 'done' : 'todo'; }

function filteredRows() {
  const rec = state.rec;
  if (!rec) return [];
  const q = $('search').value.trim().toLowerCase();
  const st = $('stateFilter').value;
  const diff = $('diffFilter').value;
  const cat = $('categoryFilter').value;
  const doc = $('doctorFilter').value;
  const ins = $('insuranceFilter').value;
  return rec.rows.filter((r) => {
    if (st !== 'all' && rowState(r) !== st) return false;
    if (diff && r.status !== diff) return false;
    if (cat && r.category !== cat) return false;
    if (doc && r.doctorName !== doc) return false;
    if (ins && !r.insuranceList.includes(ins)) return false;
    if (q) {
      const hay = `${r.patientNo} ${r.name} ${r.name.replace(/[\s　]/g, '')} ${r.content} ${rec.memos[r.karteId] || ''}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

const byDate = (a, b) => a.ymd.localeCompare(b.ymd);
function comparator(sort) {
  switch (sort) {
    case 'name': return (a, b) => a.name.localeCompare(b.name, 'ja') || comparePatientNo(a.patientNo, b.patientNo) || byDate(a, b);
    case 'date': return (a, b) => byDate(a, b) || comparePatientNo(a.patientNo, b.patientNo);
    case 'category': return (a, b) => a.category.localeCompare(b.category, 'ja') || comparePatientNo(a.patientNo, b.patientNo) || byDate(a, b);
    case 'state': {
      const rank = (r) => (r.status === 'recheck' && rowState(r) === 'todo' ? 0 : rowState(r) === 'todo' ? 1 : 2);
      return (a, b) => rank(a) - rank(b) || comparePatientNo(a.patientNo, b.patientNo) || byDate(a, b);
    }
    default: return (a, b) => comparePatientNo(a.patientNo, b.patientNo) || byDate(a, b);
  }
}

function renderList() {
  const list = $('list');
  const scroll = list.scrollTop;
  list.replaceChildren();
  state.visibleKeys = [];
  const rec = state.rec;

  if (!rec) {
    list.append(el('div', 'empty', 'まだ一覧がありません。\nCSVかZIPファイルをドロップしてください。'));
    renderCounts([]);
    return;
  }
  if (rec.rows.length === 0) {
    const e = el('div', 'empty all-clear', 'すべて解消しました 🎉');
    list.append(e);
    renderCounts([]);
    return;
  }

  const rows = filteredRows().sort(comparator($('sortSelect').value));
  renderCounts(rows);
  if (rows.length === 0) {
    list.append(el('div', 'empty', '条件に合う行はありません。'));
    return;
  }

  if ($('groupToggle').checked) {
    const groups = new Map();
    for (const r of rows) {
      if (!groups.has(r.karteId)) groups.set(r.karteId, []);
      groups.get(r.karteId).push(r);
    }
    const frag = document.createDocumentFragment();
    for (const [karteId, gRows] of groups) {
      frag.append(renderGroup(karteId, gRows));
    }
    list.append(frag);
  } else {
    const frag = document.createDocumentFragment();
    for (const r of rows) {
      frag.append(renderRow(r, true));
      state.visibleKeys.push(r.key);
    }
    list.append(frag);
  }
  list.scrollTop = scroll;
}

function renderCounts(shown) {
  const rec = state.rec;
  if (!rec || rec.rows.length === 0) { $('counts').textContent = ''; return; }
  const total = rec.rows.length;
  const done = rec.rows.filter((r) => rec.done[r.key]).length;
  const patients = new Set(rec.rows.map((r) => r.karteId)).size;
  const recheck = rec.rows.filter((r) => r.status === 'recheck' && !rec.done[r.key]).length;
  let t = `全${total}件（患者${patients}人）　未${total - done}／済${done}`;
  if (recheck) t += `　要再確認（未）${recheck}`;
  if (shown.length !== total) t += `　表示中 ${shown.length}件`;
  $('counts').textContent = t;
}

function renderGroup(karteId, rows) {
  const rec = state.rec;
  const allRows = rec.rows.filter((r) => r.karteId === karteId);
  const doneCount = allRows.filter((r) => rec.done[r.key]).length;
  const allDone = doneCount === allRows.length;
  const open = !state.collapsedGroups.has(karteId);
  const first = rows[0];

  const g = el('div', `group${allDone ? ' all-done' : ''}`);
  g.dataset.karteId = karteId;
  const head = el('div', 'group-head');
  head.append(el('span', 'arrow', open ? '▼' : '▶'));
  head.append(el('span', 'pno', first.patientNo));
  head.append(el('span', 'pname', first.name));
  head.append(el('span', 'gcount', `未${allRows.length - doneCount}/${allRows.length}`));
  const memo = rec.memos[karteId];
  if (memo) {
    const mi = el('span', 'memo-icon', '📝');
    mi.title = memo;
    head.append(mi);
  }
  head.append(el('span', 'spacer'));
  const allBtn = el('button', 'btn', allDone ? '全て未に戻す' : '全て済');
  allBtn.title = 'この患者の行をまとめて切り替える';
  allBtn.addEventListener('click', (ev) => {
    ev.stopPropagation();
    for (const r of allRows) {
      if (allDone) delete rec.done[r.key]; else rec.done[r.key] = true;
    }
    saveRecordSoon();
    renderList();
    $('list').focus();
  });
  head.append(allBtn);
  head.addEventListener('click', () => {
    if (open) state.collapsedGroups.add(karteId); else state.collapsedGroups.delete(karteId);
    renderList();
  });
  g.append(head);

  if (open) {
    if (memo) g.append(el('div', 'group-memo', memo));
    for (const r of rows) {
      g.append(renderRow(r, false));
      state.visibleKeys.push(r.key);
    }
  }
  return g;
}

function categoryClass(cat) {
  if (cat === '公費') return 'cat-kohi';
  if (cat === '適応症') return 'cat-tekio';
  return 'cat-other';
}

function shortInsurance(r) {
  const list = r.insuranceList;
  if (list.length <= 2) return list.join(' ');
  return `${list.slice(0, 2).join(' ')} 他${list.length - 2}`;
}

function renderRow(r, flat) {
  const rec = state.rec;
  const done = !!rec.done[r.key];
  const row = el('div', 'row');
  row.dataset.key = r.key;
  row.setAttribute('role', 'option');
  if (done) row.classList.add('done');
  if (r.status === 'recheck') row.classList.add('recheck');
  if (rec.lastSelected === r.key) row.classList.add('selected');

  const cb = el('input');
  cb.type = 'checkbox';
  cb.checked = done;
  cb.title = '済';
  cb.addEventListener('click', (ev) => {
    ev.stopPropagation();
    toggleDone(r.key);
  });
  row.append(cb);
  row.append(el('span', 'date', r.date));

  const badges = el('span', 'badges');
  badges.append(el('span', `badge ${categoryClass(r.category)}`, r.category || '—'));
  if (r.status === 'new') badges.append(el('span', 'badge new', 'NEW'));
  if (r.status === 'recheck') {
    const b = el('span', 'badge recheck', '要再確認');
    b.title = '前回「済」にしたのに、今回の一覧にもまだ出ています';
    badges.append(b);
  }
  row.append(badges);

  const content = el('span', 'content', r.content);
  content.title = r.content;
  row.append(content);

  const sub = el('span', 'sub');
  if (flat) {
    sub.append(el('span', 'who', `${r.patientNo} ${r.name}`));
    if (rec.memos[r.karteId]) {
      const mi = el('span', 'memo-icon', '📝 ');
      mi.title = rec.memos[r.karteId];
      sub.append(mi);
    }
  }
  sub.append(shortInsurance(r));
  sub.title = `${r.insurance}\n${r.deptName}　${r.doctorName}`;
  row.append(sub);

  row.addEventListener('click', () => {
    selectRow(r.key);
    $('list').focus({ preventScroll: true });
  });
  return row;
}

function renderFooter() {
  const rec = state.rec;
  const resolved = rec?.resolved || [];
  $('resolvedTitle').textContent = `解消済み ${resolved.length}件（直近の読み込み）`;
  $('resolvedBox').hidden = !rec || rec.history.length < 2;
  $('resolvedList').replaceChildren(...resolved
    .slice().sort((a, b) => comparePatientNo(a.patientNo, b.patientNo) || byDate(a, b))
    .map((r) => {
      const d = el('div', 'item', `${r.patientNo} ${r.name}　${r.date}　${r.category}：${r.content}`);
      d.title = d.textContent;
      return d;
    }));
  $('historyBox').hidden = !rec;
  $('historyList').replaceChildren(...(rec?.history || []).slice().reverse().map((h) => {
    const at = new Date(h.at);
    const d = el('div', 'item',
      `${at.toLocaleString('ja-JP')} 読み込み　${h.fileName || '(名前なし)'}　${h.count}件`);
    d.title = summaryText(h.summary);
    return d;
  }));
}

// ---------------------------------------------------------------- 選択・済・メモ
function selectedRow() {
  const rec = state.rec;
  if (!rec || !rec.lastSelected) return null;
  return rec.rows.find((r) => r.key === rec.lastSelected) || null;
}

function selectRow(key, { scroll = true } = {}) {
  const rec = state.rec;
  const r = rec?.rows.find((x) => x.key === key);
  if (!r) return;
  rec.lastSelected = key;
  saveRecordSoon();
  for (const e of document.querySelectorAll('.row.selected')) e.classList.remove('selected');
  const rowEl = document.querySelector(`.row[data-key="${CSS.escape(key)}"]`);
  if (rowEl) {
    rowEl.classList.add('selected');
    if (scroll) rowEl.scrollIntoView({ block: 'nearest' });
  }
  showKarte(r);
  renderMemo();
}

function showKarte(r) {
  if (!r.url) return;
  state.karte.show(r.url).catch((e) => toast(`カルテを開けませんでした：${e.message}`, true));
}

function toggleDone(key) {
  const rec = state.rec;
  if (rec.done[key]) delete rec.done[key]; else rec.done[key] = true;
  saveRecordSoon();
  renderList();
}

function moveSelection(delta) {
  const keys = state.visibleKeys;
  if (keys.length === 0) return;
  const cur = keys.indexOf(state.rec.lastSelected);
  const next = cur < 0 ? (delta > 0 ? 0 : keys.length - 1) : Math.min(keys.length - 1, Math.max(0, cur + delta));
  if (next !== cur) selectRow(keys[next]);
}

function renderMemo() {
  const r = selectedRow();
  const panel = $('memoPanel');
  if (!r) { panel.hidden = true; return; }
  panel.hidden = false;
  $('memoWho').textContent = `${r.patientNo} ${r.name}`;
  const ta = $('memoText');
  ta.dataset.karteId = r.karteId;
  if (document.activeElement !== ta) ta.value = state.rec.memos[r.karteId] || '';
}

function onMemoInput() {
  const ta = $('memoText');
  const id = ta.dataset.karteId;
  if (!id || !state.rec) return;
  const v = ta.value;
  if (v.trim()) state.rec.memos[id] = v; else delete state.rec.memos[id];
  saveRecordSoon();
}

// ---------------------------------------------------------------- トースト
let toastTimer = null;
function toast(msg, isError = false) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.toggle('error', isError);
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, isError ? 8000 : 5000);
}

// ---------------------------------------------------------------- イベント
function bindEvents() {
  $('openFileBtn').addEventListener('click', () => $('fileInput').click());
  $('fileInput').addEventListener('change', async (ev) => {
    await loadFiles(ev.target.files);
    ev.target.value = '';
  });

  // ドラッグ＆ドロップ（画面のどこでも）
  let dragDepth = 0;
  const hasFiles = (ev) => [...(ev.dataTransfer?.types || [])].includes('Files');
  document.addEventListener('dragenter', (ev) => {
    if (!hasFiles(ev)) return;
    ev.preventDefault();
    dragDepth++;
    $('dropOverlay').hidden = false;
  });
  document.addEventListener('dragover', (ev) => { if (hasFiles(ev)) ev.preventDefault(); });
  const endDrag = () => {
    dragDepth = 0;
    $('dropOverlay').hidden = true;
  };
  document.addEventListener('dragleave', () => { dragDepth--; if (dragDepth <= 0) endDrag(); });
  document.addEventListener('drop', async (ev) => {
    ev.preventDefault();
    endDrag();
    if (ev.dataTransfer?.files?.length) await loadFiles(ev.dataTransfer.files);
  });

  for (const id of ['search', 'diffFilter', 'categoryFilter', 'doctorFilter', 'insuranceFilter']) {
    $(id).addEventListener(id === 'search' ? 'input' : 'change', () => renderList());
  }
  $('stateFilter').addEventListener('change', (ev) => { saveSettings({ stateFilter: ev.target.value }); renderList(); });
  $('sortSelect').addEventListener('change', (ev) => { saveSettings({ sort: ev.target.value }); renderList(); });
  $('groupToggle').addEventListener('change', (ev) => { saveSettings({ groupByPatient: ev.target.checked }); renderList(); });

  $('monthSelect').addEventListener('change', async (ev) => {
    await saveRecordNow();
    state.rec = await store.getMonth(ev.target.value);
    state.lastSummary = null;
    state.collapsedGroups.clear();
    await store.setCurrent(ev.target.value);
    await renderMonthSelect();
    renderAll();
    if (state.rec?.lastSelected) selectRow(state.rec.lastSelected);
  });

  $('memoText').addEventListener('input', onMemoInput);
  $('memoText').addEventListener('blur', () => { saveRecordNow(); renderList(); });

  $('arrangeBtn').addEventListener('click', async () => {
    const r = selectedRow();
    try {
      await state.karte.arrange(r?.url);
    } catch (e) {
      toast(`ウインドウを並べられませんでした：${e.message}`, true);
    }
    $('list').focus({ preventScroll: true });
  });

  // 設定
  const dlg = $('settingsDialog');
  $('settingsBtn').addEventListener('click', () => {
    $('autoDelete').checked = !!state.settings.autoDelete;
    renderPasswordState();
    $('deleteMonthBtn').disabled = !state.rec;
    $('deleteMonthBtn').textContent = state.rec ? `${ymLabel(state.rec.ym)}分のデータを削除` : 'この月のデータを削除';
    dlg.showModal();
  });
  $('pwSaveBtn').addEventListener('click', savePasswordFromSettings);
  $('pwInput').addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter') { ev.preventDefault(); savePasswordFromSettings(); }
  });
  $('pwClearBtn').addEventListener('click', async () => {
    await store.saveZipPassword('');
    renderPasswordState();
    toast('ZIPのパスワードを消去しました');
  });
  $('autoDelete').addEventListener('change', (ev) => saveSettings({ autoDelete: ev.target.checked }));
  $('deleteMonthBtn').addEventListener('click', async () => {
    const rec = state.rec;
    if (!rec || !window.confirm(`${ymLabel(rec.ym)}分の一覧・済・メモをすべて削除します。よろしいですか？`)) return;
    clearTimeout(saveTimer);
    await store.deleteMonth(rec.ym);
    const idx = await store.getIndex();
    state.rec = idx.current ? await store.getMonth(idx.current) : null;
    state.lastSummary = null;
    await renderMonthSelect();
    renderAll();
    dlg.close();
    toast(`${ymLabel(rec.ym)}分のデータを削除しました`);
  });
  $('deleteAllBtn').addEventListener('click', async () => {
    if (!window.confirm('すべての月の一覧・済・メモを削除します。よろしいですか？')) return;
    clearTimeout(saveTimer);
    await store.deleteAll();
    state.rec = null;
    state.lastSummary = null;
    await renderMonthSelect();
    renderAll();
    dlg.close();
    toast('すべてのデータを削除しました');
  });

  // 選択肢を選んだら一覧にフォーカスを戻す（キーボード操作を続けられるように）
  for (const sel of $('left').querySelectorAll('select, input[type=checkbox]')) {
    sel.addEventListener('change', () => $('list').focus({ preventScroll: true }));
  }

  document.addEventListener('keydown', onKeyDown);
}

async function renderPasswordState() {
  const pw = await store.getZipPassword();
  $('pwState').textContent = pw ? '記憶しています（●●●●）。変えるときは新しいパスワードを入れて「記憶する」。' : 'まだ記憶していません。';
  $('pwClearBtn').disabled = !pw;
}

async function savePasswordFromSettings() {
  const v = $('pwInput').value;
  if (!v) { toast('パスワードを入力してください', true); return; }
  await store.saveZipPassword(v);
  $('pwInput').value = '';
  renderPasswordState();
  toast('ZIPのパスワードを記憶しました');
}

function onKeyDown(ev) {
  const t = ev.target;
  const typing = /^(INPUT|SELECT|TEXTAREA)$/.test(t.tagName) && t.type !== 'checkbox';
  if (ev.key === 'Escape' && typing) { t.blur(); $('list').focus(); return; }
  if (typing || ev.ctrlKey || ev.metaKey || ev.altKey || $('settingsDialog').open || $('pwDialog').open) return;
  if (!state.rec) return;
  switch (ev.key) {
    case 'ArrowDown': ev.preventDefault(); moveSelection(1); break;
    case 'ArrowUp': ev.preventDefault(); moveSelection(-1); break;
    case ' ':
      if (state.rec.lastSelected) { ev.preventDefault(); toggleDone(state.rec.lastSelected); }
      break;
    case 'm': case 'M':
      if (selectedRow()) {
        ev.preventDefault();
        $('memoText').focus();
      }
      break;
    default: break;
  }
}

init().catch((e) => {
  console.error(e);
  toast(`起動に失敗しました：${e.message}`, true);
});
