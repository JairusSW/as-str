/* eslint-disable prefer-const, no-useless-assignment -- mutable owners are the regression. */
// A packed span is a raw pointer pair. Its uses name the owner to keep the
// backing string reachable, so only owners that cannot change may be packed.
function make(seed: i32): string {
  return " " + String.fromCharCode(97 + seed).repeat(12) + " ";
}

function sum(units: i32, first: i32): i32 {
  return units * 1000 + first;
}

let mutableOwner: string = make(1);
const constantOwner: string = make(2);

export function constLocal(): i32 {
  const owner = make(0);
  const constLocalSpan = owner.trim();
  return sum(constLocalSpan.length, constLocalSpan.charCodeAt(0));
}

export function unassignedLet(): i32 {
  let owner = make(3);
  const unassignedLetSpan = owner.slice(2, 8);
  return sum(unassignedLetSpan.length, unassignedLetSpan.charCodeAt(0));
}

export function constGlobal(): i32 {
  const constGlobalSpan = constantOwner.slice(1, 6);
  return sum(constGlobalSpan.length, constGlobalSpan.charCodeAt(0));
}

export function reassignedLocal(): i32 {
  let owner = make(4);
  const reassignedLocalSpan = owner.trim();
  owner = "";
  __collect();
  return sum(reassignedLocalSpan.length, reassignedLocalSpan.charCodeAt(0));
}

export function appendedLocal(): i32 {
  let owner = make(5);
  const appendedLocalSpan = owner.slice(1, 4);
  owner += "!";
  return sum(appendedLocalSpan.length, appendedLocalSpan.charCodeAt(0));
}

export function reassignedLoopOwner(): i32 {
  let owner = make(6);
  let total = 0;
  for (let round = 0; round < 3; round++) {
    const loopOwnerSpan = owner.trim();
    owner = make(7 + round);
    __collect();
    total += sum(loopOwnerSpan.length, loopOwnerSpan.charCodeAt(round));
  }
  return total;
}

export function mutableGlobal(): i32 {
  mutableOwner = make(10);
  const mutableGlobalSpan = mutableOwner.slice(2, 9);
  mutableOwner = "";
  __collect();
  return sum(mutableGlobalSpan.length, mutableGlobalSpan.charCodeAt(0));
}

export function shadowedLocal(): i32 {
  const owner = make(11);
  const shadowedLocalSpan = owner.trim();
  {
    const owner = "x";
    __collect();
    return sum(
      shadowedLocalSpan.length + owner.length,
      shadowedLocalSpan.charCodeAt(0),
    );
  }
}

export function shadowedGlobal(): i32 {
  const shadowedGlobalSpan = constantOwner.trim();
  {
    const constantOwner = "y";
    __collect();
    return sum(
      shadowedGlobalSpan.length + constantOwner.length,
      shadowedGlobalSpan.charCodeAt(0),
    );
  }
}
