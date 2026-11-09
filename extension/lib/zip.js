// パスワード付き ZIP からファイルを取り出す。chrome API に依存しない（Node 22 でもテストできる）。
//
// 対応：
//   - 暗号化なし／ZipCrypto（従来の ZIP 暗号）／WinZip AES（AES-128/192/256, AE-1/AE-2）
//   - 圧縮なし（stored）／deflate
// 外部ライブラリは使わず、AES・PBKDF2・HMAC は WebCrypto、展開は DecompressionStream を使う。

export class ZipError extends Error {}
export class ZipPasswordError extends ZipError {}

const SIG_EOCD = 0x06054b50;
const SIG_CEN = 0x02014b50;
const SIG_LOC = 0x04034b50;

// ---------------------------------------------------------------- CRC32
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// ---------------------------------------------------------------- 構造の読み取り
function decodeName(bytes, utf8) {
  if (utf8) return new TextDecoder('utf-8').decode(bytes);
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder('shift_jis').decode(bytes);
  }
}

/** ZIP の中のファイル一覧（フォルダは除く） */
export function listEntries(buffer) {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 0xffff); i--) {
    if (dv.getUint32(i, true) === SIG_EOCD) { eocd = i; break; }
  }
  if (eocd < 0) throw new ZipError('ZIPファイルとして読めませんでした');
  const count = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  const entries = [];
  for (let n = 0; n < count; n++) {
    if (p + 46 > bytes.length || dv.getUint32(p, true) !== SIG_CEN) throw new ZipError('ZIPファイルが壊れています');
    const flags = dv.getUint16(p + 8, true);
    const method = dv.getUint16(p + 10, true);
    const modTime = dv.getUint16(p + 12, true);
    const crc = dv.getUint32(p + 16, true);
    const compSize = dv.getUint32(p + 20, true);
    const size = dv.getUint32(p + 24, true);
    const nameLen = dv.getUint16(p + 28, true);
    const extraLen = dv.getUint16(p + 30, true);
    const commentLen = dv.getUint16(p + 32, true);
    const localOffset = dv.getUint32(p + 42, true);
    const name = decodeName(bytes.subarray(p + 46, p + 46 + nameLen), (flags & 0x800) !== 0);
    const extra = bytes.subarray(p + 46 + nameLen, p + 46 + nameLen + extraLen);
    if (!name.endsWith('/')) {
      entries.push({ name, flags, method, modTime, crc, compSize, size, localOffset, aes: parseAesExtra(extra) });
    }
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

function parseAesExtra(extra) {
  const dv = new DataView(extra.buffer, extra.byteOffset, extra.byteLength);
  for (let i = 0; i + 4 <= extra.length;) {
    const id = dv.getUint16(i, true);
    const len = dv.getUint16(i + 2, true);
    if (id === 0x9901 && len >= 7) {
      return {
        version: dv.getUint16(i + 4, true), // 1 = AE-1, 2 = AE-2
        strength: extra[i + 8],             // 1 = 128, 2 = 192, 3 = 256
        method: dv.getUint16(i + 9, true),  // 本当の圧縮方式
      };
    }
    i += 4 + len;
  }
  return null;
}

function rawData(bytes, entry) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const p = entry.localOffset;
  if (dv.getUint32(p, true) !== SIG_LOC) throw new ZipError('ZIPファイルが壊れています');
  const start = p + 30 + dv.getUint16(p + 26, true) + dv.getUint16(p + 28, true);
  return bytes.subarray(start, start + entry.compSize);
}

// ---------------------------------------------------------------- ZipCrypto
function zipCryptoDecrypt(data, password, checkByte) {
  let k0 = 0x12345678, k1 = 0x23456789, k2 = 0x34567890;
  const update = (b) => {
    k0 = CRC_TABLE[(k0 ^ b) & 0xff] ^ (k0 >>> 8);
    k1 = (k1 + (k0 & 0xff)) >>> 0;
    k1 = (Math.imul(k1, 134775813) + 1) >>> 0;
    k2 = CRC_TABLE[(k2 ^ (k1 >>> 24)) & 0xff] ^ (k2 >>> 8);
  };
  for (const b of password) update(b);
  const out = new Uint8Array(data.length);
  for (let i = 0; i < data.length; i++) {
    const t = (k2 | 2) & 0xffff;
    const c = data[i] ^ ((Math.imul(t, t ^ 1) >>> 8) & 0xff);
    out[i] = c;
    update(c);
  }
  if (out.length < 12 || out[11] !== checkByte) throw new ZipPasswordError('パスワードが違います');
  return out.subarray(12);
}

// ---------------------------------------------------------------- WinZip AES
async function aesDecrypt(data, password, strength) {
  const keyLen = { 1: 16, 2: 24, 3: 32 }[strength];
  if (!keyLen) throw new ZipError('対応していない暗号化方式です');
  const saltLen = keyLen / 2;
  const salt = data.subarray(0, saltLen);
  const verifier = data.subarray(saltLen, saltLen + 2);
  const enc = data.subarray(saltLen + 2, data.length - 10);
  const mac = data.subarray(data.length - 10);

  const subtle = globalThis.crypto.subtle;
  const base = await subtle.importKey('raw', password, 'PBKDF2', false, ['deriveBits']);
  const dk = new Uint8Array(await subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-1', salt, iterations: 1000 }, base, (keyLen * 2 + 2) * 8));
  if (dk[keyLen * 2] !== verifier[0] || dk[keyLen * 2 + 1] !== verifier[1]) {
    throw new ZipPasswordError('パスワードが違います');
  }
  const hmacKey = await subtle.importKey('raw', dk.subarray(keyLen, keyLen * 2), { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']);
  const sig = new Uint8Array(await subtle.sign('HMAC', hmacKey, enc));
  for (let i = 0; i < 10; i++) {
    if (sig[i] !== mac[i]) throw new ZipError('ZIPファイルが壊れています（認証コードが一致しません）');
  }

  // AES-CTR（カウンターは 1 から始まるリトルエンディアン）。WebCrypto の CTR はビッグエンディアンなので、
  // 1ブロックずつカウンターを作って鍵ストリームを得る
  const aesKey = await subtle.importKey('raw', dk.subarray(0, keyLen), 'AES-CTR', false, ['encrypt']);
  const blocks = Math.ceil(enc.length / 16);
  const zero = new Uint8Array(16);
  const out = new Uint8Array(enc.length);
  const BATCH = 512;
  for (let b0 = 0; b0 < blocks; b0 += BATCH) {
    const jobs = [];
    for (let b = b0; b < Math.min(blocks, b0 + BATCH); b++) {
      const counter = new Uint8Array(16);
      let n = b + 1;
      for (let i = 0; i < 8 && n > 0; i++) { counter[i] = n & 0xff; n = Math.floor(n / 256); }
      jobs.push(subtle.encrypt({ name: 'AES-CTR', counter, length: 128 }, aesKey, zero));
    }
    const streams = await Promise.all(jobs);
    streams.forEach((ks, j) => {
      const s = new Uint8Array(ks);
      const off = (b0 + j) * 16;
      for (let i = 0; i < 16 && off + i < enc.length; i++) out[off + i] = enc[off + i] ^ s[i];
    });
  }
  return out;
}

// ---------------------------------------------------------------- 展開
async function inflateRaw(data) {
  const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/**
 * 1つのファイルを取り出す。password は文字列（UTF-8 のバイト列として使う）。
 * パスワードが必要なのに渡されていない・違うときは ZipPasswordError。
 */
export async function extractEntry(buffer, entry, password) {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  let data = rawData(bytes, entry);
  let method = entry.method;
  const encrypted = (entry.flags & 1) !== 0;
  let checkCrc = true;

  if (encrypted) {
    if (password == null || password === '') throw new ZipPasswordError('パスワードが必要です');
    const pw = new TextEncoder().encode(password);
    if (method === 99) {
      if (!entry.aes) throw new ZipError('対応していない暗号化方式です');
      data = await aesDecrypt(data, pw, entry.aes.strength);
      method = entry.aes.method;
      checkCrc = entry.aes.version === 1; // AE-2 は CRC を 0 にしている
    } else {
      // データ記述子があるときは、確認用バイトに更新時刻の上位バイトを使う
      const check = entry.flags & 0x8 ? (entry.modTime >>> 8) & 0xff : entry.crc >>> 24;
      data = zipCryptoDecrypt(data, pw, check);
    }
  }

  let out;
  if (method === 0) out = data;
  else if (method === 8) {
    try {
      out = await inflateRaw(data);
    } catch {
      // ZipCrypto の確認用バイトは 1/256 の確率で偶然一致するので、展開に失敗したらパスワード違いとみなす
      throw encrypted ? new ZipPasswordError('パスワードが違います') : new ZipError('ZIPファイルを展開できませんでした');
    }
  } else throw new ZipError(`対応していない圧縮方式です（${method}）`);

  if (checkCrc && crc32(out) !== entry.crc) {
    throw encrypted ? new ZipPasswordError('パスワードが違います') : new ZipError('ZIPファイルが壊れています（CRC）');
  }
  return out;
}

/** ZIP の中の CSV をすべて取り出す。[{ name, bytes }] */
export async function extractCsvFiles(buffer, password) {
  const entries = listEntries(buffer).filter((e) => /\.csv$/i.test(e.name));
  const out = [];
  for (const e of entries) {
    // eslint-disable-next-line no-await-in-loop
    out.push({ name: e.name.split('/').pop(), bytes: await extractEntry(buffer, e, password) });
  }
  return out;
}

/** ZIP の中にパスワードのかかったファイルがあるか */
export function needsPassword(buffer) {
  return listEntries(buffer).some((e) => (e.flags & 1) !== 0);
}
