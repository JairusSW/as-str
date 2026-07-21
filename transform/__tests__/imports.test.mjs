import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ASTBuilder, Parser } from "assemblyscript/dist/assemblyscript.js";
import {
  computeImportBaseRel,
  injectViewImports,
  isPackageSource,
  normalizeBaseRel,
} from "../lib/imports.js";

const repo = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);

assert.equal(
  normalizeBaseRel("../../.pnpm/as-str@0.3.0/node_modules/as-str"),
  "as-str",
);
assert.equal(
  computeImportBaseRel(
    "/workspace/app/src",
    "/workspace/app/node_modules/as-str",
    path.posix,
  ),
  "as-str",
);
assert.equal(
  computeImportBaseRel(
    "C:\\workspace\\app\\src",
    "C:\\workspace\\app\\node_modules\\as-str",
    path.win32,
  ),
  "as-str",
);
assert.equal(
  computeImportBaseRel(
    "/workspace/as-str/examples",
    "/workspace/as-str",
    path.posix,
  ),
  "..",
);

const parser = new Parser();
parser.parseFile(
  "export function convert(value: string): Str { return Str.from(str(value)); }",
  "~lib/example/assembly/index.ts",
  false,
);
const dependencySource = parser.sources[0];
const messages = [];
injectViewImports(parser, {
  baseCWD: repo,
  packageDir: repo,
  debug: true,
  log(message) {
    messages.push(message);
  },
});
const dependencyText = ASTBuilder.build(dependencySource);
assert.match(dependencyText, /import \{\s*str,\s*Str\s*\} from "as-str";/);
assert.deepEqual(messages, [
  '[as-str] inject { str, Str } from "as-str" -> ~lib/example/assembly/index.ts',
]);

const callableOnlyParser = new Parser();
callableOnlyParser.parseFile(
  "export function convert(value: string): usize { return str(value).start; }",
  "~lib/callable-only/assembly/index.ts",
  false,
);
const callableOnlySource = callableOnlyParser.sources[0];
injectViewImports(callableOnlyParser, {
  baseCWD: repo,
  packageDir: repo,
  debug: false,
  log() {},
});
assert.match(
  ASTBuilder.build(callableOnlySource),
  /import \{\s*str\s*\} from "as-str";/,
);

const packageParser = new Parser();
packageParser.parseFile(
  "export function helper(value: string): str { return str(value); }",
  "~lib/as-str/assembly/util.ts",
  false,
);
const packageSource = packageParser.sources[0];
assert.equal(isPackageSource(packageSource), true);
injectViewImports(packageParser, {
  baseCWD: repo,
  packageDir: repo,
  debug: false,
  log() {},
});
assert.doesNotMatch(ASTBuilder.build(packageSource), /^import /);

console.log("transform import path tests passed");
