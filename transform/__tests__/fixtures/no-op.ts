function nativeLength(value: string): i32 {
  return value.length;
}

export function rejectedPromotion(input: string): i32 {
  const part = input.slice(1, 4);
  return nativeLength(part);
}

export function nativeViewChain(input: string): i32 {
  const part = input.substring(1).trim();
  return nativeLength(part);
}
