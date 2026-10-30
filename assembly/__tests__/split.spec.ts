import { describe, expect, test } from "as-test";
import { str, str8 } from "../index";

describe("delimited payloads", () => {
  test("negative limits also allow all pieces with empty separators", () => {
    const text = "😀éx";
    expect(str.split(text, "", -1).length).toBe(text.split("", -1).length);
    expect(str8.from(text).split("", -1).length).toBe(3);
    expect(str8.from(text).split("", i32.MIN_VALUE).length).toBe(3);
  });

  test("limited splits preserve empty fields, offset views, and Unicode", () => {
    const texts = [
      "",
      "a",
      "a,b,c",
      ",a,,b,",
      "line1\r\nline2\r\n",
      "José\t山田\t😀\t",
      "a\0b\0",
      "éaébé",
      "first " + "tail".repeat(1024) + " last",
    ];
    const separators = [",", " ", "\t", "\0", "é", "\r\n", "absent"];
    const limits = [i32.MIN_VALUE, -1, 0, 1, 2, 3, 4, i32.MAX_VALUE];
    for (let t = 0; t < texts.length; t++) {
      const text = texts[t];
      const view16 = str.from("<" + text + ">").slice(1, -1);
      const view8 = str8.from("<" + text + ">").slice(1, -1);
      for (let s = 0; s < separators.length; s++) {
        for (let l = 0; l < limits.length; l++) {
          const expected = text.split(separators[s], limits[l]);
          const parts16 = view16.split(separators[s], limits[l]);
          const parts8 = view8.split(separators[s], limits[l]);
          expect(parts16.length).toBe(expected.length);
          expect(parts8.length).toBe(expected.length);
          for (let i = 0; i < expected.length; i++) {
            expect(parts16[i].toString()).toBe(expected[i]);
            expect(parts8[i].toString()).toBe(expected[i]);
          }
        }
      }
    }
  });
});
