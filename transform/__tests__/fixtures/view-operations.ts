export function allViewOperations(input: string): i32 {
  const sliced = input.slice(1, 3);
  const substring = input.substring(1, 3);
  const substr = input.substr(1, 2);
  const trimmed = input.trim();
  const trimStart = input.trimStart();
  const trimEnd = input.trimEnd();
  const trimLeft = input.trimLeft();
  const trimRight = input.trimRight();
  const char = input.charAt(1);
  const at = input.at(1);
  const before = input.before("=");
  const after = input.after("=");
  const between = input.between("[", "]");
  const beforeLast = input.beforeLast("=");
  const afterLast = input.afterLast("=");
  const betweenLast = input.betweenLast("<", ">");

  return (
    sliced.length +
    substring.length +
    substr.length +
    trimmed.length +
    trimStart.length +
    trimEnd.length +
    trimLeft.length +
    trimRight.length +
    char.length +
    at.length +
    before.length +
    after.length +
    between.length +
    beforeLast.length +
    afterLast.length +
    betweenLast.length
  );
}
