// Microbenchmarks contrasting every native `String` operation with its `str8`
// (UTF-8) counterpart over the same ~2 kb ASCII input. The backing string is
// pure ASCII so UTF-8 byte offsets line up with native char indices, keeping the
// comparison apples-to-apples (one byte per char). The str8 inputs are
// pre-encoded once into UTF-8 views (`V8` and the needles), so each timed body
// measures the str8 operation itself, not the one-time transcode. Suite keys are
// prefixed `u8_` so they never collide with str.bench's suites in the shared
// as-bench JSON. `blackbox` stops the optimizer folding the timed work away.

import { bench, suite, blackbox, settings } from "as-bench/assembly/index";
import { str8 } from "../index";

settings.warmupTime = 250;
settings.measurementTime = 500;

// One ~2 kb backing string (1024 chars = 1024 UTF-8 bytes here, all ASCII). A
// unique "needle" sits ~halfway in, wrapped in whitespace so the trim ops have
// real work to do.
const PHRASE = "the quick brown fox jumps over the lazy dog, ";
const PAD = "        "; // 8 spaces
const CORE = (PHRASE.repeat(21) + "needle, " + PHRASE.repeat(3)).slice(0, 1008);
const BIG = PAD + CORE + PAD; // 1024 chars

const PREFIX = BIG.substring(0, 9); // for startsWith
const SUFFIX = BIG.substring(BIG.length - 8); // for endsWith
const SAME = (BIG + " ").slice(0, BIG.length); // distinct copy, equal content
const BIG_B = BIG.substring(0, BIG.length - 1) + "Z"; // differs at the last byte

// Pre-encoded UTF-8 views / needles (transcode happens once, here, not in the
// timed bodies).
const V8 = str8.from(BIG);
const SAME8 = str8.from(SAME);
const BIGB8 = str8.from(BIG_B);
const PREFIX8 = str8.from(PREFIX);
const SUFFIX8 = str8.from(SUFFIX);
const NEEDLE8 = str8.from("needle");

// ===========================================================================
// View-producing ops - native copies; str8 returns a view (byte offsets).
// ===========================================================================

suite("u8_slice", () => {
  bench("native String#slice", () => {
    blackbox<string>(blackbox<string>(BIG).slice(10, 40));
  });
  bench("str8.slice (view)", () => {
    blackbox<usize>(str8.slice(blackbox<str8>(V8), 10, 40).start);
  });
});

suite("u8_substring", () => {
  bench("native String#substring", () => {
    blackbox<string>(blackbox<string>(BIG).substring(10, 40));
  });
  bench("str8.substring (view)", () => {
    blackbox<usize>(str8.substring(blackbox<str8>(V8), 10, 40).start);
  });
});

suite("u8_substr", () => {
  bench("native String#substr", () => {
    blackbox<string>(blackbox<string>(BIG).substr(10, 30));
  });
  bench("str8.substr (view)", () => {
    blackbox<usize>(str8.substr(blackbox<str8>(V8), 10, 30).start);
  });
});

suite("u8_charAt", () => {
  bench("native String#charAt", () => {
    blackbox<string>(blackbox<string>(BIG).charAt(500));
  });
  bench("str8.charAt (view)", () => {
    blackbox<usize>(str8.charAt(blackbox<str8>(V8), 500).start);
  });
});

suite("u8_at", () => {
  bench("native String#at", () => {
    blackbox<string>(blackbox<string>(BIG).at(-1));
  });
  bench("str8.at (view)", () => {
    blackbox<usize>(str8.at(blackbox<str8>(V8), -1).start);
  });
});

suite("u8_trim", () => {
  bench("native String#trim", () => {
    blackbox<string>(blackbox<string>(BIG).trim());
  });
  bench("str8.trim (view)", () => {
    blackbox<usize>(str8.trim(blackbox<str8>(V8)).start);
  });
});

suite("u8_trimStart", () => {
  bench("native String#trimStart", () => {
    blackbox<string>(blackbox<string>(BIG).trimStart());
  });
  bench("str8.trimStart (view)", () => {
    blackbox<usize>(str8.trimStart(blackbox<str8>(V8)).start);
  });
});

suite("u8_trimEnd", () => {
  bench("native String#trimEnd", () => {
    blackbox<string>(blackbox<string>(BIG).trimEnd());
  });
  bench("str8.trimEnd (view)", () => {
    blackbox<usize>(str8.trimEnd(blackbox<str8>(V8)).start);
  });
});

suite("u8_split", () => {
  bench("native String#split", () => {
    blackbox<i32>(blackbox<string>(BIG).split(" ").length);
  });
  bench("str8.split (views)", () => {
    blackbox<i32>(str8.split(blackbox<str8>(V8), " ").length);
  });
});

// ===========================================================================
// Queries - both return a primitive; str8 allocates nothing.
// ===========================================================================

suite("u8_length", () => {
  bench("native String#length", () => {
    blackbox<i32>(blackbox<string>(BIG).length);
  });
  bench("str8.length (bytes)", () => {
    blackbox<i32>(str8.length(blackbox<str8>(V8)));
  });
});

suite("u8_byteAt", () => {
  bench("native String#charCodeAt", () => {
    blackbox<i32>(blackbox<string>(BIG).charCodeAt(500));
  });
  bench("str8.byteAt", () => {
    blackbox<i32>(str8.byteAt(blackbox<str8>(V8), 500));
  });
});

suite("u8_codePointAt", () => {
  bench("native String#codePointAt", () => {
    blackbox<i32>(blackbox<string>(BIG).codePointAt(500));
  });
  bench("str8.codePointAt", () => {
    blackbox<i32>(str8.codePointAt(blackbox<str8>(V8), 500));
  });
});

// str8-only: O(n) Unicode-scalar count (not charted; here for optimization data).
suite("u8_codePointCount", () => {
  bench("str8.codePointCount", () => {
    blackbox<i32>(str8.codePointCount(blackbox<str8>(V8)));
  });
});

suite("u8_indexOf", () => {
  bench("native String#indexOf", () => {
    blackbox<i32>(blackbox<string>(BIG).indexOf("needle"));
  });
  bench("str8.indexOf (SWAR/SIMD)", () => {
    blackbox<i32>(str8.indexOf(blackbox<str8>(V8), NEEDLE8));
  });
});

suite("u8_lastIndexOf", () => {
  bench("native String#lastIndexOf", () => {
    blackbox<i32>(blackbox<string>(BIG).lastIndexOf("needle"));
  });
  bench("str8.lastIndexOf", () => {
    blackbox<i32>(str8.lastIndexOf(blackbox<str8>(V8), NEEDLE8));
  });
});

suite("u8_includes", () => {
  bench("native String#includes", () => {
    blackbox<bool>(blackbox<string>(BIG).includes("needle"));
  });
  bench("str8.includes (SWAR/SIMD)", () => {
    blackbox<bool>(str8.includes(blackbox<str8>(V8), NEEDLE8));
  });
});

suite("u8_startsWith", () => {
  bench("native String#startsWith", () => {
    blackbox<bool>(blackbox<string>(BIG).startsWith(PREFIX));
  });
  bench("str8.startsWith", () => {
    blackbox<bool>(str8.startsWith(blackbox<str8>(V8), PREFIX8));
  });
});

suite("u8_endsWith", () => {
  bench("native String#endsWith", () => {
    blackbox<bool>(blackbox<string>(BIG).endsWith(SUFFIX));
  });
  bench("str8.endsWith", () => {
    blackbox<bool>(str8.endsWith(blackbox<str8>(V8), SUFFIX8));
  });
});

suite("u8_equals", () => {
  bench("native String ==", () => {
    blackbox<bool>(blackbox<string>(BIG) == blackbox<string>(SAME));
  });
  bench("str8.equals", () => {
    blackbox<bool>(str8.equals(blackbox<str8>(V8), SAME8));
  });
});

suite("u8_compare", () => {
  bench("native <", () => {
    blackbox<bool>(blackbox<string>(BIG) < blackbox<string>(BIG_B));
  });
  bench("str8.compare (SWAR/SIMD)", () => {
    blackbox<i32>(str8.compare(blackbox<str8>(V8), BIGB8));
  });
});

// ===========================================================================
// Allocating ops - str8 builds a fresh UTF-8 buffer (no UTF-16 decode).
// ===========================================================================

suite("u8_toUpperCase", () => {
  bench("native String#toUpperCase", () => {
    blackbox<string>(blackbox<string>(BIG).toUpperCase());
  });
  bench("str8.toUpperCase", () => {
    blackbox<usize>(str8.toUpperCase(blackbox<str8>(V8)).start);
  });
});

suite("u8_toLowerCase", () => {
  bench("native String#toLowerCase", () => {
    blackbox<string>(blackbox<string>(BIG).toLowerCase());
  });
  bench("str8.toLowerCase", () => {
    blackbox<usize>(str8.toLowerCase(blackbox<str8>(V8)).start);
  });
});

suite("u8_repeat", () => {
  bench("native String#repeat", () => {
    blackbox<string>(blackbox<string>(BIG).repeat(3));
  });
  bench("str8.repeat", () => {
    blackbox<usize>(str8.repeat(blackbox<str8>(V8), 3).start);
  });
});

suite("u8_padStart", () => {
  bench("native String#padStart", () => {
    blackbox<string>(blackbox<string>(BIG).padStart(1100, "."));
  });
  bench("str8.padStart", () => {
    blackbox<usize>(str8.padStart(blackbox<str8>(V8), 1100, ".").start);
  });
});

suite("u8_padEnd", () => {
  bench("native String#padEnd", () => {
    blackbox<string>(blackbox<string>(BIG).padEnd(1100, "."));
  });
  bench("str8.padEnd", () => {
    blackbox<usize>(str8.padEnd(blackbox<str8>(V8), 1100, ".").start);
  });
});

suite("u8_concat", () => {
  bench("native String#concat", () => {
    blackbox<string>(blackbox<string>(BIG).concat(BIG));
  });
  bench("str8.concat", () => {
    blackbox<usize>(str8.concat(blackbox<str8>(V8), V8).start);
  });
});

suite("u8_replace", () => {
  bench("native String#replace", () => {
    blackbox<string>(blackbox<string>(BIG).replace("needle", "NEEDLE"));
  });
  bench("str8.replace", () => {
    blackbox<usize>(str8.replace(blackbox<str8>(V8), "needle", "NEEDLE").start);
  });
});

suite("u8_replaceAll", () => {
  bench("native String#replaceAll", () => {
    blackbox<string>(blackbox<string>(BIG).replaceAll("needle", "NEEDLE"));
  });
  bench("str8.replaceAll", () => {
    blackbox<usize>(
      str8.replaceAll(blackbox<str8>(V8), "needle", "NEEDLE").start,
    );
  });
});
