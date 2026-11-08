import { Text, makeText } from "./types";

function measure(value: Text): i32 {
  return value.length;
}

export function read(): i32 {
  const source = makeText();
  return measure(source.slice(1));
}
