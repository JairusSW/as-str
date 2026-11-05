let trace: i32 = 0;
function measure(value: string): i32 {
  trace = trace * 10 + 2;
  return value.length;
}
let observed: i32 = 0;
function finish(value: i32): i32 {
  return observed + value;
}
function factory(value: i32): (value: i32) => i32 {
  trace = trace * 10 + 3;
  observed = value;
  return finish;
}
export function callResult(): i32 {
  return factory(measure("abcdef".slice(1, 4)))(0);
}
const callbacks: ((value: i32) => i32)[] = [finish, finish, finish, finish];
export function indexedCallee(): i32 {
  observed = 0;
  return callbacks[measure("abcdef".slice(1, 4))](3);
}
export function commaCallee(): i32 {
  observed = 0;
  return (measure("abcdef".slice(1, 4)), finish)(3);
}

function bound(): i32 {
  trace = trace * 10 + 1;
  return 1;
}
function argument(): i32 {
  trace = trace * 10 + 4;
  return 0;
}
export function calleeOrder(): i32 {
  trace = 0;
  const result = factory(measure("abcdef".slice(bound(), 4)))(argument());
  return trace * 10 + result;
}
export function indexOrder(): i32 {
  trace = 0;
  observed = 3;
  const result = callbacks[measure("abcdef".slice(bound(), 4))](argument());
  return trace * 10 + result;
}
