import { str, str8 } from "../../assembly/index";

const strings = new Array<string>();
const bytes = new Array<str8>();
const SEARCHES = [
  "import ",
  "function ",
  "return ",
  "const ",
  "toString",
  "not_a_real_identifier",
];

export function addRecord(value: string): void {
  strings.push(value);
  // Input encoding is setup work. The UTF-8 workload starts with owned bytes.
  bytes.push(str8.from(value));
}

function eq<T>(value: T, needle: string): bool {
  if (isString<T>()) return changetype<string>(value) == needle;
  return value.equalsString(needle);
}

function headers<T>(value: T): i32 {
  const lines = value.split("\r\n");
  let score = 0;
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    const colon = line.indexOf(":");
    if (colon < 0) continue;
    const key = line.slice(0, colon).trim().toLowerCase();
    const field = line.slice(colon + 1).trim();
    score += field.length;
    if (eq(key, "host")) score += 101;
    if (eq(key, "content-type") && field.startsWith("application/json"))
      score += 211;
    if (eq(key, "authorization") && field.startsWith("Bearer ")) score += 307;
    if (eq(key, "cache-control") && field.includes("max-age=")) score += 401;
    if (eq(key, "x-request-id")) score += 503;
  }
  return score;
}

function routes<T>(value: T): i32 {
  const question = value.indexOf("?");
  const pathname = value.slice(0, question < 0 ? value.length : question);
  let score = pathname.lastIndexOf("/") + 1;
  if (pathname.startsWith("/api/")) score += 101;
  if (pathname.endsWith(".json")) score += 211;
  if (pathname.endsWith(".wasm")) score += 307;
  if (question < 0) return score;
  const params = value.slice(question + 1).split("&");
  for (let i = 0; i < params.length; i++) {
    const pair = params[i].split("=", 2);
    if (pair.length < 2) continue;
    if (eq(pair[0], "page")) score += 401;
    if (eq(pair[0], "lang")) score += 503;
    if (eq(pair[0], "q")) score += 601;
    score += pair[1].length;
  }
  return score;
}

function logs<T>(value: T): i32 {
  let score = 0;
  if (value.includes(" ERROR ")) score += 101;
  if (value.includes(" WARN ")) score += 211;
  if (value.includes("status=500")) score += 307;
  const trace = value.lastIndexOf(" trace=");
  if (trace >= 0) score += value.slice(trace + 7).length;
  const fields = value.split(" ", 5);
  score += fields.length;
  if (fields.length > 3 && fields[3].startsWith("/api/")) score += 401;
  return score;
}

function tsv<T>(value: T): i32 {
  const fields = value.split("\t");
  let score = fields.length;
  for (let i = 0; i < fields.length; i++) {
    const field = fields[i].trim();
    score += field.length;
    if (eq(field, "active")) score += 101;
    if (eq(field, "pending")) score += 211;
    if (field.endsWith("@example.org")) score += 307;
  }
  return score;
}

function normalize16(value: str): i32 {
  const lower = str.from(value.trim().toLowerCase());
  const lines = str.from(lower.replaceAll("\r\n", "\n"));
  const result = str.from(lines.replaceAll("  ", " "));
  return (
    result.length + 31 * result.indexOf("error") + 17 * result.lastIndexOf("\n")
  );
}

function normalize8(value: str8): i32 {
  const result = value
    .trim()
    .toLowerCase()
    .replaceAll("\r\n", "\n")
    .replaceAll("  ", " ");
  return (
    result.length + 31 * result.indexOf("error") + 17 * result.lastIndexOf("\n")
  );
}

function source<T>(value: T): i32 {
  let score = 0;
  for (let i = 0; i < SEARCHES.length; i++) {
    const needle = SEARCHES[i];
    score += value.indexOf(needle) + value.lastIndexOf(needle);
  }
  return score;
}

function jsonFilter<T>(value: T): i32 {
  let score = 0;
  if (value.includes('"level":"error"')) score += 101;
  if (value.includes('"active":true')) score += 211;
  if (value.includes('"region":"eu-west-1"')) score += 307;
  if (value.includes('"retry":true')) score += 401;
  score += value.indexOf('"message":') + value.lastIndexOf('"id":');
  return score;
}

function encodeView16(value: str): i32 {
  const encoded = value.trim().toStr8();
  return (
    encoded.length +
    3 * encoded.byteAt(0) +
    7 * encoded.byteAt(encoded.length - 1)
  );
}

function encodeView8(value: str8): i32 {
  const decoded = value.trim().toStr();
  return (
    decoded.length +
    3 * decoded.charCodeAt(0) +
    7 * decoded.charCodeAt(decoded.length - 1)
  );
}

function extract<T>(value: T): i32 {
  const method = value.before(" ");
  const target = value.between(" ", " HTTP/");
  const query = target.after("?");
  const pathname = target.includes("?") ? target.before("?") : target;
  const resource = pathname.afterLast("/");
  const page = query.after("page=").before("&");
  return (
    (eq(method, "GET") ? 101 : 211) +
    resource.length +
    page.length +
    query.length
  );
}

// Native text and already-encoded buffers are both common message inputs.
function messageSize<T>(value: T): i32 {
  return str8.isEmpty(value) ? 0 : str8.UTF8.byteLength(value);
}

// Specialize each timed export to one workflow. A shared dynamic dispatcher
// would let unrelated workload code alter compiler inlining decisions.
// @ts-ignore: decorator
@inline function dispatch<T>(kind: i32, value: T): i32 {
  if (kind == 0) return headers(value);
  if (kind == 1) return routes(value);
  if (kind == 2) return logs(value);
  if (kind == 3) return tsv(value);
  if (kind == 5) return source(value);
  if (kind == 8) return extract(value);
  return jsonFilter(value);
}

// @ts-ignore: decorator
@inline export function one16(kind: i32, index: i32): i32 {
  if (kind == 10) return textMetadata(strings[index]);
  if (kind == 9) return messageSize(strings[index]);
  const value = str.from(strings[index]);
  if (kind == 7) return encodeView16(value);
  return kind == 4 ? normalize16(value) : dispatch(kind, value);
}

// @ts-ignore: decorator
@inline export function one8(kind: i32, index: i32): i32 {
  const value = bytes[index];
  if (kind == 10) return textMetadata(value);
  if (kind == 9) return messageSize(value);
  if (kind == 7) return encodeView8(value);
  return kind == 4 ? normalize8(value) : dispatch(kind, value);
}

// @ts-ignore: decorator
@inline function run16(kind: i32, count: i32): i32 {
  let sum = 0;
  for (let i = 0; i < count; i++) sum += one16(kind, i % strings.length);
  return sum;
}

// @ts-ignore: decorator
@inline function run8(kind: i32, count: i32): i32 {
  let sum = 0;
  for (let i = 0; i < count; i++) sum += one8(kind, i % bytes.length);
  return sum;
}

export function headers16(count: i32): i32 {
  return run16(0, count);
}
export function headers8(count: i32): i32 {
  return run8(0, count);
}
export function routes16(count: i32): i32 {
  return run16(1, count);
}
export function routes8(count: i32): i32 {
  return run8(1, count);
}
export function logs16(count: i32): i32 {
  return run16(2, count);
}
export function logs8(count: i32): i32 {
  return run8(2, count);
}
export function tsv16(count: i32): i32 {
  return run16(3, count);
}
export function tsv8(count: i32): i32 {
  return run8(3, count);
}
export function normalize16Work(count: i32): i32 {
  return run16(4, count);
}
export function normalize8Work(count: i32): i32 {
  return run8(4, count);
}
export function source16(count: i32): i32 {
  return run16(5, count);
}
export function source8(count: i32): i32 {
  return run8(5, count);
}
export function json16(count: i32): i32 {
  return run16(6, count);
}
export function json8(count: i32): i32 {
  return run8(6, count);
}

export function encoding16(count: i32): i32 {
  return run16(7, count);
}
export function encoding8(count: i32): i32 {
  return run8(7, count);
}
export function extract16(count: i32): i32 {
  return run16(8, count);
}
export function extract8(count: i32): i32 {
  return run8(8, count);
}

export function sizing16(count: i32): i32 {
  return run16(9, count);
}
export function sizing8(count: i32): i32 {
  return run8(9, count);
}

function textMetadata<T>(value: T): i32 {
  return (str8.isAscii(value) ? 101 : 211) + str8.codePointCount(value);
}
export function metadata16(count: i32): i32 {
  return run16(10, count);
}
export function metadata8(count: i32): i32 {
  return run8(10, count);
}
