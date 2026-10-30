import { str, str8 } from "../../index";

export function repeat16Overflow(): void {
  str.repeat("ab", 0x40000000);
}

export function repeat8Overflow(): void {
  str8.repeat("abcd", 0x40000000);
}

export function replaceAll16Overflow(): void {
  str.replaceAll("a".repeat(65536), "a", "b".repeat(65536));
}

export function replaceAll8Overflow(): void {
  str8.replaceAll("a".repeat(65536), "a", "b".repeat(65536));
}

export function replaceAll16EmptyOverflow(): void {
  str.replaceAll("a".repeat(65535), "", "b".repeat(65536));
}

export function replaceAll8EmptyOverflow(): void {
  str8.replaceAll("a".repeat(65535), "", "b".repeat(65536));
}

export function checkedUtf8Invalid(): void {
  const bytes = new ArrayBuffer(1);
  store<u8>(changetype<usize>(bytes), 0xff);
  str8.fromBufferChecked(bytes);
}

export function checkedUtf8Valid(): bool {
  const bytes = String.UTF8.encode("ok 世界");
  return str8.fromBufferChecked(bytes).toString() == "ok 世界";
}
