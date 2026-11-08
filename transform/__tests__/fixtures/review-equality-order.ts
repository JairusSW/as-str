export function run(): bool {
  const input = "abc";
  let part = input.slice(0);
  return ((part = part.slice(1)), "bc") == part;
}

export function notEqual(): bool {
  const input = "abc";
  let part = input.slice(0);
  return ((part = part.slice(1)), "bc") != part;
}
