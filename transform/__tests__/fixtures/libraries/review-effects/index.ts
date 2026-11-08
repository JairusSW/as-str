export function mutate(value: string): void {
  store<u16>(changetype<usize>(value) + 2, 120);
}
export function pure(s: string): i32 {
  return s.length;
}
export function nested(s: string): void {
  mutate(s);
}
export class Changer {
  constructor(s: string) {
    mutate(s);
  }
}
export class Reader {
  constructor(public source: string) {}
  get value(): i32 {
    return this.source.length;
  }
}
export function callback(s: string, change: (s: string) => void): void {
  change(s);
}
export function observedLength(s: string): i32 {
  return s.length;
}
export class Base {
  change(s: string): void {
    pure(s);
  }
}
class Derived extends Base {
  change(s: string): void {
    mutate(s);
  }
}
export const changer: Base = new Derived();

export declare function hostChange(s: string): void;
