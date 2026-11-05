function measureDependent(value: string, length: i32 = value.length): i32 {
  return value.length + length;
}
export function run(): i32 {
  return measureDependent("abcdef".slice(1, 4));
}
