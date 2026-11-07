const HEADER = "Content-Type:  application/json ; q=1 ";

export function chainedLocal(): i32 {
  const value = HEADER.substring(HEADER.indexOf(":") + 1).trim();
  return (
    (value.startsWith("application/json") ? 1 : 0) +
    value.length * 2 +
    value.indexOf(";") * 1000
  );
}

export function chainedEquality(cut: i32): i32 {
  const text = "  key = value  ";
  let out = 0;
  if (text.slice(0, cut).trim() == "key") out |= 1;
  if (text.slice(cut).trimStart().trimEnd() != "= value") out |= 2;
  if ("key" == text.substring(0, cut).trimEnd().trimStart()) out |= 4;
  return out;
}

export function chainedLength(cut: i32): i32 {
  const text = "\t a b c \n";
  return (
    text.slice(cut).trim().length +
    text.substr(1, cut).trimEnd().length * 10 +
    text.trim().slice(-cut).length * 100
  );
}

export function scalarizedRoot(): i32 {
  const line = "  name: value ; rest ";
  const head = line.trim();
  const name = head.slice(0, head.indexOf(":")).trimEnd();
  const value = head
    .slice(head.indexOf(":") + 1)
    .trim()
    .slice(0, 5);
  return (
    (name == "name" ? 1 : 0) + value.length * 10 + (value == "value" ? 100 : 0)
  );
}

let effects = 0;
function at(value: i32): i32 {
  effects = effects * 10 + value;
  return value;
}

export function argumentOrder(): i32 {
  effects = 0;
  const text = " abcdef ";
  const view = text.slice(at(1)).trim().substring(at(2), at(4)).trimEnd();
  return effects * 10 + view.length + (view == "cd" ? 1000000 : 0);
}

export function reassignedRoot(): i32 {
  let text = "  first  ";
  const view = text.slice(1).trim();
  text = "  second ";
  return view.length * 10 + (view == "first" ? 1 : 0) + text.length * 100;
}

export function staticForms(): i32 {
  const text = "  [inner]  ";
  const inner = str.slice(text.trim(), 1, -1);
  return inner.length + (inner.toString() == "inner" ? 10 : 0);
}

export function literalRoot(): i32 {
  const view = "  literal root  ".trim().slice(0, 7);
  return view.length + (view == "literal" ? 100 : 0);
}

class Fake {
  substring(start: i32): string {
    return start > 0 ? " fake " : "x";
  }
}

export function userRoot(start: i32): i32 {
  const fake = new Fake();
  const value = fake.substring(start).trim();
  return (
    value.length +
    (value == "fake" ? 10 : 0) +
    fake.substring(start).trim().length * 100
  );
}

function measure(input: string): i32 {
  const field = input.slice(input.indexOf("=") + 1).trim();
  return field.length + (field == "42" ? 100 : 0);
}

export function parameterRoot(): i32 {
  return measure("answer =  42 ") + measure("x=1") * 1000;
}

function hash(value: string): i32 {
  let out = value.length;
  for (let i = 0; i < value.length; i++) out = out * 31 + value.charCodeAt(i);
  return out;
}

function headerName(line: string): string {
  const colon = line.indexOf(":");
  return colon < 0 ? "" : line.substring(0, colon).trim().toLowerCase();
}

export function nativeResults(cut: i32): i32 {
  const text = "  Héllo, World  ";
  return (
    hash(text.slice(cut).trim()) +
    hash(text.trim().substring(0, cut).toUpperCase()) * 3 +
    hash(text.slice(0, cut).trimEnd().toLowerCase()) * 5 +
    hash(headerName("Content-TYPE : x")) * 7 +
    hash(headerName("no colon")) * 11 +
    hash("[" + text.trimStart().slice(-cut).trimEnd() + "]") * 13 +
    hash(text.trim().trim()) * 17
  );
}

function churn(value: i32): i32 {
  // Allocation while the chain is pending exercises the owner's rooting.
  return value + ("x".repeat(value + 3) + "y").length - value - 4 - value;
}

export function ownerAcrossCalls(cut: i32): i32 {
  const text = "  rooted owner  ";
  return hash(text.slice(churn(cut)).trimEnd().toUpperCase());
}

export function ternaryName(cut: i32): i32 {
  const pair = "name=value";
  const name = cut < 0 ? pair : pair.substring(0, cut);
  return name.length + (name == "name" ? 100 : 0) + (name == pair ? 1000 : 0);
}

export function ternaryLinks(flag: i32): i32 {
  const text = "  left|right  ";
  const side = flag > 0 ? text.trim().slice(0, 4) : text.slice(7).trimEnd();
  return side.length + (side == "left" ? 10 : side == "right" ? 20 : 0);
}

export function ternaryLiteral(flag: i32): i32 {
  const side = flag > 0 ? "literal" : "literal".slice(3);
  return side.length + (side.startsWith("e") ? 100 : 0);
}

export function ternaryRoots(flag: i32): i32 {
  const left = " a ";
  const right = "  bb  ";
  const side = flag > 0 ? left.trim() : right.trim();
  return side.length;
}

let ternaryEffects = 0;
function decide(flag: i32): bool {
  ternaryEffects = ternaryEffects * 10 + flag;
  return flag > 0;
}

export function ternaryEscapes(flag: i32): i32 {
  ternaryEffects = 0;
  const text = "  escaping  ";
  const side = decide(flag) ? text : text.trim();
  return hash(side) + ternaryEffects * 1000;
}

function trimmedScore(value: string): i32 {
  const trimmed = value.trim();
  return trimmed.startsWith("x") ? 1 : trimmed.length;
}

export function packedParameterCallers(): i32 {
  const padded = "  ab  ";
  return trimmedScore(padded) * 10 + trimmedScore(" x ");
}

let pairEffects = 0;
function step(value: i32): i32 {
  pairEffects = pairEffects * 10 + value;
  return value;
}

export function chainPairs(cut: i32): i32 {
  pairEffects = 0;
  const left = "  token ";
  const right = "token  x";
  let out = 0;
  if (left.trim() == right.slice(0, 5)) out |= 1;
  if (left.slice(step(1)).trim() != right.substring(0, step(cut)).trimEnd())
    out |= 2;
  if (left.trim() == new Fake().substring(cut).trim()) out |= 4;
  return out + pairEffects * 10;
}

export function spanSwitch(at: i32): i32 {
  pairEffects = 0;
  const source = "if do while ";
  let out = 0;
  for (let round = 0; round < 2; round++) {
    switch (source.substring(at, step(at) + 2).trim()) {
      case "if":
        out += 1;
        break;
      case "do":
      case "wh":
        out += 2;
      // eslint-disable-next-line no-duplicate-case, no-fallthrough -- the first label wins after a fallthrough.
      case "if":
        out += 4;
        break;
      case "":
        out += 8;
        break;
    }
  }
  switch (new Fake().substring(at).trim()) {
    case "fake":
      out += 16;
      break;
    default:
      out += 32;
  }
  return out + pairEffects * 100;
}

function stamp(value: i32): string {
  pairEffects = pairEffects * 10 + value;
  return value.toString();
}

export function concatenations(cut: i32): i32 {
  pairEffects = 0;
  const key = "  name ";
  const value = " é value  ";
  const pair = key.trim() + "=" + value.trim();
  const framed = "[" + value.slice(cut).trimEnd() + "]";
  const both = key.trim() + value.substring(0, cut);
  const ordered = key.slice(step(1)) + stamp(2) + value.slice(step(3));
  const empty = key.slice(100) + "" + value.slice(100);
  const packed = key.trim();
  const fromPacked = packed.slice(1) + "!";
  return (
    hash(pair) +
    hash(framed) * 3 +
    hash(both) * 5 +
    hash(ordered) * 7 +
    hash(empty) * 11 +
    hash(fromPacked) * 13 +
    pairEffects * 17 +
    (key.trim() + "!").length * 19
  );
}

let appended = "";
export function appendSpans(cut: i32): i32 {
  pairEffects = 0;
  const source = " alpha, beta ,gamma ";
  let out = "";
  let start = 0;
  while (true) {
    const comma = source.indexOf(",", start);
    out +=
      comma < 0
        ? source.slice(start).trim()
        : source.slice(start, comma).trim();
    if (comma < 0) break;
    out += "|";
    start = comma + 1;
  }
  out += source.slice(step(cut)).trimEnd();
  appended = "g";
  appended += source.substring(0, 3);
  return hash(out) + hash(appended) * 3 + pairEffects * 7;
}

function unchangedSubstring(value: string): string {
  return value.substring(0).trim();
}
function copiedSlice(value: string): string {
  return value.slice(0).trim();
}
function copiedSubstr(value: string): string {
  return value.substr(0).trim();
}
export function nativeChainIdentity(): i32 {
  const input = String.fromCharCodes([97, 98, 99]);
  let result = 0;
  if (changetype<usize>(unchangedSubstring(input)) == changetype<usize>(input))
    result |= 1;
  if (changetype<usize>(copiedSlice(input)) == changetype<usize>(input))
    result |= 2;
  if (changetype<usize>(copiedSubstr(input)) == changetype<usize>(input))
    result |= 4;
  return result;
}

export function nativeTrimCompatibility(leading: i32): i32 {
  const input = " ".repeat(leading) + "a";
  const concatenated = input.trim() + "!";
  const chained = input.trim().slice(0);
  return (
    input.trim().length * 10000 + concatenated.length * 100 + chained.length
  );
}

function unchangedTrimStart(value: string): string {
  return value.trimStart().trimLeft();
}
function canonicalTrimEnd(value: string): string {
  return value.trimEnd().trimStart();
}
export function nativeEmptyChainIdentity(): i32 {
  const input = changetype<string>(__new(0, idof<string>()));
  let result = 0;
  if (changetype<usize>(unchangedTrimStart(input)) == changetype<usize>(input))
    result |= 1;
  if (changetype<usize>(unchangedSubstring(input)) == changetype<usize>(input))
    result |= 2;
  if (changetype<usize>(canonicalTrimEnd(input)) == changetype<usize>(input))
    result |= 4;
  return result;
}
