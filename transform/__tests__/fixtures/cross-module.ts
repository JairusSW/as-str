import {
  nativeArgument,
  viewArgument,
} from "./cross-module-api";

function packedSpanArgument(value: string): i32 {
  return value.length + value.charCodeAt(0);
}

function packedLowerArgument(value: string): bool {
  value = value.toLowerCase();
  return value === "abc";
}

export function convertedCall(input: string): i32 {
  return viewArgument(input);
}

export function nativeBarrier(input: string): i32 {
  const part = input.slice(1, 4);
  return nativeArgument(part);
}

export function packedSpanCall(input: string): i32 {
  return packedSpanArgument(input.slice(1, 4));
}

export function packedLowerCall(input: string): bool {
  return packedLowerArgument(input.slice(1, 4));
}
