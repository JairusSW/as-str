/* eslint-disable no-case-declarations, @typescript-eslint/no-unused-vars -- AssemblyScript cases have independent lexical scopes */
class StringBox {
  text: string = "abc";
}
class ArrayBox {
  text: i32[] = [10, 20, 30, 40];
}
const box = new ArrayBox();
function choose(flag: i32): i32 {
  switch (flag) {
    case 0:
      const box = new StringBox();
      const part = box.text.slice(1);
      return part.length;
    default:
      const tail = box.text.slice(1);
      return tail.length;
  }
}
export function localCase(): i32 {
  return choose(0);
}
export function defaultCase(): i32 {
  return choose(1);
}
const value: string = "abcdef";
export function unresolvedShadow(): i32 {
  switch (0) {
    case 0:
      const value = [10, 20, 30, 40];
      const part = value.slice(1);
      return part.length;
    default:
      return 0;
  }
}
const items: i32[] = [10, 20, 30, 40];
function direct(flag: i32): i32 {
  switch (flag) {
    case 0:
      const items = "abc";
      const part = items.slice(1);
      return part.length;
    default:
      const tail = items.slice(1);
      return tail.length;
  }
}
export function directLocal(): i32 {
  return direct(0);
}
export function directDefault(): i32 {
  return direct(1);
}
const part: string = "abcdefgh";
function block(flag: bool): i32 {
  if (flag) {
    const part = "abc".slice(1);
    return part.length;
  }
  return part.length;
}
export function insideBlock(): i32 {
  return block(true);
}
export function outsideBlock(): i32 {
  return block(false);
}
export function caseLabel(): i32 {
  switch (3) {
    case items.slice(1).length:
      const items = "abc";
      return items.length;
    default:
      return 9;
  }
}
