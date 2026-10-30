import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
  rmSync,
  symlinkSync,
  unlinkSync,
} from "node:fs";
import path from "node:path";
import { ASTBuilder, Parser } from "assemblyscript/dist/assemblyscript.js";
import {
  admitSource,
  configureSourceAdmission,
  PACKAGE_SOURCE_FILES,
} from "../lib/source-admission.js";
import { injectViewImports } from "../lib/imports.js";
import { repo } from "./harness.mjs";

mkdirSync(path.join(repo, "build"), { recursive: true });
const scratch = mkdtempSync(path.join(repo, "build", "source-origin-"));
try {
  const userText =
    'export function run(): i32 { return str.from("abc").length; }';
  for (const filename of PACKAGE_SOURCE_FILES) {
    const parser = new Parser();
    parser.parseFile(userText, filename, true);
    configureSourceAdmission(parser.sources, scratch);
    assert.equal(admitSource(parser.sources[0]).packageSource, false, filename);
    assert.equal(admitSource(parser.sources[0]).optimization, true, filename);
  }
  // A virtual entry can replace a real runtime filename in an API host.
  const virtual = new Parser();
  virtual.parseFile(userText, "assembly/index.ts", true);
  configureSourceAdmission(virtual.sources, repo);
  assert.equal(admitSource(virtual.sources[0]).packageSource, false);
  injectViewImports(virtual, {
    baseCWD: repo,
    packageDir: repo,
    debug: false,
    log() {},
  });
  assert.match(
    ASTBuilder.build(virtual.sources[0]),
    /import \{\s*str\s*\} from "as-str";/,
  );
  assert.ok(
    virtual.sources.some(
      (source) => source.internalPath === "~lib/as-str/assembly/str",
    ),
  );
  const text = readFileSync(path.join(repo, "assembly/str8.ts"), "utf8");
  const owned = new Parser();
  owned.parseFile(text, "assembly/str8.ts", false);
  configureSourceAdmission(owned.sources, repo);
  assert.equal(admitSource(owned.sources[0]).packageSource, true);
  assert.equal(admitSource(owned.sources[0]).optimization, false);
  mkdirSync(path.join(scratch, "assembly"), { recursive: true });
  writeFileSync(path.join(scratch, "assembly/str8.ts"), text);
  configureSourceAdmission(owned.sources, scratch);
  assert.equal(
    admitSource(owned.sources[0]).packageSource,
    false,
    "same filename and contents in a consumer are not package-owned",
  );
  if (process.platform !== "win32") {
    const link = path.join(scratch, "linked-runtime.ts");
    symlinkSync(path.join(repo, "assembly/str8.ts"), link);
    try {
      const linked = new Parser();
      linked.parseFile(text, "linked-runtime.ts", false);
      configureSourceAdmission(linked.sources, scratch);
      assert.equal(admitSource(linked.sources[0]).packageSource, true);
      assert.equal(admitSource(linked.sources[0]).optimization, false);
    } finally {
      unlinkSync(link);
    }
  }
  console.log(
    "source origin, virtual filename, and package ownership checks passed",
  );
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
