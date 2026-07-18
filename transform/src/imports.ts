import {
  ImportStatement,
  Node,
  Parser,
  Source,
} from "assemblyscript/dist/assemblyscript.js";
import { existsSync, readFileSync } from "fs";
import { createRequire } from "module";
import path from "path";

export const PACKAGE_NAME = "as-str";
export const VIEW_NAME = "str";

const USES =
  /(?:\bstr\s*\.|:\s*str\b|\bnew\s+str\b|<\s*str\s*>|\bstr\s*\[\s*\])/;
const BINDS =
  /(?:\b(?:const|let|var|function|class|namespace|type)\s+str\b|\(\s*str\s*:|,\s*str\s*:)/;
const OWN_SOURCES = new Set([
  "assembly/index.ts",
  "assembly/str.ts",
  "assembly/str8.ts",
  "assembly/util.ts",
  "assembly/util8.ts",
  "index.ts",
]);

export function isPackageSource(source: Source): boolean {
  return OWN_SOURCES.has(source.normalizedPath);
}

export function normalizeBaseRel(baseRel: string): string {
  if (baseRel.endsWith(PACKAGE_NAME)) {
    return (
      PACKAGE_NAME +
      baseRel.slice(baseRel.lastIndexOf(PACKAGE_NAME) + PACKAGE_NAME.length)
    );
  }
  if (
    !baseRel.startsWith(".") &&
    !baseRel.startsWith("/") &&
    !baseRel.startsWith(PACKAGE_NAME)
  ) {
    return "./" + baseRel;
  }
  return baseRel;
}

export function computeImportBaseRel(
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
    if (stmt.namespaceName) names.add(stmt.namespaceName.text);
    if (stmt.declarations) {
      for (const declaration of stmt.declarations) {
        names.add(declaration.name.text);
      }
    }
  }
  return names;
}

export function viewNameAvailable(source: Source): boolean {
  return importedNames(source).has(VIEW_NAME) || !BINDS.test(source.text);
}

export interface ImportInjectionOptions {
  baseCWD: string;
  packageDir: string;
  debug: boolean;
  force?: ReadonlySet<Source>;
  log(message: string): void;
}

interface InjectedImport {
  source: Source;
  specifier: string;
}

function parseIfMissing(
  parser: Parser,
  file: string,
  internalPath: string,
): void {
  const normalizedInternal = internalPath.replace(/\.ts$/, "");
  if (
    parser.sources.some((source) => source.internalPath === normalizedInternal)
  ) {
    return;
  }
  if (!existsSync(file)) return;
  parser.parseFile(
    readFileSync(file, "utf8"),
    normalizedInternal + ".ts",
    false,
  );
}

function seedAsStrSources(
  parser: Parser,
  packageDir: string,
  rootInternal: string,
): void {
  const files = [
    "index.ts",
    "assembly/index.ts",
    "assembly/str.ts",
    "assembly/str8.ts",
    "assembly/util.ts",
    "assembly/util8.ts",
  ];
  for (const relative of files) {
    parseIfMissing(
      parser,
      path.join(packageDir, ...relative.split("/")),
      path.posix.join(rootInternal, relative),
    );
  }
}

function seedUtfAsSources(parser: Parser): void {
  const require = createRequire(import.meta.url);
  let utfPackage: string;
  try {
    utfPackage = require.resolve("utf-as/package.json");
  } catch {
    return;
  }
  const utfDir = path.dirname(utfPackage);
  const files = [
    "assembly/index.ts",
    "assembly/utf/index.ts",
    "assembly/utf/common.ts",
    "assembly/utf/length.ts",
    "assembly/utf/tables.ts",
    "assembly/utf/utf16.ts",
    "assembly/utf/utf8.ts",
    "assembly/utf/utf8_swar.ts",
    "assembly/utf/validate.ts",
    "assembly/utf/validate_swar.ts",
  ];
  for (const relative of files) {
    parseIfMissing(
      parser,
      path.join(utfDir, ...relative.split("/")),
      path.posix.join("~lib/utf-as", relative),
    );
  }
}

function packageRootInternal(source: Source, specifier: string): string {
  if (specifier === PACKAGE_NAME || specifier.startsWith(PACKAGE_NAME + "/")) {
    return `~lib/${PACKAGE_NAME}`;
  }
  const target = path.posix.normalize(
    path.posix.join(path.posix.dirname(source.internalPath), specifier),
  );
  const suffix = "/assembly/index";
  if (target.endsWith(suffix)) return target.slice(0, -suffix.length);
  if (target === "assembly/index") return "";
  return path.posix.dirname(path.posix.dirname(target));
}

export function injectViewImports(
  parser: Parser,
  options: ImportInjectionOptions,
): void {
  const specifiers = new Set<string>();
  const injected: InjectedImport[] = [];

  for (const source of parser.sources) {
    if (source.isLibrary || source.internalPath.startsWith("~lib")) continue;
    if (isPackageSource(source)) continue;

    const already = importedNames(source);
    if (
      already.has(VIEW_NAME) ||
      (!USES.test(source.text) && !options.force?.has(source)) ||
      BINDS.test(source.text)
    ) {
      continue;
    }

    let fromPath = source.normalizedPath.replaceAll("/", path.sep);
    fromPath = fromPath.startsWith("~lib")
      ? fromPath.slice(5)
      : path.join(options.baseCWD, fromPath);

    const baseRel = computeImportBaseRel(
      path.dirname(fromPath),
      options.packageDir,
    );
    const specifier =
      baseRel === PACKAGE_NAME
        ? PACKAGE_NAME
        : path.posix.join(baseRel, "assembly", "index");
    specifiers.add(specifier);
    injected.push({ source, specifier });

    const range = source.range;
    source.statements.unshift(
      Node.createImportStatement(
        [
          Node.createImportDeclaration(
            Node.createIdentifierExpression(VIEW_NAME, range, false),
            null,
            range,
          ),
        ],
        Node.createStringLiteralExpression(specifier, range),
        range,
      ),
    );

    if (options.debug) {
      options.log(
        `[as-str] inject { ${VIEW_NAME} } from "${specifier}" -> ${source.normalizedPath}`,
      );
    }
  }

  for (const item of injected) {
    seedAsStrSources(
      parser,
      options.packageDir,
      packageRootInternal(item.source, item.specifier),
    );
  }
  if (injected.length) seedUtfAsSources(parser);

  for (const specifier of specifiers) {
    if (
      specifier !== PACKAGE_NAME &&
      !specifier.startsWith(PACKAGE_NAME + "/")
    ) {
      continue;
    }
    const internal = "~lib/" + PACKAGE_NAME + "/index";
    if (parser.sources.some((source) => source.internalPath === internal)) {
      continue;
    }
    const file = path.join(options.packageDir, "index.ts");
    if (!existsSync(file)) continue;
    parser.parseFile(readFileSync(file, "utf8"), internal + ".ts", false);
    if (options.debug) options.log(`[as-str] force-parsed ${internal}`);
  }
}
