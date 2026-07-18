import { nativeArgument, viewArgument } from "./cross-module-api";

export function convertedCall(input: string): i32 {
  return viewArgument(input);
}

export function nativeBarrier(input: string): i32 {
  const part = input.slice(1, 4);
  return nativeArgument(part);
}
