"""テスト用のパスワード付き ZIP を samples/zip/ に作る（中身は samples/ の架空データ）。

    pip install pyzipper
    python tools/make_test_zips.py

パスワードはすべて "test-pass"。
- zipcrypto_sjis.zip … 従来の ZIP 暗号（ZipCrypto）。中のファイル名は Shift_JIS（Windows の圧縮ツールと同じ）
- aes256_utf8.zip    … WinZip AES-256。中のファイル名は UTF-8
- plain.zip          … パスワードなし
"""
import pathlib
import zipfile

import pyzipper

ROOT = pathlib.Path(__file__).resolve().parent.parent
SRC = ROOT / "samples" / "original_anon" / "要確認レセプト一覧_20260108_0947.csv"
OUT = ROOT / "samples" / "zip"
PASSWORD = b"test-pass"
NAME = SRC.name


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    data = SRC.read_bytes()

    # pyzipper は ZipCrypto の書き込みができないので、自前で作る
    _write_zipcrypto(OUT / "zipcrypto_sjis.zip", data)

    with pyzipper.AESZipFile(OUT / "aes256_utf8.zip", "w", compression=pyzipper.ZIP_DEFLATED,
                             encryption=pyzipper.WZ_AES) as z:
        z.setpassword(PASSWORD)
        z.setencryption(pyzipper.WZ_AES, nbits=256)
        z.writestr(NAME, data)

    with zipfile.ZipFile(OUT / "plain.zip", "w", compression=zipfile.ZIP_DEFLATED) as z:
        z.writestr(NAME, data)


def _write_zipcrypto(path: pathlib.Path, data: bytes) -> None:
    """ZipCrypto で暗号化した ZIP を書く（ファイル名は Shift_JIS）"""
    import binascii
    import os
    import struct
    import zlib

    crc = binascii.crc32(data) & 0xFFFFFFFF
    comp = zlib.compressobj(9, zlib.DEFLATED, -15)
    body = comp.compress(data) + comp.flush()

    keys = [0x12345678, 0x23456789, 0x34567890]

    def crc_byte(c: int, b: int) -> int:
        return (binascii.crc32(bytes([b]), c ^ 0xFFFFFFFF) ^ 0xFFFFFFFF) & 0xFFFFFFFF

    def update(b: int) -> None:
        keys[0] = crc_byte(keys[0], b)
        keys[1] = (keys[1] + (keys[0] & 0xFF)) & 0xFFFFFFFF
        keys[1] = (keys[1] * 134775813 + 1) & 0xFFFFFFFF
        keys[2] = crc_byte(keys[2], (keys[1] >> 24) & 0xFF)

    def enc(b: int) -> int:
        t = (keys[2] | 2) & 0xFFFF
        c = b ^ (((t * (t ^ 1)) >> 8) & 0xFF)
        update(b)
        return c

    for b in PASSWORD:
        update(b)
    header = bytearray(os.urandom(11)) + bytes([crc >> 24])
    encrypted = bytes(enc(b) for b in header) + bytes(enc(b) for b in body)

    name = NAME.encode("cp932")
    dos_time, dos_date = (9 << 11) | (47 << 5), ((2026 - 1980) << 9) | (1 << 5) | 8
    local = struct.pack("<IHHHHHIIIHH", 0x04034B50, 20, 1, 8, dos_time, dos_date, crc,
                        len(encrypted), len(data), len(name), 0) + name
    central = struct.pack("<IHHHHHHIIIHHHHHII", 0x02014B50, 20, 20, 1, 8, dos_time, dos_date, crc,
                          len(encrypted), len(data), len(name), 0, 0, 0, 0, 0, 0) + name
    eocd = struct.pack("<IHHHHIIH", 0x06054B50, 0, 0, 1, 1, len(central), len(local) + len(encrypted), 0)
    path.write_bytes(local + encrypted + central + eocd)


if __name__ == "__main__":
    main()
