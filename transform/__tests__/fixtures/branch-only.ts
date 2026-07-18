export function branchAndAlias(input: string, choose: bool): i32 {
  let part = input.slice(1, 4);
  if (choose) part = input.substring(2, 5);
  const alias = part;
  return alias.length;
}

export function observable(choose: bool): i32 {
  return branchAndAlias("abcdef", choose);
}
