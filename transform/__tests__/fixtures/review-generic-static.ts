import { Str, str } from "../../../assembly/index";

function lengthWithExplicitType<T>(input: T): i32 {
  const owner: string = input.toString();
  const piece = owner.slice(1);
  return str.length<T>(piece);
}

function concrete(input: string): i32 {
  const piece = input.slice(1);
  return str.length<string>(piece);
}

function inferred(input: string): i32 {
  const piece = input.slice(1);
  return str.length(piece);
}

function uppercase<T>(input: T): i32 {
  const owner: string = input.toString();
  const piece = owner.slice(1);
  return Str.length<T>(piece);
}

export function unresolved(): bool {
  return lengthWithExplicitType<string>("aé😀") == 3;
}

export function concreteControl(): bool {
  return concrete("aé😀") == 3;
}

export function inferredControl(): bool {
  return inferred("aé😀") == 3;
}

export function uppercaseControl(): bool {
  return uppercase<string>("aé😀") == 3;
}
