enum str {
  Value = 7,
}
export function run(): i32 {
  return "abc".includes("b", 0) ? str.Value : 0;
}
