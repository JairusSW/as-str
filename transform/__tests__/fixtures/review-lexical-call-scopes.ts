/* eslint-disable @typescript-eslint/no-unused-vars, no-constant-condition, no-empty, no-case-declarations -- intentional lexical-scope collision controls. */
import { str } from "../../../assembly/index";
import { target } from "./review-scope-native";

function view(value: str): i32 {
  return value.length;
}

export function loop(): i32 {
  for (let target: (value: str) => i32 = view; false; ) {}
  return target("abc");
}

export function loopRenamed(): i32 {
  for (let local: (value: str) => i32 = view; false; ) {}
  return target("abc");
}

export function loopBlock(): i32 {
  {
    for (let target: (value: str) => i32 = view; false; ) {}
  }
  return target("abc");
}

export function switchCase(): i32 {
  switch (0) {
    case 0:
      const target: (value: str) => i32 = view;
      break;
  }
  return target("abc");
}

export function switchRenamed(): i32 {
  switch (0) {
    case 0:
      const local: (value: str) => i32 = view;
      break;
  }
  return target("abc");
}
