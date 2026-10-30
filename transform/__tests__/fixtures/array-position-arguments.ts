let calls = 0;
function position(value: i32): i32 {
  calls++;
  return value;
}
export function viewPositions(): i32 {
  const values = new Array<str>(3);
  const needle = str.from("abc");
  calls = 0;
  values.fill(needle, position(1), position(3));
  const first = values.indexOf(needle, position(1));
  const last = values.lastIndexOf(needle, position(2));
  const included = values.includes(needle, position(2));
  return calls * 1000 + first * 100 + last * 10 + (included ? 1 : 0);
}
export function nativePositions(): i32 {
  const values = new Array<string>(3);
  values.fill("abc", 1, 3);
  return (
    values.indexOf("abc", 1) * 100 +
    values.lastIndexOf("abc", 2) * 10 +
    (values.includes("abc", 2) ? 1 : 0)
  );
}
