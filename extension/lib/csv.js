// CSV の読み込み（文字コード判定とパース）。chrome API に依存しない。

/**
 * バイト列を文字列にする。
 * UTF-8（BOM あり／なし）として正しく読めればそれを使い、だめなら Shift_JIS（CP932）として読む。
 * デジカルの実ファイルは Shift_JIS・BOM なし。
 */
export function decodeBytes(buffer) {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return new TextDecoder('utf-8').decode(bytes.subarray(3));
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder('shift_jis').decode(bytes);
  }
}

/**
 * RFC4180 形式の CSV をパースして、行（文字列の配列）の配列を返す。
 * - クォートあり・なし両方に対応（クォート内のカンマ・改行・"" も可）
 * - 改行は CRLF / LF / CR のどれでもよい
 * - 空行（すべてのセルが空）は捨てる
 * - 列数は行ごとにばらばらでもよい（そのまま返す）
 */
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let inQuotes = false;
  let i = 0;
  const n = text.length;

  const endCell = () => { row.push(cell); cell = ''; };
  const endRow = () => {
    endCell();
    if (row.some((c) => c.trim() !== '')) rows.push(row);
    row = [];
  };

  while (i < n) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { cell += '"'; i += 2; continue; }
        inQuotes = false; i++; continue;
      }
      cell += ch; i++; continue;
    }
    if (ch === '"' && cell === '') { inQuotes = true; i++; continue; }
    if (ch === ',') { endCell(); i++; continue; }
    if (ch === '\r') { endRow(); i += text[i + 1] === '\n' ? 2 : 1; continue; }
    if (ch === '\n') { endRow(); i++; continue; }
    cell += ch; i++;
  }
  if (cell !== '' || row.length > 0) endRow();
  return rows;
}
