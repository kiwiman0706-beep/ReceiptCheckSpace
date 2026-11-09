// 保存（chrome.storage.local のみ。外部には送らない）
import { emptyRecord } from './diff.js';

const INDEX = 'rv:index';
const SETTINGS = 'rv:settings';
const monthKey = (ym) => `rv:month:${ym}`;

export const DEFAULT_SETTINGS = {
  groupByPatient: true,
  sort: 'patientNo',
  stateFilter: 'all',      // 'all' | 'todo' | 'done'
  autoDelete: false,       // 古い月を自動削除
  autoDeleteDays: 90,
};

const local = () => chrome.storage.local;

export async function getSettings() {
  const { [SETTINGS]: s } = await local().get(SETTINGS);
  return { ...DEFAULT_SETTINGS, ...(s || {}) };
}

export async function saveSettings(s) {
  await local().set({ [SETTINGS]: s });
}

/** { months: { [ym]: { updatedAt, count } }, current: ym|null } */
export async function getIndex() {
  const { [INDEX]: idx } = await local().get(INDEX);
  return { months: {}, current: null, ...(idx || {}) };
}

async function saveIndex(idx) {
  await local().set({ [INDEX]: idx });
}

export async function getMonth(ym) {
  const { [monthKey(ym)]: rec } = await local().get(monthKey(ym));
  return rec ? { ...emptyRecord(ym), ...rec } : null;
}

export async function saveMonth(rec, { makeCurrent = false } = {}) {
  const idx = await getIndex();
  idx.months[rec.ym] = { updatedAt: Date.now(), count: rec.rows.length };
  if (makeCurrent) idx.current = rec.ym;
  await local().set({ [monthKey(rec.ym)]: rec, [INDEX]: idx });
}

export async function setCurrent(ym) {
  const idx = await getIndex();
  idx.current = ym;
  await saveIndex(idx);
}

export async function deleteMonth(ym) {
  const idx = await getIndex();
  delete idx.months[ym];
  if (idx.current === ym) idx.current = Object.keys(idx.months).sort().pop() || null;
  await local().remove(monthKey(ym));
  await saveIndex(idx);
}

/** 一覧データをすべて消す（設定は残す） */
export async function deleteAll() {
  const idx = await getIndex();
  await local().remove([INDEX, ...Object.keys(idx.months).map(monthKey)]);
}

/** 最後の更新から days 日以上たった月を消す。消した月の配列を返す */
export async function deleteOlderThan(days, now = Date.now()) {
  const idx = await getIndex();
  const limit = now - days * 24 * 60 * 60 * 1000;
  const old = Object.entries(idx.months).filter(([, m]) => m.updatedAt < limit).map(([ym]) => ym);
  for (const ym of old) await deleteMonth(ym);
  return old;
}
