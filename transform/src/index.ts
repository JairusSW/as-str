import { Transform } from "assemblyscript/dist/transform.js";
import {
  Node,
  ImportStatement,
  Parser,
  Source,
} from "assemblyscript/dist/assemblyscript.js";
import path from "path";
import { fileURLToPath } from "url";
import { readFileSync, existsSync } from "fs";

const PKG = "as-str";
const NAME = "str";
const DEBUG = /^(1|true|on|yes)$/i.test(process.env["STR_AS_DEBUG"] ?? "");

const USES =
  /(?:\bstr\s*\.|:\s*str\b|\bnew\s+str\b|<\s*str\s*>|\bstr\s*\[\s*\])/;
// Do not inject when the file owns `str`.
const BINDS =
  /(?:\b(?:const|let|var|function|class|namespace|type)\s+str\b|\(\s*str\s*:|,\s*str\s*:)/;

function normalizeBaseRel(baseRel: string): string {
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

function computeImportBaseRel(
  fromDir: string,
  packageDir: string,
  p: typeof path = path,
): string {
  return normalizeBaseRel(
    path.posix.join(...p.relative(fromDir, packageDir).split(p.sep)),
  );
}

function importedNames(source: Source): Set<string> {
  const names = new Set<string>();
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
  afterParse(parser: Parser): void {
    // <pkg>/transform/lib/index.js -> <pkg>.
    const packageDir = path.resolve(
      fileURLToPath(import.meta.url),
      "..",
      "..",
      "..",
    );
    const baseCWD = path.join(process.cwd(), this.baseDir ?? ".");

    // Bare modules injected during this pass.
    const specifiers = new Set<string>();

    for (const source of parser.sources) {
      // Skip stdlib, libraries, and runtime internals.
      if (source.isLibrary) continue;
      if (source.internalPath.startsWith("~lib")) continue;

      const text = source.text;
      const already = importedNames(source);
      // Inject only if `str` is used and not already in scope.
      if (already.has(NAME) || !USES.test(text) || BINDS.test(text)) continue;

      let fromPath = source.normalizedPath.replaceAll("/", path.sep);
      fromPath = fromPath.startsWith("~lib")
        ? fromPath.slice(5)
        : path.join(baseCWD, fromPath);

      const baseRel = computeImportBaseRel(path.dirname(fromPath), packageDir);
      // Installed builds use `as-str`; in-repo builds use a relative import.
      const specifier =
        baseRel === PKG ? PKG : path.posix.join(baseRel, "assembly", "index");
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

    for (const specifier of specifiers) {
      // Only installed-package imports need seeding.
      if (specifier !== PKG && !specifier.startsWith(PKG + "/")) continue;
      // The injected import is added after asc's resolver, so seed the package
      // root explicitly.
      const internal = "~lib/" + PKG + "/index";
      if (parser.sources.some((s) => s.internalPath === internal)) continue;
      const file = path.join(packageDir, "index.ts");
      if (!existsSync(file)) continue;
      parser.parseFile(readFileSync(file, "utf8"), internal + ".ts", false);
      if (DEBUG) console.log(`[as-str] force-parsed ${internal}`);
    }
  }
}
