function unrelated(str: i32): i32 {
  return str + 1;
}

function unrelatedUpper(Str: i32): i32 {
  return Str + 1;
}

type View = Str;

export function localLower(): i32 {
  return str.from("abc").length + unrelated(1);
}

export function localUpper(): i32 {
  return Str.from("abc").length + unrelatedUpper(1);
}

export function typeAlias(): i32 {
  return new Array<View>().length;
}

export function laterGeneric(): i32 {
  return new Map<i32, str>().size;
}

export function commentedLower(): i32 {
  // prettier-ignore
  return str /* formatting must not affect demand */ ("abc").length;
}

export function commentedUpper(): i32 {
  return Str /* formatting must not affect demand */.from("abc").length;
}
