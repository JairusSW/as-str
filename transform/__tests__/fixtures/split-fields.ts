import { str } from "../../../assembly/index";

export function firstKey(input: string): i32 {
  const key = input.split("=")[0].trim();
  return key == "name" ? 1000 : key.length;
}

export function pathOnly(url: string): string {
  return url.split("?")[0];
}

export function fieldCount(line: string): i32 {
  return line.split(",").length + line.split("::").length * 100;
}

export function fieldAt(line: string, index: i32): i32 {
  const field = line.split(",")[index];
  return field.length * 10 + (field.startsWith("b") ? 1 : 0);
}

export function multiUnit(line: string): i32 {
  const middle = line.split("::")[1].trimEnd();
  return middle.length + (middle == "mid" ? 100 : 0);
}

export function fieldViews(line: string): i32 {
  // Enough uses to keep a view object rather than a packed span.
  const head = line.split(";")[0];
  let score = head.length;
  score = score * 3 + head.indexOf("x");
  score = score * 3 + (head.includes("y") ? 1 : 0);
  score = score * 3 + (head.endsWith("z") ? 1 : 0);
  score = score * 3 + head.lastIndexOf("x");
  return score;
}

export function keyValues(input: string): i32 {
  let total = 0;
  const parts = input.split(";");
  for (let i = 0; i < parts.length; i++) {
    const pair = parts[i];
    const key = pair.split("=")[0].trim();
    if (key == "a") total += 1;
    else if (key == "b") total += 10;
    total += pair.split("=").length * 100;
  }
  return total;
}

export function cursorCount(input: string): i32 {
  let rest = input.trim();
  let total = 0;
  while (rest.length > 0) {
    total = total * 10 + rest.split(",").length;
    rest = rest.slice(2);
  }
  return total;
}

class Splitter {
  split(separator: string): string[] {
    return [separator, separator + separator];
  }
}

export function userSplit(index: i32): i32 {
  return new Splitter().split("ab")[index].length;
}

export function headerArray(header: string): i32 {
  const parts = header.split(":");
  if (parts.length < 2) return -1;
  return parts[1].trim().length * 10 + parts.length - 1;
}

export function literalArray(index: i32): i32 {
  const parts = "a,bb,ccc".split(",");
  return index > 0 ? parts[2].length : parts[0].length + parts.length;
}

export function missingField(line: string): i32 {
  const parts = line.split(",");
  return parts[3].length;
}

function total(values: string[]): i32 {
  return values.length;
}

export function arrayEscapes(line: string, index: i32): i32 {
  const indexed = line.split(",");
  const written = line.split(",");
  written[0] = "changed";
  let replaced = line.split(",");
  if (index > 2) replaced = line.split(";");
  let receiver = line;
  const moved = receiver.split(",");
  receiver = "x,y,z,w";
  return (
    indexed[index].length +
    written[0].length * 10 +
    replaced.length * 100 +
    moved[0].length * 1000 +
    total(line.split(",")) * 10000 +
    receiver.length
  );
}

function nativeField(value: string): i32 {
  return value.length * 3;
}

export function fieldLoops(input: string): i32 {
  const parts = input.split(",");
  let total = parts.length;
  for (let i = 0; i < parts.length; i++) {
    const field = parts[i].trim();
    if (field == "") continue;
    if (field == "stop") break;
    total = total * 7 + field.length + nativeField(parts[i]);
  }
  for (let j = 0; j < parts.length; j += 1) total += parts[j].length;
  return total;
}

export function packedReceiverLoop(url: string): i32 {
  const query = url.substring(url.indexOf("?") + 1);
  const pairs = query.split("&");
  let found = 0;
  for (let i = 0; i < pairs.length; i++) {
    const pair = pairs[i];
    const eq = pair.indexOf("=");
    const name = eq < 0 ? pair : pair.substring(0, eq);
    if (name == "key") found = found * 10 + i + 1;
  }
  return found;
}

export function irregularLoops(input: string): i32 {
  const skipped = input.split(",");
  let total = 0;
  for (let i = 0; i < skipped.length; i++) {
    total += skipped[i].length;
    if (total > 3) i++;
  }
  const paired = input.split(",");
  for (let i = 0; i < paired.length - 1; i++)
    total = total * 3 + paired[i + 1].length;
  return total;
}

export function viewSplitMutation(): i32 {
  const view = str.from("a,b");
  const parts = view.split(",");
  view.set(str.from("x,y,z"));
  return parts[0].charCodeAt(0);
}

function mutateSplit(value: string): void {
  store<u16>(changetype<usize>(value), 120);
}

export function nativeSplitMutation(): i32 {
  const input = String.fromCharCodes([97, 44, 98]);
  const parts = input.split(",");
  mutateSplit(input);
  return parts[0].charCodeAt(0);
}

const source: string = "a,b";
// eslint-disable-next-line @typescript-eslint/no-namespace -- regression: namespace-local owner resolution.
namespace SplitOwner {
  let source: string = "a,b";
  function change(): void {
    source = "x,y,z";
  }
  export function read(): i32 {
    source = "a,b";
    const parts = source.split(",");
    change();
    return parts[0].charCodeAt(0);
  }
}

export function namespacedSplitOwner(): i32 {
  return SplitOwner.read() + source.length;
}

function dynamicView(): str {
  return str.from(String.fromCharCodes([97, 44, 98]));
}

export function viewSplitGc(): i32 {
  const view = dynamicView();
  const parts = view.split(",");
  view.set(str.from("x,y,z"));
  let total = 0;
  for (let i = 0; i < 2048; i++) {
    const values = new Array<i32>(128);
    total += values.length;
  }
  return parts[0].charCodeAt(0) + total;
}
