// 「一括で済」の条件。chrome API に依存しない。
//
// 条件（rule）の形：{ id, text, auto }
//   text … この文字列を「チェック内容・保険・チェック区分」のどれかに含む行が対象（全角／半角の違いは無視）
//   auto … true なら、一覧を読み込むたびに自動で済にする（その行は「要再確認」にしない）

export const DEFAULT_RULES = [
  { id: 'no-payer', text: '公費(負担者番号なし)', auto: true },
];

/** 全角英数・記号を半角に、連続する空白を1つにそろえる */
export function normalize(s) {
  return (s || '').normalize('NFKC').replace(/\s+/g, ' ').trim().toLowerCase();
}

export function matchesText(row, text) {
  const t = normalize(text);
  if (!t) return false;
  return normalize(`${row.content} ${row.insurance} ${row.category}`).includes(t);
}

export function matchesRule(row, rule) {
  return matchesText(row, rule.text);
}

/**
 * 読み込み直後の記録に「自動で済」の条件を当てる。record と summary を書き換え、済にした件数を返す。
 * 前回済にしていて今回も残った行は本来「要再確認」になるが、自動で済の条件に合う行は「継続」に戻す。
 */
export function applyAutoDone(record, summary, rules) {
  const autoRules = (rules || []).filter((r) => r.auto && normalize(r.text));
  let count = 0;
  for (const row of record.rows) {
    if (!autoRules.some((r) => matchesRule(row, r))) continue;
    if (!record.done[row.key]) { record.done[row.key] = true; count++; }
    if (row.status === 'recheck') {
      row.status = 'cont';
      if (summary && summary.recheck > 0) summary.recheck--;
    }
  }
  if (summary) summary.autoDone = count;
  return count;
}

/** 新しい条件の id */
export function newRuleId() {
  return `r${Date.now().toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`;
}
