export function repeatIdentity(): bool {
  // @as-str prefer-view
  const value = "abcdef".slice(1, 4);
  return (
    changetype<usize>(value.repeat(1)) == changetype<usize>(value.repeat(1))
  );
}
export function paddingIdentity(): bool {
  // @as-str prefer-view
  const value = "abcdef".slice(1, 4);
  return (
    changetype<usize>(value.padStart(0)) == changetype<usize>(value.padStart(0))
  );
}
export function emptyPaddingIdentity(): bool {
  // @as-str prefer-view
  const value = "abcdef".slice(1, 4);
  return (
    changetype<usize>(value.padEnd(20, "")) ==
    changetype<usize>(value.padEnd(20, ""))
  );
}
export function aliases(): bool {
  // @as-str prefer-view
  const value = "abcdef".slice(1, 4);
  const first = value.repeat(1);
  const second = value.repeat(1);
  return changetype<usize>(first) == changetype<usize>(second);
}
export function lowercaseIdentity(): bool {
  // @as-str prefer-view
  const value = "abc";
  return (
    changetype<usize>(value.toLowerCase()) ==
    changetype<usize>(value.toLowerCase())
  );
}
function same(value: string): bool {
  return (
    changetype<usize>(value.repeat(1)) == changetype<usize>(value.repeat(1))
  );
}
export function parameterIdentity(): bool {
  return same("abcdef".slice(1, 4));
}
