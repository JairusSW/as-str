export function allocationPaths(input: string): i32 {
  const sliced = input.slice(1, 8);
  const substring = sliced.substring(1, 5);
  const trimmed = substring.trim();
  const left = input.trimStart();
  const right = input.trimEnd();
  const char = input.charAt(2);
  return (
    sliced.length +
    substring.length +
    trimmed.length +
    left.length +
    right.length +
    char.length
  );
}
