// as-str transform - opt-in ergonomics: inject `import { str }` into any user
// source that uses `str` without importing it, so consumers can use the API
// globally (no per-file import). Pair it with the ambient typings (see
// `globals/index.d.ts`) for editor IntelliSense.
//
// Enable with `--transform as-str/transform` (or in asconfig's
// `options.transform`). The relative-path / bare-specifier logic is ported from
// json-as's transform (`computeImportBaseRel` / `normalize*BaseRel`).
//
// NOTE: `str` is a very common local identifier, so detection is deliberately
// conservative - it only injects when `str` is used as the class (member access
// `str.`, a `: str` type, `new str`, `<str>`, or `str[]`) AND the file does not
// locally bind a `str` of its own. For a name this short, prefer explicit
// `import { str } from "as-str"` over global mode if you ever shadow it.
import { Transform } from "assemblyscript/dist/transform.js";
import { Node, ImportStatement } from "assemblyscript/dist/assemblyscript.js";
import path from "path";
import { fileURLToPath } from "url";
import { readFileSync, existsSync } from "fs";

const PKG = "as-str";
const NAME = "str";
const DEBUG = /^(1|true|on|yes)$/i.test(process.env["STR_AS_DEBUG"] ?? "");

// `str` is used *as the class* (not as a plain variable): static/member access,
// a type annotation, construction, a cast/generic, or an array type.
const USES =
  /(?:\bstr\s*\.|:\s*str\b|\bnew\s+str\b|<\s*str\s*>|\bstr\s*\[\s*\])/;
// The file declares its own `str` binding - never inject in that case.
const BINDS =
  /(?:\b(?:const|let|var|function|class|namespace|type)\s+str\b|\(\s*str\s*:|,\s*str\s*:)/;

// Collapse a relative path whose leaf is the package dir to the bare specifier
// (so a node_modules install resolves through the consumer's node_modules), and
// prefix a plain relative path with "./". Ported from json-as.
function normalizeBaseRel(baseRel) {
  if (baseRel.endsWith(PKG)) {
    return PKG + baseRel.slice(baseRel.lastIndexOf(PKG) + PKG.length);
  }
  if (
    !baseRel.startsWith(".") &&
    !baseRel.startsWith("/") &&
    !baseRel.startsWith(PKG)
  ) {
    return "./" + baseRel;
  }
  return baseRel;
}

// Cross-platform: native-separator relative path -> forward-slash specifier.
// Ported from json-as's computeImportBaseRel.
function computeImportBaseRel(fromDir, packageDir, p = path) {
  return normalizeBaseRel(
    path.posix.join(...p.relative(fromDir, packageDir).split(p.sep)),
  );
}

// Local binding names already brought in by the source's import statements.
function importedNames(source) {
  const names = new Set();
  for (const stmt of source.statements) {
    if (!(stmt instanceof ImportStatement)) continue;
    if (stmt.namespaceName) names.add(stmt.namespaceName.text); // import * as X
    if (stmt.declarations) {
      for (const d of stmt.declarations) names.add(d.name.text);
    }
  }
  return names;
}

export default class StrAsTransform extends Transform {
  afterParse(parser) {
    // Package root: this file is <pkg>/transform/index.js -> ../.. is <pkg>.
    const packageDir = path.resolve(fileURLToPath(import.meta.url), "..", "..");
    const baseCWD = path.join(process.cwd(), this.baseDir ?? ".");

    // The bare-specifier modules we may inject, and the source that backs each.
    const specifiers = new Set();

    for (const source of parser.sources) {
      // Skip stdlib + installed libraries (incl. as-str's own files when used
      // as a dependency) and runtime internals.
      if (source.isLibrary) continue;
      if (source.internalPath.startsWith("~lib")) continue;

      const text = source.text;
      const already = importedNames(source);
      // Inject only when `str` is used as the class and not already in scope.
      if (already.has(NAME) || !USES.test(text) || BINDS.test(text)) continue;

      let fromPath = source.normalizedPath.replaceAll("/", path.sep);
      fromPath = fromPath.startsWith("~lib")
        ? fromPath.slice(5)
        : path.join(baseCWD, fromPath);

      const baseRel = computeImportBaseRel(path.dirname(fromPath), packageDir);
      const specifier = path.posix.join(baseRel, "assembly", "index");
      specifiers.add(specifier);
      const range = source.range;

      source.statements.unshift(
        Node.createImportStatement(
          [
            Node.createImportDeclaration(
              Node.createIdentifierExpression(NAME, range, false),
              null,
              range,
            ),
          ],
          Node.createStringLiteralExpression(specifier, range),
          range,
        ),
      );

      if (DEBUG) {
        console.log(
          `[as-str] inject { ${NAME} } from "${specifier}" -> ${source.normalizedPath}`,
        );
      }
    }

    // An import added here is too late for asc's normal parse loop, so if the
    // as-str module isn't already in the program, force-parse its index. asc
    // drains the parse backlog after afterParse, so this pulls in the whole
    // dependency graph (./str, ./util, utf-as, …).
    for (const specifier of specifiers) {
      if (!specifier.startsWith(PKG + "/")) continue; // only the installed case
      const internal = "~lib/" + specifier;
      if (parser.sources.some((s) => s.internalPath === internal)) continue;
      const file = path.join(packageDir, "assembly", "index.ts");
      if (!existsSync(file)) continue;
      parser.parseFile(readFileSync(file, "utf8"), internal + ".ts", false);
      if (DEBUG) console.log(`[as-str] force-parsed ${internal}`);
    }
  }
}
