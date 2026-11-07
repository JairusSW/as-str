import {
  mutate,
  pure,
  nested,
  Changer,
  Reader,
  callback,
  changer,
} from "review-effects";
export function run(): bool {
  const source = String.fromCharCodes([97, 98, 99, 100, 101, 102]);
  const part = source.slice(1, 4);
  mutate(source);
  return part == "bcd";
}
export function pureControl(source: string): i32 {
  const part = source.slice(1, 4);
  return part.length + pure(source);
}

export function nestedCall(): bool {
  const source = String.fromCharCodes([97, 98, 99, 100, 101, 102]);
  const part = source.slice(1, 4);
  nested(source);
  return part == "bcd";
}
export function constructed(): bool {
  const source = String.fromCharCodes([97, 98, 99, 100, 101, 102]);
  const part = source.slice(1, 4);
  new Changer(source);
  return part == "bcd";
}
export function indirect(): bool {
  const source = String.fromCharCodes([97, 98, 99, 100, 101, 102]);
  const part = source.slice(1, 4);
  callback(source, mutate);
  return part == "bcd";
}
export function pureConstructor(source: string): i32 {
  const part = source.slice(1, 4);
  return part.length + new Reader(source).value;
}

export function virtualCall(): bool {
  const source = String.fromCharCodes([97, 98, 99, 100, 101, 102]);
  const part = source.slice(1, 4);
  changer.change(source);
  return part == "bcd";
}
