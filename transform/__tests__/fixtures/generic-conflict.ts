function identity<T>(value: T): T {
  return value;
}

export function stringInstantiation(): i32 {
  const value = identity<string>("hello");
  return value.length;
}

export function numberInstantiation(input: i32): i32 {
  const value = identity<i32>(input);
  return value;
}
