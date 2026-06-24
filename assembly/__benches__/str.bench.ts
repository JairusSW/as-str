// Microbenchmarks contrasting every native `String` operation with its
// `str` counterpart, all driven by one ~2 kb string so the inputs are
// comparable across ops. View-producing ops only move pointers; queries
// allocate nothing; allocating ops materialize the view then defer to the
// native method. `blackbox` stops the optimizer folding the timed work away.

import { bench, suite, blackbox, settings } from "as-bench/assembly/index";
import { str } from "../index";

settings.warmupTime = 250;
settings.measurementTime = 500;

// One ~2 kb backing string (1024 UTF-16 code units = 2048 bytes). A unique
// "needle" sits ~halfway in so the scans have real distance to cover, and it is
// wrapped in whitespace so the trim ops have something to do (otherwise native
// trim short-circuits while str still builds a view).
const PHRASE = "the quick brown fox jumps over the lazy dog, ";
const PAD = "        "; // 8 spaces
const CORE = (PHRASE.repeat(21) + "needle, " + PHRASE.repeat(3)).slice(0, 1008);
const BIG = PAD + CORE + PAD; // 1024 code units

// Derived inputs (still all 2 kb-scale).
const PREFIX = BIG.substring(0, 9); // for startsWith
const SUFFIX = BIG.substring(BIG.length - 8); // for endsWith
const SAME = (BIG + " ").slice(0, BIG.length); // distinct copy, equal content
const BIG_B = BIG.substring(0, BIG.length - 1) + "Z"; // differs at the last unit

// ===========================================================================
// View-producing ops - native copies; str returns a view.
// ===========================================================================

suite("slice", () => {
  bench("native String#slice", () => {
    blackbox<string>(blackbox<string>(BIG).slice(10, 40));
  });
  bench("str.slice (view)", () => {
    blackbox<usize>(str.slice(blackbox<string>(BIG), 10, 40).start);
  });
});

suite("substring", () => {
  bench("native String#substring", () => {
    blackbox<string>(blackbox<string>(BIG).substring(10, 40));
  });
  bench("str.substring (view)", () => {
    blackbox<usize>(str.substring(blackbox<string>(BIG), 10, 40).start);
  });
});

suite("substr", () => {
  bench("native String#substr", () => {
    blackbox<string>(blackbox<string>(BIG).substr(10, 30));
  });
  bench("str.substr (view)", () => {
    blackbox<usize>(str.substr(blackbox<string>(BIG), 10, 30).start);
  });
});

suite("charAt", () => {
  bench("native String#charAt", () => {
    blackbox<string>(blackbox<string>(BIG).charAt(500));
  });
  bench("str.charAt (view)", () => {
    blackbox<usize>(str.charAt(blackbox<string>(BIG), 500).start);
  });
});

suite("at", () => {
  bench("native String#at", () => {
    blackbox<string>(blackbox<string>(BIG).at(-1));
  });
  bench("str.at (view)", () => {
    blackbox<usize>(str.at(blackbox<string>(BIG), -1).start);
  });
});

suite("trim", () => {
  bench("native String#trim", () => {
    blackbox<string>(blackbox<string>(BIG).trim());
  });
  bench("str.trim (view)", () => {
    blackbox<usize>(str.trim(blackbox<string>(BIG)).start);
  });
});

suite("trimStart", () => {
  bench("native String#trimStart", () => {
    blackbox<string>(blackbox<string>(BIG).trimStart());
  });
  bench("str.trimStart (view)", () => {
    blackbox<usize>(str.trimStart(blackbox<string>(BIG)).start);
  });
});

suite("trimEnd", () => {
  bench("native String#trimEnd", () => {
    blackbox<string>(blackbox<string>(BIG).trimEnd());
  });
  bench("str.trimEnd (view)", () => {
    blackbox<usize>(str.trimEnd(blackbox<string>(BIG)).start);
  });
});

suite("split", () => {
  bench("native String#split", () => {
    blackbox<i32>(blackbox<string>(BIG).split(" ").length);
  });
  bench("str.split (views)", () => {
    blackbox<i32>(str.split(blackbox<string>(BIG), " ").length);
  });
});

// ===========================================================================
// Queries - both return a primitive; str allocates nothing.
// ===========================================================================

suite("length", () => {
  bench("native String#length", () => {
    blackbox<i32>(blackbox<string>(BIG).length);
  });
  bench("str.length", () => {
    blackbox<i32>(str.length(blackbox<string>(BIG)));
  });
});

suite("charCodeAt", () => {
  bench("native String#charCodeAt", () => {
    blackbox<i32>(blackbox<string>(BIG).charCodeAt(500));
  });
  bench("str.charCodeAt", () => {
    blackbox<i32>(str.charCodeAt(blackbox<string>(BIG), 500));
  });
});

suite("codePointAt", () => {
  bench("native String#codePointAt", () => {
    blackbox<i32>(blackbox<string>(BIG).codePointAt(500));
  });
  bench("str.codePointAt", () => {
    blackbox<i32>(str.codePointAt(blackbox<string>(BIG), 500));
  });
});

suite("indexOf", () => {
  bench("native String#indexOf", () => {
    blackbox<i32>(blackbox<string>(BIG).indexOf("needle"));
  });
  bench("str.indexOf (SWAR/SIMD)", () => {
    blackbox<i32>(str.indexOf(blackbox<string>(BIG), "needle"));
  });
});

suite("lastIndexOf", () => {
  bench("native String#lastIndexOf", () => {
    blackbox<i32>(blackbox<string>(BIG).lastIndexOf("needle"));
  });
  bench("str.lastIndexOf", () => {
    blackbox<i32>(str.lastIndexOf(blackbox<string>(BIG), "needle"));
  });
});

suite("includes", () => {
  bench("native String#includes", () => {
    blackbox<bool>(blackbox<string>(BIG).includes("needle"));
  });
  bench("str.includes (SWAR/SIMD)", () => {
    blackbox<bool>(str.includes(blackbox<string>(BIG), "needle"));
  });
});

suite("startsWith", () => {
  bench("native String#startsWith", () => {
    blackbox<bool>(blackbox<string>(BIG).startsWith(PREFIX));
  });
  bench("str.startsWith", () => {
    blackbox<bool>(str.startsWith(blackbox<string>(BIG), PREFIX));
  });
});

suite("endsWith", () => {
  bench("native String#endsWith", () => {
    blackbox<bool>(blackbox<string>(BIG).endsWith(SUFFIX));
  });
  bench("str.endsWith", () => {
    blackbox<bool>(str.endsWith(blackbox<string>(BIG), SUFFIX));
  });
});

suite("equals", () => {
  bench("native String ==", () => {
    blackbox<bool>(blackbox<string>(BIG) == blackbox<string>(SAME));
  });
  bench("str.equals", () => {
    blackbox<bool>(str.equals(blackbox<string>(BIG), SAME));
  });
});

suite("compare", () => {
  bench("native <", () => {
    blackbox<bool>(blackbox<string>(BIG) < blackbox<string>(BIG_B));
  });
  bench("str.compare (SWAR/SIMD)", () => {
    blackbox<i32>(str.compare(blackbox<string>(BIG), BIG_B));
  });
});

// ===========================================================================
// Allocating ops - str materializes the view, then calls the native op,
// so it is expected to trail native by one extra copy.
// ===========================================================================

suite("toUpperCase", () => {
  bench("native String#toUpperCase", () => {
    blackbox<string>(blackbox<string>(BIG).toUpperCase());
  });
  bench("str.toUpperCase", () => {
    blackbox<string>(str.toUpperCase(blackbox<string>(BIG)));
  });
});

suite("toLowerCase", () => {
  bench("native String#toLowerCase", () => {
    blackbox<string>(blackbox<string>(BIG).toLowerCase());
  });
  bench("str.toLowerCase", () => {
    blackbox<string>(str.toLowerCase(blackbox<string>(BIG)));
  });
});

suite("repeat", () => {
  bench("native String#repeat", () => {
    blackbox<string>(blackbox<string>(BIG).repeat(3));
  });
  bench("str.repeat", () => {
    blackbox<string>(str.repeat(blackbox<string>(BIG), 3));
  });
});

suite("padStart", () => {
  bench("native String#padStart", () => {
    blackbox<string>(blackbox<string>(BIG).padStart(1100, "."));
  });
  bench("str.padStart", () => {
    blackbox<string>(str.padStart(blackbox<string>(BIG), 1100, "."));
  });
});

suite("padEnd", () => {
  bench("native String#padEnd", () => {
    blackbox<string>(blackbox<string>(BIG).padEnd(1100, "."));
  });
  bench("str.padEnd", () => {
    blackbox<string>(str.padEnd(blackbox<string>(BIG), 1100, "."));
  });
});

suite("concat", () => {
  bench("native String#concat", () => {
    blackbox<string>(blackbox<string>(BIG).concat(BIG));
  });
  bench("str.concat", () => {
    blackbox<string>(str.concat(blackbox<string>(BIG), BIG));
  });
});

suite("replace", () => {
  bench("native String#replace", () => {
    blackbox<string>(blackbox<string>(BIG).replace("needle", "NEEDLE"));
  });
  bench("str.replace", () => {
    blackbox<string>(str.replace(blackbox<string>(BIG), "needle", "NEEDLE"));
  });
});

suite("replaceAll", () => {
  bench("native String#replaceAll", () => {
    blackbox<string>(blackbox<string>(BIG).replaceAll("needle", "NEEDLE"));
  });
  bench("str.replaceAll", () => {
    blackbox<string>(str.replaceAll(blackbox<string>(BIG), "needle", "NEEDLE"));
  });
});
