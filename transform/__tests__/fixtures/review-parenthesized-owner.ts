let survivors = new Array<string>();
function recycle(): i32 {
  __collect();
  __collect();
  __collect();
  survivors = new Array<string>();
  for (let i = 0; i < 200; i++) survivors.push("B".repeat(1024));
  return 0;
}
function changedParameter(text: string): string {
  // prettier-ignore
  ((text)) = "A".repeat(1024);
  return text.slice(0);
}
export function parameterOwner(): i32 {
  const input = "old";
  return changedParameter(input).charCodeAt(recycle());
}
export function localOwner(): i32 {
  let owner = "A".repeat(1024);
  const parenthesizedOwnerSpan = owner.slice(0);
  // prettier-ignore
  ((owner)) = "new"; // eslint-disable-line no-useless-assignment -- deliberately discard the backing owner before GC.
  recycle();
  return parenthesizedOwnerSpan.charCodeAt(0);
}
