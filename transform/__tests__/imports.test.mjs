import assert from "node:assert/strict";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { writeFileSync, unlinkSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { ASTBuilder, Parser } from "assemblyscript/dist/assemblyscript.js";
import {
  computeImportBaseRel,
  injectViewImports,
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

for (const [filename, prefix] of [
  ["root-entry.ts", "./assembly/index"],
  ["build/nested-entry.ts", "../assembly/index"],
]) {
  const parser = new Parser();
  parser.parseFile(
    "export function run(): i32 { return str.from('abc').length; }",
    filename,
    true,
  );
  const entry = parser.sources[0];
  injectViewImports(parser, {
    baseCWD: repo,
    packageDir: repo,
    debug: false,
    log() {},
  });
  assert.ok(
    ASTBuilder.build(entry).includes(`from "${prefix}"`),
    `relative import for ${filename}`,
  );
}

assert.equal(
  computeImportBaseRel(
    "D:\\workspace\\app\\src",
    "C:\\tools\\runtime-copy",
    path.win32,
  ),
  "as-str",
);
assert.equal(
  computeImportBaseRel(
    "\\\\server-one\\share\\src",
    "\\\\server-two\\share\\runtime-copy",
    path.win32,
  ),
  "as-str",
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

injectViewImports(parser, {
  baseCWD: repo,
  packageDir: repo,
  debug: true,
  force: new Set([dependencySource]),
  log(message) {
    messages.push(message);
  },
});
const forcedDependencyText = ASTBuilder.build(dependencySource);
assert.match(
  forcedDependencyText,
  /import \{\s*str,\s*Str\s*\} from "as-str";/,
);
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
injectViewImports(packageParser, {
  baseCWD: repo,
  packageDir: repo,
  debug: false,
  log() {},
});
assert.doesNotMatch(ASTBuilder.build(packageSource), /^import /);

const rootEntry = path.join(repo, `import-path-${randomUUID()}.tmp.ts`);
writeFileSync(
  rootEntry,
  "export function run(): i32 { return str.from('abc').length; }",
);
try {
  for (const mode of ["index", "auto", "single"]) {
    const result = spawnSync(
      process.execPath,
      [
        path.join(repo, "node_modules/assemblyscript/bin/asc.js"),
        rootEntry,
        "--transform",
        path.join(repo, `transform/lib/${mode}.js`),
        "--noEmit",
      ],
      { cwd: repo, encoding: "utf8", timeout: 15000 },
    );
    assert.ifError(result.error);
    assert.equal(
      result.status,
      0,
      `${mode}: ${result.stdout}\n${result.stderr}`,
    );
  }
} finally {
  unlinkSync(rootEntry);
}

console.log("transform import path tests passed");
