import assert from "node:assert/strict";
import {
  BinaryExpression,
  CallExpression,
  FunctionDeclaration,
  Node,
  Parser,
} from "assemblyscript/dist/assemblyscript.js";
import { walk } from "../lib/visitor.js";

function legacyWalk(
  node,
  visitor,
  parent = null,
  key = null,
  grandparent = null,
) {
  if (!node || visitor(node, { parent, key, grandparent }) === false) return;
  const isNode = (value) =>
    value && typeof value === "object" && "kind" in value;
  for (const [childKey, value] of Object.entries(node)) {
    if (["range", "implicitFieldDeclaration", "kind"].includes(childKey))
      continue;
    if (isNode(value)) legacyWalk(value, visitor, node, childKey, parent);
    else if (Array.isArray(value))
      for (const child of value)
        if (isNode(child)) legacyWalk(child, visitor, node, childKey, parent);
  }
}
function parse(text) {
  const parser = new Parser();
  parser.parseFile(text, "visitor.ts", true);
  assert.equal(parser.diagnostics.length, 0);
  return parser.sources[0];
}
const source = parse(`
import { str as View } from "as-str";
type Values<T> = Array<T>;
namespace Example {
  export class Box<T> {
    value: T;
    constructor(value: T) { this.value = value; }
    read(): T { return this.value; }
  }
}
function consume(value: string): i32 {
  const callback = (input: string): i32 => input.length;
  for (let index = 0; index < 3; index++) value = value.slice(index);
  return callback(value);
}
export function run(): i32 { return consume("abc"); }
`);
for (const prune of [false, true]) {
  const traces = [legacyWalk, walk].map((visit) => {
    const result = [];
    visit(source, (node, ref) => {
      result.push({ node, ...ref });
      if (prune && node instanceof FunctionDeclaration) return false;
    });
    return result;
  });
  assert.deepEqual(
    traces[1],
    traces[0],
    `visitor references and order; prune=${prune}`,
  );
}
for (const visit of [legacyWalk, walk]) {
  const source = parse("export function run(): i32 { return 1 + 2; }");
  let binary;
  legacyWalk(source, (node) => {
    if (node instanceof BinaryExpression) binary = node;
  });
  const original = binary.right;
  const replacement = Node.createStringLiteralExpression(
    "replacement",
    binary.range,
  );
  const visited = [];
  visit(source, (node) => {
    visited.push(node);
    if (node === binary.left) binary.right = replacement;
  });
  assert.equal(binary.right, replacement);
  assert.ok(
    visited.includes(original),
    "siblings retain their original snapshot",
  );
  assert.ok(
    !visited.includes(replacement),
    "replacement is visited on the next walk",
  );
}
for (const visit of [legacyWalk, walk]) {
  const source = parse("export function run(): i32 { return consume(1, 2); }");
  let call;
  legacyWalk(source, (node) => {
    if (node instanceof CallExpression) call = node;
  });
  const inserted = Node.createStringLiteralExpression("inserted", call.range);
  let changed = false;
  const visited = [];
  visit(source, (node) => {
    visited.push(node);
    if (!changed && node === call.args[0]) {
      changed = true;
      call.args.push(inserted);
    }
  });
  assert.ok(
    visited.includes(inserted),
    "array traversal retains live iteration semantics",
  );
}
console.log(
  "AST traversal order, pruning, parent references, and mutation behavior passed",
);
