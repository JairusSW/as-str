import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  cpSync,
  appendFileSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
  rmSync,
} from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  Options,
  Source,
  SourceKind,
} from "assemblyscript/dist/assemblyscript.js";
import {
  createSemanticScope,
  readSemanticManifest,
  factsForSource,
} from "../lib/manifest.js";
import { instantiate, repo } from "./harness.mjs";

mkdirSync(path.join(repo, "build"), { recursive: true });
const scratch = mkdtempSync(path.join(repo, "build", "manifest-tests-"));
let completed = false;
try {
  const file = path.join(scratch, "manifest.json");
  const text = "const value: string = 'abc';";
  const source = new Source(SourceKind.UserEntry, "input.ts", text);
  const dependency = new Source(
    SourceKind.User,
    "dep.ts",
    "export const value = 1;",
  );
  const options = new Options();
  const scope = createSemanticScope([source, dependency], options);
  const copy = path.join(scratch, "transform", "lib");
  cpSync(path.join(repo, "transform", "lib"), copy, { recursive: true });
  const copiedModule = pathToFileURL(path.join(copy, "manifest.js"));
  const unchangedTransform = await import(copiedModule.href);
  assert.equal(
    unchangedTransform.createSemanticScope([source, dependency], options)
      .transformHash,
    scope.transformHash,
  );
  appendFileSync(
    path.join(copy, "ast.js"),
    "\n// Different transform implementation.\n",
  );
  const changedTransform = await import(copiedModule.href + "?changed");
  assert.notEqual(
    changedTransform.createSemanticScope([source, dependency], options)
      .transformHash,
    scope.transformHash,
  );
  const fact = {
    source: "input.ts",
    start: 0,
    end: text.length,
    name: "value",
    kind: "local",
    representation: "native",
    resolvedType: "~lib/string/String",
  };
  const valid = {
    version: 2,
    facts: [fact],
    complete: true,
    scope,
    transformed: false,
  };
  function read(value, expectedScope = scope) {
    writeFileSync(file, JSON.stringify(value));
    return readSemanticManifest(file, expectedScope);
  }
  assert.deepEqual(read(valid), JSON.parse(JSON.stringify(valid)));
  for (const value of [
    null,
    [],
    1,
    { ...valid, version: 1 },
    { ...valid, complete: "true" },
    { ...valid, transformed: "false" },
    { ...valid, transformed: true },
    { ...valid, scope: undefined },
    { ...valid, scope: null },
    { ...valid, scope: { ...scope, sources: [] } },
    { ...valid, scope: { ...scope, optionsHash: "bad" } },
    { ...valid, scope: { ...scope, transformHash: undefined } },
    { ...valid, scope: { ...scope, transformHash: "bad" } },
  ])
    assert.equal(read(value), null);
  for (const patch of [
    { resolvedType: undefined },
    { source: 1 },
    { source: "absent.ts" },
    { start: -1 },
    { start: 0.5 },
    { end: -1 },
    { end: text.length + 1 },
    { name: null },
    { kind: "not-a-kind" },
    { representation: "not-a-type" },
    { nullable: "true" },
  ])
    assert.equal(
      read({ ...valid, facts: [{ ...fact, ...patch }] }),
      null,
      JSON.stringify(patch),
    );
  for (const facts of [[null], [1], [fact, fact]])
    assert.equal(read({ ...valid, facts }), null);
  writeFileSync(file, "not JSON");
  assert.equal(readSemanticManifest(file, scope), null);
  assert.equal(
    readSemanticManifest(path.join(scratch, "missing.json"), scope),
    null,
  );
  assert.equal(read(valid, { ...scope, compiler: "another compiler" }), null);
  assert.equal(read(valid, { ...scope, transformHash: "0".repeat(64) }), null);
  assert.equal(
    read(
      valid,
      createSemanticScope(
        [
          new Source(
            SourceKind.UserEntry,
            "input.ts",
            text.replace("abc", "xyz"),
          ),
          dependency,
        ],
        options,
      ),
    ),
    null,
  );
  assert.equal(
    read(
      valid,
      createSemanticScope(
        [
          source,
          new Source(SourceKind.User, "dep.ts", "export const value = 2;"),
        ],
        options,
      ),
    ),
    null,
  );
  assert.equal(read(valid, createSemanticScope([source], options)), null);
  assert.equal(
    read(
      valid,
      createSemanticScope(
        [new Source(SourceKind.User, "input.ts", text), dependency],
        options,
      ),
    ),
    null,
  );
  const changedOptions = new Options();
  changedOptions.noAssert = true;
  assert.equal(
    read(valid, createSemanticScope([source, dependency], changedOptions)),
    null,
  );
  const aliasOptions = new Options();
  aliasOptions.globalAliases = new Map([["CONFIG", "1"]]);
  assert.equal(
    read(valid, createSemanticScope([source, dependency], aliasOptions)),
    null,
  );
  const aliasManifest = {
    ...valid,
    scope: createSemanticScope([source, dependency], aliasOptions),
  };
  const changedAlias = new Options();
  changedAlias.globalAliases = new Map([["CONFIG", "2"]]);
  assert.equal(
    read(
      aliasManifest,
      createSemanticScope([source, dependency], changedAlias),
    ),
    null,
  );
  for (const nullable of [undefined, false, true]) {
    const loaded = read({
      ...valid,
      facts: [{ ...fact, resolvedType: "~lib/string/String | null", nullable }],
    });
    const normalized = factsForSource(loaded, source).get("local:0");
    assert.equal(normalized.representation, "unknown");
    assert.equal(normalized.nullable, true);
  }
  const functionFact = read({
    ...valid,
    facts: [
      {
        ...fact,
        representation: "view",
        resolvedType: "() => assembly/str/Str",
        nullable: false,
      },
    ],
  });
  assert.equal(
    factsForSource(functionFact, source).get("local:0").representation,
    "unknown",
  );

  const entry = path.join(scratch, "main.ts"),
    dep = path.join(scratch, "dep.ts");
  const wasm = path.join(scratch, "main.wasm"),
    wat = path.join(scratch, "main.wat");
  const entryRel = path.relative(repo, entry);
  const nativeSource = `const input: string = "abc";\nfunction matches(value: string): bool { return value == "bc"; }\nexport function run(): bool { return matches(input.slice(1)); }\n`;
  function compile(mode, env = {}, extra = []) {
    const transform = path.join(
      repo,
      "transform/lib",
      mode === "global" ? "index.js" : `${mode}.js`,
    );
    const isolated = { ...process.env, STR_AS_DEBUG: "1" };
    delete isolated.AS_STR_MANIFEST_IN;
    delete isolated.AS_STR_MANIFEST_OUT;
    delete isolated.AS_STR_ANALYZE_ONLY;
    const result = spawnSync(
      process.execPath,
      [
        path.join(repo, "node_modules/assemblyscript/bin/asc.js"),
        entryRel,
        "--transform",
        transform,
        "-o",
        wasm,
        "--textFile",
        wat,
        ...extra,
      ],
      { cwd: repo, encoding: "utf8", env: { ...isolated, ...env } },
    );
    assert.equal(result.status, 0, result.stdout + result.stderr);
    return {
      output: result.stdout + result.stderr,
      wat: readFileSync(wat, "utf8"),
    };
  }
  async function check(use, expected = 1) {
    const built = compile("single", { AS_STR_MANIFEST_IN: file });
    assert.match(
      built.output,
      use ? /semantic manifest: \d+ facts/ : /semantic manifest rejected/,
    );
    assert.match(
      built.wat,
      use ? /\/matches \(param \$0 i64\)/ : /\/matches \(param \$0 i32\)/,
    );
    assert.equal((await instantiate(wasm)).instance.exports.run(), expected);
    return built;
  }
  function generate() {
    compile("global", { AS_STR_MANIFEST_OUT: file });
  }
  writeFileSync(entry, nativeSource);
  generate();
  await check(true);
  writeFileSync(entry, nativeSource.replace("abc", "xyz"));
  await check(false, 0);
  writeFileSync(entry, nativeSource);
  generate();
  const flags = compile("single", { AS_STR_MANIFEST_IN: file }, [
    "--enable",
    "simd",
  ]);
  assert.match(flags.output, /semantic manifest rejected/);
  const missingIdentity = JSON.parse(readFileSync(file, "utf8"));
  delete missingIdentity.scope;
  writeFileSync(file, JSON.stringify(missingIdentity));
  await check(false);
  generate();
  const malformed = JSON.parse(readFileSync(file, "utf8"));
  delete malformed.facts[0].resolvedType;
  writeFileSync(file, JSON.stringify(malformed));
  await check(false);
  compile("auto", { AS_STR_MANIFEST_OUT: file });
  assert.equal(JSON.parse(readFileSync(file, "utf8")).transformed, true);
  await check(false);
  // Explicit view imports must have the same dependency graph in both passes.
  writeFileSync(
    entry,
    nativeSource.replace(
      "return matches(input.slice(1));",
      'return matches(input.slice(1)) && str.from("").length == 0;',
    ),
  );
  generate();
  await check(true);
  writeFileSync(dep, 'export const suffix: string = "abc";\n');
  writeFileSync(
    entry,
    'import { suffix } from "./dep";\n' +
      nativeSource +
      "export function dependencyValue(): i32 { return suffix.charCodeAt(0); }\n",
  );
  generate();
  await check(true);
  writeFileSync(dep, 'export const suffix: string = "xyz";\n');
  await check(false);
  assert.equal(
    (await instantiate(wasm)).instance.exports.dependencyValue(),
    120,
  );
  console.log(
    "semantic manifest validation, source/option identity, and cache integration passed",
  );
  completed = true;
} finally {
  if (completed) rmSync(scratch, { recursive: true, force: true });
  else console.error(`manifest failure artifacts retained at ${scratch}`);
}
