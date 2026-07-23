const globalView: str = "global";
const globalNative: string = str.from("native");

export function promotedLength(input: string): i32 {
  const part = input.slice(1, 4);
  return part.length;
}

export function promotedAnnotatedLength(input: string): i32 {
  const part: string = input.slice(1, 4);
  return part.length;
}

export function promotedEquality(input: string): bool {
  const part = input.slice(1, 4);
  return part === "bcd" || part !== "xyz";
}

export function directEquality(input: string): bool {
  return input.slice(1, 4) === "bcd";
}

export function unsafePointer(input: string): usize {
  const part = input.slice(1, 4);
  return changetype<usize>(part);
}

export function explicitConversions(input: string): string {
  const view: str = input;
  const native: string = view;
  return native;
}

function viewLength(value: str): i32 {
  return value.length;
}

export function nativeToViewCall(input: string): i32 {
  return viewLength(input);
}

function internalSliceLength(value: string): i32 {
  return value.slice(1, 4).length;
}

export function promotedParameter(input: string): i32 {
  return internalSliceLength(input);
}

export function semanticCheck(): i32 {
  const part = "abcdef".slice(1, 4);
  const view: str = "hello";
  const native: string = view;
  return part.charCodeAt(0) + native.length;
}

export function annotations(input: string): i32 {
  // @as-str prefer-view
  const preferred = input;
  // @as-str no-view
  const native = input.slice(1, 4);
  return preferred.length + native.length;
}

export function branchAndAlias(input: string, choose: bool): i32 {
  let part = input.slice(1, 4);
  if (choose) part = input.substring(2, 5);
  const alias = part;
  return alias.length;
}

function recursiveSlice(value: string, count: i32): i32 {
  if (count <= 0) return value.length;
  return recursiveSlice(value.slice(1), count - 1);
}

export function recursiveParameter(input: string): i32 {
  return recursiveSlice(input, 2);
}

function internalSliceReturn(input: string): string {
  return input.slice(1, 4);
}

export function promotedReturn(input: string): i32 {
  return internalSliceReturn(input).length;
}

export function directTemporary(input: string): i32 {
  return input.slice(1, 4).length;
}

export function loopReassignment(input: string, count: i32): i32 {
  let part = input.slice(1);
  while (count-- > 0) part = part.trim();
  return part.length;
}

class InteropFields {
  native: string = "";
  view: str = str.from("");

  assignBoth(input: string, incoming: str): void {
    this.view = input;
    this.native = incoming;
  }
}

class InitializerFields {
  initialView: str = "field";
  initialNative: string = str.from("value");
}

export function fieldAndElementConversions(input: string): i32 {
  const target = new InteropFields();
  const incoming = str.from(input);
  target.assignBoth(input, incoming);
  const nativeValues = new Array<string>(1);
  const viewValues = new Array<str>(1);
  nativeValues[0] = incoming;
  viewValues[0] = input;
  return target.native.length + viewValues[0].length + nativeValues[0].length;
}

export function globalAndFieldInitializers(): i32 {
  const fields = new InitializerFields();
  return (
    globalView.length +
    globalNative.length +
    fields.initialView.length +
    fields.initialNative.length
  );
}

let evaluationState = 0;

function orderedSource(): string {
  evaluationState = evaluationState * 10 + 1;
  return "abcdef";
}

function orderedIndex(): i32 {
  evaluationState = evaluationState * 10 + 2;
  return 1;
}

export function evaluationOrder(): i32 {
  evaluationState = 0;
  const part = orderedSource().slice(orderedIndex(), 4);
  return evaluationState * 10 + part.length;
}

export function redundantRoundTrips(input: string): i32 {
  const native: string = str.from(input).toString();
  const existing = str.from(input);
  const view: str = str.from(existing.toString());
  return native.length + view.length;
}

export function typedContainerMethods(input: string): i32 {
  const views = new Array<str>();
  const nativeValues = new Array<string>();
  views.push(input);
  const view = str.from(input);
  nativeValues.push(view);
  return views[0].length + nativeValues[0].length;
}

export function provenNullable(input: string | null): i32 {
  if (input === null) return 0;
  const part = input!.slice(1, 4);
  return part.length;
}

export function scalarSpanConsumers(input: string): i32 {
  const part = input.substring(1, 5);
  return (
    part.indexOf("c") +
    part.lastIndexOf("c") +
    part.charCodeAt(0) +
    part.codePointAt(0) +
    (part.includes("cd") ? 1 : 0) +
    (part.startsWith("b") ? 1 : 0) +
    (part.endsWith("e") ? 1 : 0) +
    (part.isEmpty ? 1 : 0) +
    part.length
  );
}

export function scalarSpanSemanticCheck(): i32 {
  return scalarSpanConsumers("abcdef");
}
