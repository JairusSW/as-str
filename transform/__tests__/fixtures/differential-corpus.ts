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
