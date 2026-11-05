import { str } from "../../../assembly/index";
import { overwrite as foreignMutation } from "./review-mutating-dependency";
function fresh(): string {
  return String.fromCharCodes([97, 98, 99, 100, 101, 102]);
}
function mutate(value: string): string {
  store<u16>(changetype<usize>(value) + 2, 120);
  return "bcd";
}
export function direct(): bool {
  const original = fresh();
  return original.slice(1, 4) == mutate(original);
}
export function local(): bool {
  const original = fresh();
  const part = original.slice(1, 4);
  return part == mutate(original);
}
function mutateNumber(value: string): i32 {
  mutate(value);
  return 0;
}
function consume(value: string, ignored: i32): bool {
  return value == "bcd" && ignored == 0;
}
export function laterArgument(): bool {
  const original = fresh();
  return consume(original.slice(1, 4), mutateNumber(original));
}
export function scalarArgument(): i32 {
  const original = fresh();
  return original.slice(1, 4).charCodeAt(mutateNumber(original));
}
export function afterStatement(): bool {
  const original = fresh();
  const part = original.slice(1, 4);
  mutateNumber(original);
  return part == "bcd";
}
const mutations: ((value: string) => string)[] = [mutate];
export function callbackArray(): bool {
  const original = fresh();
  const part = original.slice(1, 4);
  return part == mutations[0](original);
}
function callbackParameter(
  callback: (value: string) => string,
  original: string,
): bool {
  const part = original.slice(1, 4);
  return part == callback(original);
}
export function callbackArgument(): bool {
  return callbackParameter(mutate, fresh());
}
class Mutation {
  constructor(public original: string) {}
  get changed(): string {
    return mutate(this.original);
  }
  set changed(value: string) {
    if (value.length) mutate(this.original);
  }
}
const sharedMutation = new Mutation("");
export function getter(): bool {
  const original = fresh();
  const part = original.slice(1, 4);
  const mutation = sharedMutation;
  mutation.original = original;
  return part == mutation.changed;
}
export function setter(): bool {
  const original = fresh();
  const part = original.slice(1, 4);
  const mutation = sharedMutation;
  mutation.original = original;
  mutation.changed = "change";
  return part == "bcd";
}

function forward(value: string): string {
  return foreignMutation(value);
}
function secondHop(value: string): string {
  return forward(value);
}
export function imported(): bool {
  const original = fresh();
  const part = original.slice(1, 4);
  return part == secondHop(original);
}
class MutatingConstructor {
  constructor(value: string) {
    mutate(value);
  }
}
export function constructed(): bool {
  const original = fresh();
  const part = original.slice(1, 4);
  new MutatingConstructor(original);
  return part == "bcd";
}
function chooseMutation(): (value: string) => string {
  return mutate;
}
export function returnedCallback(): bool {
  const original = fresh();
  const part = original.slice(1, 4);
  return part == chooseMutation()(original);
}

export function manualView(): bool {
  const original = fresh();
  const part = str.slice(original, 1, 4);
  mutate(original);
  return part.equalsString("xcd");
}
let fieldOriginal: string = "";
function fieldMutation(): i32 {
  return mutateNumber(fieldOriginal);
}
class FieldMutation {
  value: i32 = fieldMutation();
}
export function fieldInitializer(): bool {
  const original = fresh();
  fieldOriginal = original;
  const part = original.slice(1, 4);
  new FieldMutation();
  return part == "bcd";
}
function defaultMutation(value: i32 = fieldMutation()): i32 {
  return value;
}
export function defaultEffect(): bool {
  const original = fresh();
  fieldOriginal = original;
  const part = original.slice(1, 4);
  defaultMutation();
  return part == "bcd";
}
class DerivedMutation extends MutatingConstructor {
  constructor(value: string) {
    super(value);
  }
}
export function inheritedConstructor(): bool {
  const original = fresh();
  const part = original.slice(1, 4);
  new DerivedMutation(original);
  return part == "bcd";
}

function genericCallback<T>(callback: T, original: string): bool {
  const part = original.slice(1, 4);
  return part == callback(original);
}
export function genericArgument(): bool {
  return genericCallback(mutate, fresh());
}
