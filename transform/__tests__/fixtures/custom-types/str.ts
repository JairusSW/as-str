/* eslint-disable @typescript-eslint/no-unused-vars, @typescript-eslint/no-namespace -- AssemblyScript namespace and stub method regression. */
export class Str {
  length: i32 = 31;
  slice(start: i32 = 0, end: i32 = 0): Str {
    return this;
  }
  at(index: i32): Str {
    return this;
  }
}
export type Native = string;
export type View = str;
export type Optional<T> = T | null;
export type Identity<T> = T;
export namespace Types {
  export type Native = string;
  export type View = str;
}
