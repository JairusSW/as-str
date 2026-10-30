export function query(length: i32, mismatch: i32, shape: i32): i32 {
  let left = "L";
  let right = "R";
  for (let i = 0; i < length; i++) {
    const code = <u16>(i * 257 + 0xd780);
    left += String.fromCharCode(code);
    right += String.fromCharCode(i === mismatch ? code ^ 0x80 : code);
  }
  if (shape === 1 && length > 0) right = right.slice(0, -1);
  if (shape === 2) right += "z";
  left += "X";
  right += "Y";
  return left.slice(1, -1).localeCompare(right.slice(1, -1));
}
