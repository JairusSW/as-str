import { str, str8 } from "../../../assembly/index";
import { checkedBufferBytes, checkedStringBytes } from "../../../assembly/util";

export function safeLength(input: string): i32 {
  const part = input.slice(1, 4);
  return part.length;
}

export function arraySliceLength(): i32 {
  const values = [10, 20, 30];
  return values.slice(0, 99).length;
}

let current = "A";
function left(): string {
  current = "B";
  return "B";
}
export function equalityOrder(): bool {
  current = "A";
  return left() === current.slice(0);
}

function matches(value: string): bool {
  value = value.toLowerCase();
  return value === "A";
}
export function lowercaseEquality(): bool {
  return matches("a".slice(0));
}

export function twoSlices(): bool {
  const left = "xabc".slice(1);
  const right = "yabc".slice(1);
  return left === right;
}

export function betweenEmpty(): i32 {
  return str.betweenLength("abc", "b", "");
}

export function malformedTailCount(): i32 {
  const tail = str8.from("é").slice(1);
  return tail.codePointCount() * 10 + tail.sliceChars(0, 1).length;
}
export function malformedTailCodePoint(): i32 {
  return str8.from("é").slice(1).codePointAt(0);
}

export function invalidUtf16Range(): i32 {
  return str.fromRange("ok", -1, 0).charCodeAt(0);
}
export function invalidUtf8Range(): i32 {
  return str8.fromRange(str8.from("ok").buffer, 0, 3).byteAt(0);
}
export function invalidUtf8Buffer(): i32 {
  const buf = new ArrayBuffer(1);
  store<u8>(changetype<usize>(buf), 0xa9);
  return str8.fromBufferChecked(buf).codePointCount();
}
export function invalidGenericReceiver(): i32 {
  return str.length([1, 2, 3]);
}
export function oversizedRepeat(): i32 {
  return str.repeat("ab", 1 << 30).length;
}
export function oversizedStringBytes(): usize {
  return checkedStringBytes(<u64>i32.MAX_VALUE + 1);
}
export function oversizedBufferBytes(): usize {
  return checkedBufferBytes(<u64>i32.MAX_VALUE + 1);
}
export function negativeRepeat(): i32 {
  return str.repeat("ab", -1).length;
}
export function atOutOfRange(): i32 {
  return "abc".at(99).length;
}

class TextHolder {
  value: string = "";
}
class NumberHolder {
  value: i32[] = [1, 2, 3];
}
export function collidingFieldNames(): i32 {
  if (new TextHolder().value.length > 99) return 0;
  const holder = new NumberHolder();
  return holder.value.slice(0, 2).length;
}

export function lowercaseIdentity(): bool {
  const input = "already-lowercase";
  const a = input.toLowerCase();
  const b = input.toLowerCase();
  return changetype<usize>(a) == changetype<usize>(b);
}

export function nativeTrimLength(): i32 {
  return "   x".trim().length;
}

export function fusedChain(input: string): bool {
  return input.slice(2).substring(0, 3).startsWith("GET");
}

export function directIndexOf(input: string, needle: string): i32 {
  return input.indexOf(needle, 1);
}

export function localSpanChain(input: string): i32 {
  const outer = input.slice(1, 8);
  const inner = outer.substring(1, 5);
  return outer.length + inner.length;
}

export function localSpanQuery(input: string): bool {
  const part = input.slice(1, 4);
  return part.startsWith("b");
}

export function reassignedOwner(input: string): bool {
  let source = input;
  const part = source.slice(0, 2);
  source = "";
  return part.startsWith("ok") && source.length == 0;
}

export function shadowedLocals(input: string): i32 {
  let total = 0;
  {
    const part = input.slice(0, 1);
    total += part.length;
  }
  {
    const part = [1, 2, 3].slice(0, 2);
    total += part.length;
  }
  return total;
}

export function localSpanChainCheck(): i32 {
  return localSpanChain("xabcdefghi");
}

export function localSpanQueryCheck(): bool {
  return localSpanQuery("abcd");
}

export function reassignedOwnerCheck(): bool {
  return reassignedOwner("okay");
}

export function shadowedLocalsCheck(): i32 {
  return shadowedLocals("abc");
}

export function fusedChainCheck(): bool {
  return fusedChain("xxGET route");
}

export function directIndexOfCheck(): i32 {
  return directIndexOf("abcabc", "bc");
}
