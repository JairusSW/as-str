function callbackViewLength(value: str): i32 {
  return value.length;
}
export function typedArrowCallback(): i32 {
  const callback: (value: string) => i32 = (value: string): i32 =>
    callbackViewLength(value) + callbackViewLength(value);
  return callback("abc");
}

export function typedNamedCallback(): i32 {
  const callback: (value: string) => i32 = function namedCallback(
    value: string,
  ): i32 {
    return callbackViewLength(value) + callbackViewLength(value);
  };
  return callback("abcd");
}
function applyNativeCallback(callback: (value: string) => i32): i32 {
  return callback("abcde");
}
export function escapedArrowCallback(): i32 {
  return applyNativeCallback(
    (value: string): i32 =>
      callbackViewLength(value) + callbackViewLength(value),
  );
}
