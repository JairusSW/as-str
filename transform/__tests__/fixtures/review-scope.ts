/* eslint-disable no-case-declarations, @typescript-eslint/no-unused-vars, @typescript-eslint/no-namespace -- shadowing and switch locals are the regression */
class StringBox {
  text: string = "abc";
}
class ArrayBox {
  text: i32[] = [10, 20, 30, 40];
}
const box = new StringBox();
export function switchShadow(): i32 {
  switch (0) {
    case 0:
      const box = new ArrayBox();
      const part = box.text.slice(1);
      return part.length;
    default:
      return box.text.length;
  }
}
class Box {
  length: i32 = 73;
  slice(start: i32 = 0, end: i32 = 0): Box {
    return this;
  }
}
const value: string = "abcdef";
namespace N {
  const value: Box = new Box();
  export function inspect(): i32 {
    const part = value.slice(0, 3);
    return part.length;
  }
}
export function namespaceShadow(): i32 {
  return N.inspect();
}
