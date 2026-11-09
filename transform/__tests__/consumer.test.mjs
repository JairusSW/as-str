import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repo = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const scratch = mkdtempSync(path.join(tmpdir(), "as-str-consumer-"));

function run(command, args, cwd = scratch, envOverrides = {}) {
  const env = { ...process.env, ...envOverrides };
  // `npm publish --dry-run` exports this setting to lifecycle scripts. The
  // consumer fixture must still create its nested tarball to test installation.
  delete env.npm_config_dry_run;
  const result = spawnSync(command, args, { cwd, encoding: "utf8", env });
  assert.equal(
    result.status,
    0,
    `${command} ${args.join(" ")} failed:\n${result.stdout}\n${result.stderr}`,
  );
  return result;
}

function runFailure(command, args, cwd = scratch) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    env: { ...process.env },
  });
  assert.notEqual(
    result.status,
    0,
    `${command} ${args.join(" ")} unexpectedly succeeded`,
  );
  return result;
}

function readFlavorExample(heading, exampleIndex = 0) {
  const readme = readFileSync(path.join(repo, "README.md"), "utf8");
  const marker = `**${heading}**`;
  const start = readme.indexOf(marker);
  assert.notEqual(start, -1, `README flavor heading not found: ${heading}`);
  const contentStart = start + marker.length;
  const nextHeading = readme.indexOf("\n**", contentStart);
  const section = readme.slice(
    contentStart,
    nextHeading < 0 ? readme.length : nextHeading,
  );
  const matches = [...section.matchAll(/```ts\n([\s\S]*?)```/g)];
  assert.ok(
    matches[exampleIndex],
    `README code example ${exampleIndex + 1} not found: ${heading}`,
  );
  return matches[exampleIndex][1];
}

try {
  const packed = run(
    "npm",
    ["pack", "--json", "--ignore-scripts", "--pack-destination", scratch],
    repo,
  );
  const packResult = JSON.parse(packed.stdout)[0];
  const tarball = path.join(scratch, packResult.filename);
  run("npm", [
    "install",
    "--ignore-scripts",
    "--no-audit",
    "--no-fund",
    "--no-package-lock",
    tarball,
  ]);
  for (const mode of ["global", "single", "auto"]) {
    const specifier = `as-str/${mode}`;
    run(process.execPath, [
      "--input-type=module",
      "--eval",
      `import Transform from ${JSON.stringify(specifier)}; if (typeof Transform !== "function") throw new Error("invalid transform export");`,
    ]);
    run(process.execPath, [
      "--input-type=module",
      "--eval",
      `const { default: Transform } = await import(${JSON.stringify(specifier)}); if (typeof Transform !== "function") throw new Error("invalid transform export");`,
    ]);
    run(process.execPath, [
      "--eval",
      `import(${JSON.stringify(specifier)}).then(({ default: Transform }) => { if (typeof Transform !== "function") throw new Error("invalid transform export"); });`,
    ]);
  }
  const installedGlobals = readFileSync(
    path.join(scratch, "node_modules/as-str/globals.json"),
    "utf8",
  );
  assert.match(installedGlobals, /--transform as-str\/global/);
  assert.doesNotMatch(installedGlobals, /--transform as-str\/transform/);
  for (const [name, specifier] of [
    ["root", "as-str"],
    ["root-index", "as-str/index"],
    ["assembly-index", "as-str/assembly/index"],
    ["runtime", "as-str/assembly/str"],
    ["runtime-extension", "as-str/assembly/str.ts"],
  ]) {
    const exportInput = path.join(scratch, `export-${name}.ts`);
    writeFileSync(
      exportInput,
      `import { str } from ${JSON.stringify(specifier)}; export function check(): i32 { return str.from("abc").length; }\n`,
    );
    run(process.execPath, [
      path.join(scratch, "node_modules/assemblyscript/bin/asc.js"),
      exportInput,
      "--noEmit",
    ]);
  }
  const input = path.join(scratch, "index.ts");
  writeFileSync(path.join(scratch, "types.ts"), "export type Text = string;\n");
  writeFileSync(
    input,
    'type u64 = i32;\nexport function check(): i32 { const part = "abcdef".slice(1, 4); return part.length; }\nexport function checkEntryView(): i32 { return str.from("abcdef").slice(1, 4).length; }\nexport function checkShadow(): bool { const part = "abc".slice(1); return part == "bc"; }\nexport function checkErrorMode(): i32 { return str.UTF8.encode("é😀", false, str.UTF8.ErrorMode.ERROR).byteLength; }\n',
  );
  const stringShadowInput = path.join(scratch, "string-shadow.ts");
  writeFileSync(
    stringShadowInput,
    'import { Text } from "./types";\ntype string = i32;\nfunction measure(value: Text): i32 { return value.length; }\nexport function checkStringShadow(): i32 { return measure("abcdef".slice(1)); }\n',
  );
  const asc = path.join(scratch, "node_modules/assemblyscript/bin/asc.js");
  for (const [name, heading, transform, optimized] of [
    ["manual", "Manual Mode (default)", null, false],
    ["global-readme", "Global Mode", "as-str/global", false],
    ["auto-readme", "Automatic Mode", "as-str/auto", true],
    ["single-readme", "Single-Pass Automatic Mode", "as-str/single", true],
  ]) {
    const exampleInput = path.join(scratch, `${name}.ts`);
    const exampleWasm = path.join(scratch, `${name}.wasm`);
    const exampleWat = path.join(scratch, `${name}.wat`);
    writeFileSync(exampleInput, readFlavorExample(heading));
    const args = [
      asc,
      exampleInput,
      "--outFile",
      exampleWasm,
      "--textFile",
      exampleWat,
    ];
    if (transform) args.splice(2, 0, "--transform", transform);
    run(process.execPath, args);
    if (optimized) {
      assert.match(
        readFileSync(exampleWat, "utf8"),
        /assembly\/str\/Str/,
        `${heading} README example must emit a str view operation`,
      );
    }
  }

  const transformedExampleInput = path.join(scratch, "auto-transformed.ts");
  const transformedExampleWasm = path.join(scratch, "auto-transformed.wasm");
  writeFileSync(
    transformedExampleInput,
    readFlavorExample("Automatic Mode", 1),
  );
  run(process.execPath, [
    asc,
    transformedExampleInput,
    "--outFile",
    transformedExampleWasm,
  ]);

  const globalInput = path.join(scratch, "global.ts");
  const globalWasm = path.join(scratch, "global.wasm");
  writeFileSync(
    globalInput,
    'export function checkGlobal(): i32 { return str("abcdef").slice(1, 4).length; }\n',
  );
  run(process.execPath, [
    asc,
    globalInput,
    "--transform",
    "as-str/global",
    "--outFile",
    globalWasm,
  ]);
  const globalModule = await WebAssembly.instantiate(readFileSync(globalWasm), {
    env: {
      abort() {
        throw new Error("AssemblyScript abort");
      },
    },
  });
  assert.equal(globalModule.instance.exports.checkGlobal(), 3);

  const globalNativeWasm = path.join(scratch, "consumer-global-native.wasm");
  const globalNativeWat = path.join(scratch, "consumer-global-native.wat");
  run(
    process.execPath,
    [
      asc,
      input,
      "--transform",
      "as-str/global",
      "--outFile",
      globalNativeWasm,
      "--textFile",
      globalNativeWat,
    ],
    scratch,
    { AS_STR_OPTIMIZE: "1" },
  );
  assert.match(
    readFileSync(globalNativeWat, "utf8"),
    /~lib\/string\/String#slice/,
    "as-str/global must remain injection-only even when AS_STR_OPTIMIZE is set",
  );

  const bareResult = runFailure(process.execPath, [
    asc,
    globalInput,
    "--transform",
    "as-str",
    "--outFile",
    path.join(scratch, "bare.wasm"),
  ]);
  assert.match(
    bareResult.stderr,
    /Cannot find module|ERR_MODULE_NOT_FOUND|ERR_UNKNOWN_FILE_EXTENSION|ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING|Transform must be a class/,
    "bare as-str must not resolve as a transform",
  );

  const autoWasm = path.join(scratch, "consumer-auto.wasm");
  run(process.execPath, [
    asc,
    input,
    "--transform",
    "as-str/auto",
    "--outFile",
    autoWasm,
  ]);
  const autoModule = await WebAssembly.instantiate(readFileSync(autoWasm), {
    env: {
      abort() {
        throw new Error("AssemblyScript abort");
      },
    },
  });
  assert.equal(autoModule.instance.exports.check(), 3);
  assert.equal(autoModule.instance.exports.checkEntryView(), 3);
  assert.equal(autoModule.instance.exports.checkShadow(), 1);
  assert.equal(autoModule.instance.exports.checkErrorMode(), 6);
  const stringShadowWasm = path.join(scratch, "string-shadow.wasm");
  run(process.execPath, [
    asc,
    stringShadowInput,
    "--transform",
    "as-str/auto",
    "--outFile",
    stringShadowWasm,
  ]);
  const stringShadowModule = await WebAssembly.instantiate(
    readFileSync(stringShadowWasm),
    {
      env: {
        abort() {
          throw new Error("AssemblyScript abort");
        },
      },
    },
  );
  assert.equal(stringShadowModule.instance.exports.checkStringShadow(), 5);
  const singleWasm = path.join(scratch, "consumer-single.wasm");
  run(process.execPath, [
    asc,
    input,
    "--transform",
    "as-str/single",
    "--outFile",
    singleWasm,
  ]);
  const singleModule = await WebAssembly.instantiate(readFileSync(singleWasm), {
    env: {
      abort() {
        throw new Error("AssemblyScript abort");
      },
    },
  });
  assert.equal(singleModule.instance.exports.checkShadow(), 1);
  assert.equal(singleModule.instance.exports.checkErrorMode(), 6);
  const assemblyEntry = path.join(scratch, "assembly/index.ts");
  mkdirSync(path.dirname(assemblyEntry), { recursive: true });
  writeFileSync(assemblyEntry, readFileSync(input, "utf8"));
  for (const mode of ["global", "auto", "single"]) {
    for (const absoluteBase of [false, true]) {
      const entryWasm = path.join(
        scratch,
        `entry-${mode}-${absoluteBase}.wasm`,
      );
      const entryWat = path.join(scratch, `entry-${mode}-${absoluteBase}.wat`);
      run(
        process.execPath,
        [
          asc,
          "assembly/index.ts",
          "--transform",
          `as-str/${mode}`,
          ...(absoluteBase ? ["--baseDir", scratch] : []),
          "-o",
          entryWasm,
          "--textFile",
          entryWat,
        ],
        absoluteBase ? repo : scratch,
      );
      const { instance } = await WebAssembly.instantiate(
        readFileSync(entryWasm),
        {
          env: {
            abort() {
              throw new Error("AssemblyScript abort");
            },
          },
        },
      );
      assert.equal(instance.exports.check(), 3);
      assert.equal(instance.exports.checkEntryView(), 3);
      assert.equal(instance.exports.checkErrorMode(), 6);
      if (mode !== "global")
        assert.doesNotMatch(
          readFileSync(entryWat, "utf8"),
          /call \$~lib\/string\/String#slice/,
          "standard entry filenames must retain automatic optimization",
        );
    }
  }
  const relativeBaseWasm = path.join(scratch, "relative-base.wasm");
  run(
    process.execPath,
    [
      asc,
      "assembly/index.ts",
      "--baseDir",
      path.relative(repo, scratch),
      "--transform",
      "as-str/auto",
      "-o",
      relativeBaseWasm,
    ],
    repo,
  );
  assert.equal(
    (
      await WebAssembly.instantiate(readFileSync(relativeBaseWasm), {
        env: {
          abort() {
            throw new Error("AssemblyScript abort");
          },
        },
      })
    ).instance.exports.checkEntryView(),
    3,
  );

  const dependencyDir = path.join(scratch, "node_modules", "view-dependency");
  mkdirSync(dependencyDir, { recursive: true });
  writeFileSync(
    path.join(dependencyDir, "package.json"),
    JSON.stringify({
      name: "view-dependency",
      version: "1.0.0",
      types: "index.ts",
    }),
  );
  writeFileSync(
    path.join(dependencyDir, "index.ts"),
    [
      "export function dependencyCheck(): i32 {",
      '  const value = str("abcdef");',
      "  const typed: Str = value;",
      "  return typed.slice(1, 4).length;",
      "}",
      "",
    ].join("\n"),
  );
  const dependencyInput = path.join(scratch, "dependency.ts");
  writeFileSync(
    dependencyInput,
    [
      'import { dependencyCheck } from "view-dependency";',
      "export function checkDependency(): i32 {",
      "  return dependencyCheck();",
      "}",
      "",
    ].join("\n"),
  );
  const dependencyWasm = path.join(scratch, "dependency.wasm");
  run(process.execPath, [
    asc,
    dependencyInput,
    "--transform",
    "as-str/auto",
    "--outFile",
    dependencyWasm,
  ]);
  const dependencyModule = await WebAssembly.instantiate(
    readFileSync(dependencyWasm),
    {
      env: {
        abort() {
          throw new Error("AssemblyScript abort");
        },
      },
    },
  );
  assert.equal(dependencyModule.instance.exports.checkDependency(), 3);
  const editorInput = path.join(scratch, "editor.ts");
  const editorConfig = path.join(scratch, "tsconfig.json");
  writeFileSync(
    editorInput,
    [
      "export function upper(value: Str): i32 {",
      "  return value.length;",
      "}",
      "export function upperFactory(): i32 {",
      '  return Str.from("abc").length;',
      "}",
      "export function encodingMode(value: str.UTF8.ErrorMode): i32 {",
      "  return value;",
      "}",
      "export function upperEncodingMode(value: Str.UTF8.ErrorMode): i32 {",
      "  return value;",
      "}",
      "export function enumValue(): i32 {",
      "  return str.UTF8.ErrorMode.ERROR;",
      "}",
      "export function encodeWithLowerEnum(): usize {",
      '  return str.UTF8.encode("é😀", false, str.UTF8.ErrorMode.ERROR).byteLength;',
      "}",
      "export function encodeWithUpperEnum(): usize {",
      '  return Str.UTF8.encode("é😀", false, Str.UTF8.ErrorMode.ERROR).byteLength;',
      "}",
      "",
    ].join("\n"),
  );
  writeFileSync(
    editorConfig,
    JSON.stringify({
      extends: ["assemblyscript/std/assembly.json", "as-str/globals.json"],
      include: ["./editor.ts"],
      compilerOptions: { noEmit: true },
    }),
  );
  const editorResult = spawnSync(
    process.execPath,
    [
      path.join(repo, "node_modules/typescript/bin/tsc"),
      "--project",
      editorConfig,
    ],
    { cwd: scratch, encoding: "utf8", env: { ...process.env } },
  );
  // AssemblyScript sources use syntax and intrinsics that plain tsc cannot
  // validate. The editor contract is that the consumer file itself resolves
  // every injected global type, value and namespace without diagnostics.
  const editorDiagnostics = editorResult.stdout + editorResult.stderr;
  assert.doesNotMatch(editorDiagnostics, /editor\.ts\(/, editorDiagnostics);
  const packedTransformFiles = readdirSync(
    path.join(scratch, "node_modules/as-str/transform/lib"),
  );
  assert.ok(packedTransformFiles.length);
  assert.ok(
    packedTransformFiles.every((file) => file.endsWith(".js")),
    `packed transform/lib must contain only JavaScript: ${packedTransformFiles.join(", ")}`,
  );
  console.log("clean consumer package test passed");
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
