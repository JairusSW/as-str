import { str8 } from "../../assembly/index";

const strings = new Array<string>();
const encoded = new Array<str8>();
export function addRecord(value: string): void {
  strings.push(value);
  encoded.push(str8.from(value));
}
export function one16(index: i32): i32 {
  return str8.compare(strings[index], strings[(index + 1) % strings.length]);
}
export function one8(index: i32): i32 {
  return str8.compare(encoded[index], encoded[(index + 1) % encoded.length]);
}
export function run16(count: i32): i32 {
  let hash = 0;
  for (let i = 0; i < count; i++) hash = hash * 31 + one16(i % strings.length);
  return hash;
}
export function run8(count: i32): i32 {
  let hash = 0;
  for (let i = 0; i < count; i++) hash = hash * 31 + one8(i % encoded.length);
  return hash;
}
