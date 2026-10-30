import { describe, expect, test } from "as-test";
import { str, str8 } from "../index";
import {
  findLastUnit,
  indexOf as rangeIndexOf,
  lastIndexOf as rangeLastIndexOf,
} from "../util";
import { findLastByte, indexOfBytes, lastIndexOfBytes } from "../util8";

const LENGTHS = [
  0, 1, 2, 3, 4, 7, 8, 9, 15, 16, 17, 31, 32, 33, 63, 64, 65, 127, 128, 129,
  255, 256, 257,
];

function referenceLastBytes(hay: str8, needle: str8, from: i32): i32 {
  if (needle.length == 0) return hay.length;
  for (let i = min(max(from, 0), hay.length - needle.length); i >= 0; i--) {
    let equal = true;
    for (let j = 0; j < needle.length; j++) {
      if (hay.byteAt(i + j) != needle.byteAt(j)) {
        equal = false;
        break;
      }
    }
    if (equal) return i;
  }
  return -1;
}

function referenceFirstBytes(hay: str8, needle: str8, from: i32): i32 {
  if (needle.length == 0) return 0;
  for (let i = max(from, 0); i <= hay.length - needle.length; i++) {
    let equal = true;
    for (let j = 0; j < needle.length; j++) {
      if (hay.byteAt(i + j) != needle.byteAt(j)) {
        equal = false;
        break;
      }
    }
    if (equal) return i;
  }
  return -1;
}

describe("substring search", () => {
  test("matches native UTF-16 and scalar byte search across scan boundaries", () => {
    let seed: u32 = 0x12345678;
    const alphabet = [0, 1, 0x40, 0x41, 0x80, 0x81, 0x8000, 0x8001, 0xffff];
    for (let length = 0; length < LENGTHS.length; length++) {
      const units = new Array<i32>(LENGTHS[length]);
      for (let i = 0; i < units.length; i++) {
        seed = seed * 1664525 + 1013904223;
        units[i] = alphabet[<i32>(seed % <u32>alphabet.length)];
      }
      const text = String.fromCharCodes(units);
      const hay16 = str.from("<" + text + ">").slice(1, -1);
      const hay8 = str8.from("<" + text + ">").slice(1, -1);
      const needles = [
        "",
        "\0",
        "\u0001",
        "@",
        "A",
        "\u0080",
        "missing",
        text.slice(0, 2),
        text.slice(-3),
        text.slice(0, 17),
        text.slice(3, 12),
      ];
      const positions = [
        i32.MIN_VALUE,
        -1,
        0,
        1,
        7,
        8,
        16,
        31,
        32,
        hay8.length - 1,
        i32.MAX_VALUE,
      ];
      for (let n = 0; n < needles.length; n++) {
        const needle = needles[n];
        const needle16 = str.from("[" + needle + "]").slice(1, -1);
        const needle8 = str8.from("[" + needle + "]").slice(1, -1);
        for (let p = 0; p < positions.length; p++) {
          const from = positions[p];
          const expected = text.lastIndexOf(needle, from);
          expect(hay16.lastIndexOf(needle, from)).toBe(expected);
          expect(hay16.lastIndexOf(needle16, from)).toBe(expected);
          expect(hay8.lastIndexOf(needle8, from)).toBe(
            referenceLastBytes(hay8, needle8, from),
          );
          const first = text.indexOf(needle, from);
          expect(hay16.indexOf(needle, from)).toBe(first);
          expect(hay16.indexOf(needle16, from)).toBe(first);
          expect(hay8.indexOf(needle8, from)).toBe(
            referenceFirstBytes(hay8, needle8, from),
          );
        }
      }
    }
  });

  test("checks candidate interiors and chooses the first or last exact match", () => {
    const texts = [
      "a".repeat(65),
      "aba".repeat(22),
      "abca".repeat(20),
      "a00a11a22a33a44a55a66a77a88a99a",
    ];
    const needles = [
      "aa",
      "ab",
      "ba",
      "aba",
      "aca",
      "abba",
      "a11a",
      "a88a",
      "a99a",
      "aXXa",
      "abcaabca",
    ];
    for (let t = 0; t < texts.length; t++) {
      const text = texts[t];
      const hay8 = str8.from(text);
      for (let n = 0; n < needles.length; n++) {
        const needle = needles[n];
        const probe = str8.from(needle);
        for (let from = -1; from <= text.length; from++) {
          const expected = text.lastIndexOf(needle, from);
          expect(str.lastIndexOf(text, needle, from)).toBe(expected);
          expect(hay8.lastIndexOf(probe, from)).toBe(expected);
          const first = text.indexOf(needle, from);
          expect(str.indexOf(text, needle, from)).toBe(first);
          expect(hay8.indexOf(probe, from)).toBe(first);
        }
      }
    }
  });

  test("finds exact matches after dense false candidates at every wide lane", () => {
    const needles = ["ab", "aba", "abca", "a\0\u0001a", "a".repeat(16) + "b"];
    for (let n = 0; n < needles.length; n++) {
      const needle = needles[n];
      for (let at = 16; at < 80; at++) {
        const text = "a".repeat(at) + needle + "a".repeat(32);
        const hay = str.from("<" + text + ">").slice(1, -1);
        const hay8 = str8.from("<" + text + ">").slice(1, -1);
        const probe = str8.from(needle);
        for (let from = 0; from < 8; from++) {
          const expected = text.indexOf(needle, from);
          expect(hay.indexOf(needle, from)).toBe(expected);
          expect(hay8.indexOf(probe, from)).toBe(expected);
        }
      }
    }
  });

  test("reverse masks do not mistake adjacent one lanes for zero lanes", () => {
    const buf = new ArrayBuffer(128);
    const base = changetype<usize>(buf);
    for (let offset = 0; offset < 8; offset++) {
      for (let length = 1; length <= 33; length++) {
        const start = base + <usize>offset;
        for (let i = 0; i < length; i++) store<u8>(start + <usize>i, 1);
        store<u8>(start, 0);
        expect(findLastByte(start, start + <usize>length, 0)).toBe(0);
        expect(findLastByte(start, start + <usize>length, 2)).toBe(-1);
        for (let i = 0; i < length; i++)
          store<u16>(start + ((<usize>i) << 1), 0x8001);
        store<u16>(start, 0x8000);
        expect(
          findLastUnit(start, start + ((<usize>length) << 1), 0x8000),
        ).toBe(0);
        expect(
          findLastUnit(start, start + ((<usize>length) << 1), 0xffff),
        ).toBe(-1);
      }
    }
  });

  test("wide loads remain inside the final memory page", () => {
    const needle = new ArrayBuffer(34);
    const np = changetype<usize>(needle);
    expect(memory.grow(1) >= 0).toBe(true);
    const end = memory.size() << 16;
    for (let length: usize = 1; length <= 65; length++) {
      let start = end - length;
      memory.fill(start, 1, length);
      store<u8>(start, 0);
      expect(findLastByte(start, end, 0)).toBe(0);
      expect(findLastByte(start, end, 2)).toBe(-1);
      memory.fill(np, 1, 17);
      store<u8>(np, 0);
      for (let n: usize = 2; n <= 17; n += 3) {
        expect(lastIndexOfBytes(start, end, np, np + n, i32.MAX_VALUE)).toBe(
          length >= n ? 0 : -1,
        );
        expect(indexOfBytes(start, end, np, np + n, 0)).toBe(
          length >= n ? 0 : -1,
        );
      }
      // A matching prefix at every position forces the dense-candidate scan.
      memory.fill(start, 1, length);
      store<u8>(end - 1, 2);
      memory.fill(np, 1, 17);
      for (let n: usize = 2; n <= 17; n += 3) {
        store<u8>(np + n - 1, 2);
        expect(indexOfBytes(start, end, np, np + n, 0)).toBe(
          length >= n ? <i32>(length - n) : -1,
        );
        store<u8>(np + n - 1, 3);
        expect(indexOfBytes(start, end, np, np + n, 0)).toBe(-1);
        store<u8>(np + n - 1, 1);
      }
      start = end - (length << 1);
      for (let i: usize = 0; i < length; i++) store<u16>(start + (i << 1), 1);
      store<u16>(start, 0);
      expect(findLastUnit(start, end, 0)).toBe(0);
      expect(findLastUnit(start, end, 2)).toBe(-1);
      for (let n: usize = 0; n < 17; n++) store<u16>(np + (n << 1), 1);
      store<u16>(np, 0);
      for (let n: usize = 2; n <= 17; n += 3) {
        expect(
          rangeLastIndexOf(start, end, np, np + (n << 1), i32.MAX_VALUE),
        ).toBe(length >= n ? 0 : -1);
        expect(rangeIndexOf(start, end, np, np + (n << 1), 0)).toBe(
          length >= n ? 0 : -1,
        );
      }
      for (let i: usize = 0; i < length; i++) store<u16>(start + (i << 1), 1);
      store<u16>(end - 2, 2);
      for (let n: usize = 0; n < 17; n++) store<u16>(np + (n << 1), 1);
      for (let n: usize = 2; n <= 17; n += 3) {
        store<u16>(np + ((n - 1) << 1), 2);
        expect(rangeIndexOf(start, end, np, np + (n << 1), 0)).toBe(
          length >= n ? <i32>(length - n) : -1,
        );
        store<u16>(np + ((n - 1) << 1), 3);
        expect(rangeIndexOf(start, end, np, np + (n << 1), 0)).toBe(-1);
        store<u16>(np + ((n - 1) << 1), 1);
      }
    }
  });
});
