const sourceFill: string = String.fromCharCodes([97, 98, 99, 100, 101, 102]);
const addressFill = changetype<usize>(sourceFill);
const sourceCopy: string = String.fromCharCodes([97, 98, 99, 100, 101, 102]);
const addressCopy = changetype<usize>(sourceCopy);
const replacement = changetype<usize>("x");
const sourceSimd: string = String.fromCharCodes([
  97, 98, 99, 100, 101, 102, 103, 104,
]);
const addressSimd = changetype<usize>(sourceSimd);
const sourceAtomic: string = String.fromCharCodes([97, 98, 99, 100, 101, 102]);
const addressAtomic = changetype<usize>(sourceAtomic);
const sourceEncode: string = String.fromCharCodes([97, 98, 99, 100, 101, 102]);
const addressEncode = changetype<usize>(sourceEncode);
const replacementEncode = changetype<usize>("x");
const sourceEncode16: string = String.fromCharCodes([
  97, 98, 99, 100, 101, 102,
]);
const addressEncode16 = changetype<usize>(sourceEncode16);
export function fill(): bool {
  const part = sourceFill.slice(1, 4);
  memory.fill(addressFill + 2, 120, 2);
  return part == "bcd";
}
export function copy(): bool {
  const part = sourceCopy.slice(1, 4);
  memory.copy(addressCopy + 2, replacement, 2);
  return part == "bcd";
}
export function simd(): bool {
  const part = sourceSimd.slice(1, 4);
  v128.store(addressSimd, i16x8.splat(120));
  return part == "bcd";
}
export function atomicWrite(): bool {
  const part = sourceAtomic.slice(1, 4);
  atomic.store<i32>(addressAtomic, 0x00780078);
  return part == "bcd";
}
export function encodeUnsafe(): bool {
  const part = sourceEncode.slice(1, 4);
  String.UTF8.encodeUnsafe(replacementEncode, 1, addressEncode + 2);
  return part == "bcd";
}
export function encodeUnsafe16(): bool {
  const part = sourceEncode16.slice(1, 4);
  String.UTF16.encodeUnsafe(replacementEncode, 1, addressEncode16 + 2);
  return part == "bcd";
}
class PureMemory {
  fill(): void {}
}
export function pureControl(source: string): i32 {
  const memory = new PureMemory();
  const part = source.slice(1, 4);
  memory.fill();
  return part.length;
}
