// 再読み込み時の差分判定（SPEC 4章）。chrome API に依存しない。
//
// 月ごとの記録（record）の形：
// {
//   ym, fileName, exportedAt, loadedAt,
//   rows: [行データ + status],   status: '' (初回) | 'new' | 'cont' | 'recheck'
//   done: { [key]: true },        済にした行
//   memos: { [karteId]: string }, 患者メモ
//   resolved: [行データ],         直近の読み込みで解消した行
//   history: [{ at, fileName, exportedAt, count, summary }],
//   lastSelected: key | null,
// }

export function emptyRecord(ym) {
  return {
    ym, fileName: '', exportedAt: null, loadedAt: 0,
    rows: [], done: {}, memos: {}, resolved: [], history: [], lastSelected: null,
  };
}

/** 前回と同じファイルを読み込み直しただけか */
export function isSameList(prev, parsed) {
  if (!prev || !prev.loadedAt) return false;
  if (prev.rows.length !== parsed.rows.length) return false;
  const sameSource = (prev.fileName && prev.fileName === parsed.fileName)
    || (prev.exportedAt && prev.exportedAt === parsed.exportedAt);
  if (!sameSource) return false;
  const keys = new Set(prev.rows.map((r) => r.key));
  return parsed.rows.every((r) => keys.has(r.key));
}

/** 前回より古い出力日時のファイルか */
export function isOlderThan(prev, parsed) {
  return !!(prev && prev.exportedAt && parsed.exportedAt && parsed.exportedAt < prev.exportedAt);
}

/**
 * 新しい一覧を前回の記録に重ねる。
 * prev が null（またはまだ読み込んだことがない）なら初回読み込み。
 * 戻り値: { record, summary }
 */
export function applyReload(prev, parsed, ym, now = Date.now()) {
  const base = prev && prev.loadedAt ? prev : null;
  const record = emptyRecord(ym);
  record.fileName = parsed.fileName;
  record.exportedAt = parsed.exportedAt;
  record.loadedAt = now;
  record.memos = { ...(prev?.memos || {}) };
  record.history = [...(prev?.history || [])];
  const patients = new Set(parsed.rows.map((r) => r.karteId)).size;

  let summary;
  if (!base) {
    record.rows = parsed.rows.map((r) => ({ ...r, status: '' }));
    summary = { first: true, prevCount: 0, count: record.rows.length, patients,
      resolved: 0, cont: 0, added: 0, recheck: 0 };
  } else {
    const prevByKey = new Map(base.rows.map((r) => [r.key, r]));
    const nowKeys = new Set(parsed.rows.map((r) => r.key));
    let cont = 0, added = 0, recheck = 0;
    record.rows = parsed.rows.map((r) => {
      const old = prevByKey.get(r.key);
      if (!old) { added++; return { ...r, status: 'new' }; }
      cont++;
      if (base.done[r.key]) { recheck++; return { ...r, status: 'recheck' }; }
      // 前回「要再確認」でまだ済にしていない行は、そのまま要再確認として残す
      if (old.status === 'recheck') return { ...r, status: 'recheck' };
      return { ...r, status: 'cont' };
    });
    // 済は「今回も残っていて、要再確認にならなかった行」…は存在しない（済だった行はすべて要再確認になる）ため、
    // 新しい記録の済は空から始める。
    record.done = {};
    record.resolved = base.rows.filter((r) => !nowKeys.has(r.key)).map((r) => ({ ...r, wasDone: !!base.done[r.key] }));
    summary = { first: false, prevCount: base.rows.length, count: record.rows.length, patients,
      resolved: record.resolved.length, cont, added, recheck };
  }

  if (record.lastSelected == null && prev?.lastSelected && record.rows.some((r) => r.key === prev.lastSelected)) {
    record.lastSelected = prev.lastSelected;
  }
  record.history.push({ at: now, fileName: parsed.fileName, exportedAt: parsed.exportedAt,
    count: record.rows.length, summary });
  return { record, summary };
}

/** 要約の文言 */
export function summaryText(s) {
  if (!s) return '';
  if (s.first) {
    if (s.count === 0) return '要確認の行はありません';
    return `初回読み込み：${s.count}件（患者${s.patients}人）${s.autoDone > 0 ? `（自動で済 ${s.autoDone}件）` : ''}`;
  }
  let t = `前回 ${s.prevCount}件 → 今回 ${s.count}件（解消 ${s.resolved}／継続 ${s.cont}／新規 ${s.added}）`;
  if (s.recheck > 0) t += `。済にしたのに残っている行：${s.recheck}件`;
  if (s.autoDone > 0) t += `（自動で済 ${s.autoDone}件）`;
  return t;
}
