function recursiveSlice(value: string, count: i32): i32 {
  if (count <= 0) return value.length;
  return recursiveSlice(value.slice(1), count - 1);
}

export function recursiveParameter(input: string): i32 {
  return recursiveSlice(input, 2);
}
