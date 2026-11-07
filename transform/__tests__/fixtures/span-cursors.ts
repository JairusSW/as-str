/* eslint-disable no-useless-assignment -- overwritten cursors are regression cases. */
export function countWords(text: string): i32 {
  let count = 0;
  let rest = text.trim();
  while (rest.length > 0) {
    const space = rest.indexOf(" ");
    if (space < 0) {
      count++;
      break;
    }
    if (rest.substring(0, space).length > 0) count++;
    rest = rest.substring(space + 1).trimStart();
  }
  return count;
}

export function forIncrementor(text: string): i32 {
  let sum = 0;
  for (let rest = text.trimStart(); rest.length > 0; rest = rest.slice(2)) {
    sum = sum * 3 + rest.charCodeAt(0);
  }
  return sum;
}

export function siblingSpan(text: string): i32 {
  const head = text.trim();
  let part = head.slice(0, 3);
  let score = part.length;
  part = head.slice(-3).trimEnd();
  score = score * 10 + part.length;
  if (part == "xyz") score += 1000;
  part = text.substring(2, 4);
  return score * 10 + part.length + (part == "bc" ? 100000 : 0);
}

export function literalOwner(cut: i32): i32 {
  let view = "  literal owner  ".trim();
  view = view.slice(cut);
  return view.length + (view.startsWith("owner") ? 100 : 0);
}

export function otherOwner(left: string, right: string): i32 {
  let view = left.trim();
  view = right.trim();
  return view.length;
}

export function assignmentValue(text: string): i32 {
  let rest = text.trim();
  let total = 0;
  while ((rest = rest.slice(1)).length > 0) total += rest.length;
  return total;
}

export function literalAssignment(text: string): i32 {
  let rest = text.trim();
  if (rest.length > 3) rest = "short";
  return rest.length;
}

export function ownerReassigned(input: string): i32 {
  let text = input;
  let rest = text.slice(1);
  text = "changed";
  rest = rest.slice(1);
  return rest.length + text.length * 100;
}

export function appendAssignment(text: string): i32 {
  let rest = text.trim();
  rest += "!";
  return rest.length;
}

export function sameOwnerSibling(text: string): i32 {
  const head = text.trim();
  let part = head.slice(0, 3);
  let score = part.length;
  part = head.slice(-3).trimEnd();
  score = score * 10 + part.length;
  return score + (part == "xyz" ? 1000 : 0);
}

export function rowsByCursor(csv: string): i32 {
  let rest = csv.trim();
  let total = 0;
  while (rest.length > 0) {
    const newline = rest.indexOf("\n");
    const row = newline < 0 ? rest : rest.slice(0, newline);
    total = total * 10 + row.split(",").length;
    if (newline < 0) break;
    rest = rest.slice(newline + 1);
  }
  return total;
}

function nativeLength(value: string): i32 {
  return value.length;
}

export function escapingRows(csv: string): i32 {
  let rest = csv.trim();
  let total = 0;
  while (rest.length > 0) {
    const newline = rest.indexOf("\n");
    const row = newline < 0 ? rest : rest.slice(0, newline);
    total = total * 10 + nativeLength(row);
    if (newline < 0) break;
    rest = rest.slice(newline + 1);
  }
  return total;
}
