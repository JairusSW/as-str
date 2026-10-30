import { describe, expect, test } from "as-test";
import { equalsBytes } from "../util";

const LENGTHS = [
  0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 15, 16, 17, 31, 32, 33, 63, 64, 65, 127, 128,
  129, 255, 256, 257,
];

describe("byte equality", () => {
  test("checks every byte of unaligned ranges without comparing their neighbors", () => {
    const left = new ArrayBuffer(288);
    const right = new ArrayBuffer(288);
    const lp = changetype<usize>(left);
    const rp = changetype<usize>(right);
    for (let offset: usize = 0; offset < 8; offset++) {
      const a = lp + offset;
      const b = rp + 7 - offset;
      for (let length = 0; length < LENGTHS.length; length++) {
        const n = <usize>LENGTHS[length];
        memory.fill(lp, 0x5a, 288);
        memory.fill(rp, 0xa5, 288);
        for (let i: usize = 0; i < n; i++) {
          const value = <u8>(i * 73 + offset * 17);
          store<u8>(a + i, value);
          store<u8>(b + i, value);
        }
        expect(equalsBytes(a, b, n)).toBe(true);
        for (let i: usize = 0; i < n; i++) {
          const value = load<u8>(b + i);
          store<u8>(b + i, value ^ 0x80);
          expect(equalsBytes(a, b, n)).toBe(false);
          store<u8>(b + i, value);
        }
      }
    }
  });

  test("never loads past the end of memory, including empty ranges", () => {
    const other = new ArrayBuffer(257);
    const b = changetype<usize>(other);
    memory.fill(b, 0xa5, 257);
    expect(memory.grow(1) >= 0).toBe(true);
    const end = memory.size() << 16;
    for (let n: usize = 0; n <= 257; n++) {
      const a = end - n;
      memory.fill(a, 0xa5, n);
      expect(equalsBytes(a, b, n)).toBe(true);
      expect(equalsBytes(b, a, n)).toBe(true);
      if (n) {
        store<u8>(end - 1, 0x25);
        expect(equalsBytes(a, b, n)).toBe(false);
        expect(equalsBytes(b, a, n)).toBe(false);
      }
    }
  });
});
