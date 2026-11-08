export function run(): i32 {
  const source = "abcdef";
  return source.slice(1)[0].length;
}

export function first(source: string): string {
  return source.slice(1)[0];
}

export function firstCode(): i32 {
  return first("abcdef").charCodeAt(0);
}

export function promotedString(): bool {
  const source = "abcdef";
  const part = source.slice(1);
  return part.length == 5 && part.charCodeAt(1) == 99
    ? part[0].toString() == "b"
    : false;
}

export function promotedLength(): i32 {
  const source = "abcdef";
  const part = source.slice(1);
  return part[0].length + part.length + part.charCodeAt(1);
}
