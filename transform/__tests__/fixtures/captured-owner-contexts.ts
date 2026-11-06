/* eslint-disable prefer-const, @typescript-eslint/no-namespace -- mutable globals and namespaces are distinct initializer hosts. */
// Every call passes a span-producing argument, so `score` takes a packed span.
// Its owner captures must be declared wherever these calls are rewritten.
function score(value: string): i32 {
  return value == "abcabc" ? 7 : value.length * 10 + value.indexOf("c");
}

const SOURCE = "  abcabc  ";
const moduleConstant: i32 = score(SOURCE.trim());
let moduleVariable: i32 = score(SOURCE.slice(3));

class Holder {
  field: i32 = score(SOURCE.trim());
  static shared: i32 = score(SOURCE.substring(1, 6));
  pair: i32 = score(SOURCE.slice(2)) + score(SOURCE.slice(4));
}

namespace Scope {
  export const value: i32 = score(SOURCE.slice(5));
}

export function moduleInitializers(): i32 {
  return moduleConstant * 1000 + moduleVariable + Scope.value * 100000;
}

export function fieldInitializers(): i32 {
  const holder = new Holder();
  return holder.field * 10000 + Holder.shared * 100 + holder.pair;
}

export function expressionArrow(): i32 {
  const read = (): i32 => score(SOURCE.trim());
  return read();
}

export function callbackArrow(): i32 {
  return [1, 2, 3]
    .map<i32>((offset: i32): i32 => offset + score(SOURCE.slice(offset)))
    .reduce<i32>((total: i32, value: i32): i32 => total * 31 + value, 0);
}

export function nestedArrow(): i32 {
  const outer = (): i32 => {
    const inner = (): i32 => score(SOURCE.slice(2)) + score(SOURCE.trim());
    return inner();
  };
  return outer();
}

export function blockAndArrow(): i32 {
  const direct = score(SOURCE.trim());
  const read = (): i32 => score(SOURCE.slice(3));
  return direct * 100 + read();
}
