/* eslint-disable @typescript-eslint/no-namespace -- AssemblyScript namespace call regression. */
namespace Local {
  export function measure(value: string): i32 {
    return value.length;
  }
}

export function run(): i32 {
  return Local.measure("abcdef".slice(1));
}
