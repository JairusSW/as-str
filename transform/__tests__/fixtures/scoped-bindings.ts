export function scopedAssignmentConversions(): i32 {
  let score = 0;
  {
    let value: string = "a";
    score += value.length;
    value = str.from("abc");
    score += value.length;
  }
  {
    let value: str = str.from("b");
    score += value.length;
    value = "abcd";
    score += value.length;
  }
  return score;
}
