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
