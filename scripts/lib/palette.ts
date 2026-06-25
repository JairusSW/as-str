// Shared benchmark chart colors.
//
// Base palette:
//   jungle green #44AF69 · faded copper #9E7153 · strawberry red #F8333C
//   atomic tangerine #FA6F26 · orange #FCAB10 · palm leaf #94A562
//   pacific blue #2B9EB3 · muted teal #83BAB4 · sand dune #DBD5B5

export const BASE = {
  jungleGreen: "#44AF69",
  fadedCopper: "#9E7153",
  strawberryRed: "#F8333C",
  atomicTangerine: "#FA6F26",
  orange: "#FCAB10",
  palmLeaf: "#94A562",
  pacificBlue: "#2B9EB3",
  mutedTeal: "#83BAB4",
  sandDune: "#DBD5B5",
} as const;

// RGB triples for rgba() interpolation.
const RGB = {
  jungleGreen: "68,175,105",
  fadedCopper: "158,113,83",
  strawberryRed: "248,51,60",
  atomicTangerine: "250,111,38",
  orange: "252,171,16",
  palmLeaf: "148,165,98",
  pacificBlue: "43,158,179",
  mutedTeal: "131,186,180",
  sandDune: "219,213,181",
} as const;

export const rgba = (name: keyof typeof RGB, alpha = 1): string =>
  `rgba(${RGB[name]},${alpha})`;

// One distinct hue per engine/mode.
//   JS → strawberry red · NAIVE → orange · SWAR → jungle green · SIMD → pacific blue
export const MODE_RGB: Record<string, string> = {
  js: RGB.strawberryRed,
  naive: RGB.orange,
  swar: RGB.jungleGreen,
  simd: RGB.pacificBlue,
  // Dynamic JSON.Obj throughput series.
  obj: RGB.fadedCopper,
};

// JS, NAIVE, SWAR, SIMD bars.
export const MODE_BARS = [
  { bg: rgba("strawberryRed", 0.85), border: BASE.strawberryRed },
  { bg: rgba("orange", 0.85), border: BASE.orange },
  { bg: rgba("jungleGreen", 0.85), border: BASE.jungleGreen },
  { bg: rgba("pacificBlue", 0.9), border: BASE.pacificBlue },
];

// Dynamic JSON.Obj bar.
export const OBJ_BAR = {
  bg: rgba("fadedCopper", 0.85),
  border: BASE.fadedCopper,
};

// Eager vs lazy.
export const EAGER = { bg: rgba("sandDune", 0.85), border: BASE.sandDune };
export const LAZY = { bg: rgba("jungleGreen", 0.85), border: BASE.jungleGreen };

// Multi-library comparison colors.
export const MULTILIB_COLORS: Record<string, string> = {
  "native JSON (JS)": BASE.fadedCopper,
  "fast-json-parse (JS)": BASE.mutedTeal,
  "fast-json-stringify (JS)": BASE.mutedTeal,
  "assemblyscript-json": BASE.strawberryRed,
  "json-as struct": BASE.pacificBlue,
  "json-as struct lazy": BASE.jungleGreen,
  "json-as JSON.Obj": BASE.orange,
};

// Shared neutral inks.
export const INK = {
  subtitle: "#6b7280",
  label: "#374151",
  grid: "rgba(0,0,0,0.08)",
};
