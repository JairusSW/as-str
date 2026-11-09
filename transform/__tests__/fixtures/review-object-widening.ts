/* eslint-disable @typescript-eslint/no-wrapper-object-types, prefer-const */
import { str } from "../../../assembly/index";

function makeView(): str {
  return str.from("abc");
}

function makeObject(): Object {
  return str.from("abc");
}

const callbackAtModule: () => Object = makeView;

function compareLocalCallback(other: Object): bool {
  const callback: () => Object = makeView;
  return callback() === other;
}

function compareParenthesizedCallback(other: Object): bool {
  const callback: () => Object = makeView;
  return callback() === other;
}

function compareModuleCallback(other: Object): bool {
  return callbackAtModule() === other;
}

function compareAssertion(other: Object): bool {
  return (str.from("abc") as Object) === other;
}

function compareAnnotatedLocal(other: Object): bool {
  const value: Object = str.from("abc");
  return value === other;
}

function compareMutable(other: Object): bool {
  let callback: () => Object = makeView;
  return callback() === other;
}

function compareWidenedTarget(other: Object): bool {
  const callback: () => Object = makeObject;
  return callback() === other;
}

export function localCallback(): i32 {
  return compareLocalCallback(str.from("abc")) ? 1 : 0;
}

export function parenthesizedCallback(): i32 {
  return compareParenthesizedCallback(str.from("abc")) ? 1 : 0;
}

export function moduleCallback(): i32 {
  return compareModuleCallback(str.from("abc")) ? 1 : 0;
}

export function asserted(): i32 {
  return compareAssertion(str.from("abc")) ? 1 : 0;
}

export function annotatedLocal(): i32 {
  return compareAnnotatedLocal(str.from("abc")) ? 1 : 0;
}

export function mutableControl(): i32 {
  return compareMutable(str.from("abc")) ? 1 : 0;
}

export function widenedTargetControl(): i32 {
  return compareWidenedTarget(str.from("abc")) ? 1 : 0;
}
