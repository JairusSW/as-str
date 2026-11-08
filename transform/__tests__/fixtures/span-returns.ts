/* eslint-disable no-useless-assignment -- reassigned parameters are regression cases. */
function firstLine(text: string): string {
  const newline = text.indexOf("\n");
  return newline < 0 ? text : text.slice(0, newline);
}

function extension(name: string): string {
  return name.slice(name.lastIndexOf(".") + 1).trim();
}

export function lineMethod(request: string): i32 {
  const line = firstLine(request);
  const space = line.indexOf(" ");
  return (
    (space < 0 ? line.length : space) +
    (firstLine(request) == "GET /" ? 100 : 0)
  );
}

export function extensions(): i32 {
  const name = "archive.TAR ";
  return (
    extension(name).length +
    (extension("a.ts") == "ts" ? 10 : 0) +
    (extension(name).startsWith("TAR") ? 100 : 0)
  );
}

// Called from a native position, where a span would cost a copy.
function prefix(text: string): string {
  return text.slice(0, 2);
}

export function nativeUse(text: string): string {
  return prefix(text);
}

export function prefixLength(text: string): i32 {
  return prefix(text).length;
}

function computedArgument(text: string): string {
  return text.slice(1);
}

export function computed(text: string): i32 {
  return computedArgument(text + "!").length;
}

function reassigned(text: string): string {
  text = text.trim();
  return text.slice(1);
}

export function reassignedUse(text: string): i32 {
  return reassigned(text).length;
}

function either(left: string, right: string, flag: bool): string {
  return flag ? left.slice(1) : right.slice(1);
}

export function eitherUse(flag: bool): i32 {
  const left = "abc";
  const right = "wxyz";
  return either(left, right, flag).length;
}

function identity(text: string): string {
  return text;
}

export function identityUse(text: string): i32 {
  return identity(text).length;
}

export function exportedSlice(text: string): string {
  return text.slice(1);
}

export function exportedUse(text: string): i32 {
  return exportedSlice(text).length;
}

function sameAddress(left: string, right: string): bool {
  return changetype<usize>(left) == changetype<usize>(right);
}

function tail(text: string): string {
  return text.slice(1);
}

export function rawCaller(): bool {
  const text = "abc";
  return sameAddress(text, text) && tail(text).length == 2;
}

class ShadowBox {
  slice(start: i32): string {
    return start ? "safe" : "other";
  }
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars -- regression: a local hides this parameter.
function shadowed(value: string): string {
  {
    const value = new ShadowBox();
    return value.slice(1);
  }
}

export function shadowReturn(): i32 {
  const input = "abcdef";
  return shadowed(input).length;
}

function earlyFirstLine(text: string): string {
  const nl = text.indexOf("\n");
  if (nl < 0) return text;
  return text.slice(0, nl);
}
export function earlyLine(text: string): i32 {
  return earlyFirstLine(text).length;
}

function directory(path: string): string {
  const slash = path.lastIndexOf("/");
  return slash < 0 ? "" : path.slice(0, slash);
}

export function directories(): i32 {
  const nested = "a/b/c.ts";
  const flat = "c.ts";
  return (
    directory(nested).length * 10 +
    directory(flat).length +
    (directory(nested) == "a/b" ? 100 : 0) +
    (directory(flat) == "" ? 1000 : 0)
  );
}
