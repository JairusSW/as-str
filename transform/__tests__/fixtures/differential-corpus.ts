function recursiveLength(value: string, depth: i32): i32 {
  if (depth <= 0) return value.length;
  return recursiveLength(value.slice(1).trim(), depth - 1);
}

export function asciiPipeline(): i32 {
  const value = "  alpha/beta/gamma  ".trim();
  const middle = value.slice(6, 10).substring(0, 4);
  return middle.length + middle.charCodeAt(0);
}

export function unicodePipeline(): i32 {
  const value = "  Καλημέρα世界  ".trim();
  return value.slice(2, -1).length + value.charAt(0).length;
}

export function branchPipeline(choose: bool): i32 {
  let value = "abcdef".slice(1, 5);
  if (choose) value = "uvwxyz".substring(2, 6);
  return value.length + value.charCodeAt(0);
}

export function recursivePipeline(): i32 {
  return recursiveLength("  abcdef  ", 3);
}

export function boundsPipeline(): i32 {
  const left = "abcdef".slice(-20, 2);
  const right = "abcdef".substring(5, 2);
  return left.length * 10 + right.length;
}

export function scalarLengthPipeline(): i32 {
  const input = "  abc/def=ghi[jkl]<mno>  ";
  const sliced = input.slice(-8, -1);
  const substring = input.substring(9, 2);
  const substr = input.substr(-8, 4);
  const trimmed = input.trim();
  const trimStart = input.trimStart();
  const trimEnd = input.trimEnd();
  const char = input.charAt(2);
  const at = input.at(-1);
  return (
    sliced.length +
    substring.length +
    substr.length +
    trimmed.length +
    trimStart.length +
    trimEnd.length +
    char.length +
    at.length
  );
}

export function scalarSpanPipeline(): i32 {
  const input = "  abcdef  ";
  const left = input.substr(1, 8);
  const leftTrimmed = left.trimStart();
  const right = input.trimEnd();
  const rightSliced = right.slice(2, -1);
  return (
    left.length * 1000 +
    leftTrimmed.length * 100 +
    right.length * 10 +
    rightSliced.length
  );
}

function asciiLowerMatch(value: string): bool {
  value = value.toLowerCase();
  return value === "abc";
}

export function packedCaseFoldPipeline(): i32 {
  let result = 0;
  if (asciiLowerMatch("xABCy".slice(1, 4))) result |= 1;
  if (asciiLowerMatch("xAbDy".slice(1, 4))) result |= 2;
  if (asciiLowerMatch("xäBCy".slice(1, 4))) result |= 4;
  if (asciiLowerMatch("xabcY".slice(1, 4))) result |= 8;
  return result;
}

function lowerUppercaseLiteral(value: string): bool {
  value = value.toLowerCase();
  return value === "ABC";
}

function lowerUnicode(value: string): bool {
  value = value.toLowerCase();
  return value === "ä";
}

function lowerConditionally(value: string, lower: bool): bool {
  if (lower) value = value.toLowerCase();
  return value === "abc";
}

function lowerScalar(value: string): i32 {
  value = value.toLowerCase();
  return value.charCodeAt(0) + (value.startsWith("a") ? 1000 : 0);
}

function compareBeforeLower(value: string, other: string): bool {
  const same = value === other;
  value = value.toLowerCase();
  return same && value === "abc";
}

export function uppercaseLiteralPipeline(): bool {
  return lowerUppercaseLiteral("xABCy".slice(1, 4));
}

export function unicodeLowercasePipeline(): bool {
  return lowerUnicode("xÄy".slice(1, 2));
}

export function conditionalLowercasePipeline(lower: bool): bool {
  return lowerConditionally("xABCy".slice(1, 4), lower);
}

export function lowercaseScalarPipeline(): i32 {
  return lowerScalar("xABCy".slice(1, 4));
}

export function comparisonBeforeLowercasePipeline(): bool {
  return compareBeforeLower("xABCy".slice(1, 4), "abc");
}

export function twoSpansPipeline(equal: bool): i32 {
  const source = equal ? "abcabc" : "abcxyz";
  const left = source.slice(0, 3);
  const right = source.slice(3, 6);
  let result = 0;
  if (left === right) result |= 1;
  if (left == right) result |= 2;
  if (left !== right) result |= 4;
  if (left != right) result |= 8;
  if (source.slice(0, 3) === right) result |= 16;
  if (left !== source.slice(3, 6)) result |= 32;
  return result;
}

function lowerExpanded(value: string): bool {
  value = value.toLowerCase();
  return value === "i\u0307";
}

function lowerInequality(value: string): bool {
  value = value.toLowerCase();
  return "ABC" !== value && value != "abd" && "abc" == value;
}

function lowerLength(value: string): i32 {
  value = value.toLowerCase();
  return value.length;
}

export function unicodeExpansionPipeline(): i32 {
  return (
    (lowerExpanded("xİy".slice(1, 2)) ? 100 : 0) +
    lowerLength("xİy".slice(1, 2))
  );
}

export function lowercaseInequalityPipeline(): bool {
  return lowerInequality("xABCy".slice(1, 4));
}

export function splitLimitPipeline(limit: i32): i32 {
  const value = " a,b,,c, ".trim();
  const parts = value.split(",", limit);
  let score = parts.length;
  for (let i = 0; i < parts.length; i++) score += parts[i].length;
  return score;
}
