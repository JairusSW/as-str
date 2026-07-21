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
export const VIEW_CLASS_NAME = "Str";

const VIEW_USES =
  /(?:\bstr\s*[.(]|:\s*str\b|\bnew\s+str\b|<\s*str\s*>|\bstr\s*\[\s*\])/;
const VIEW_BINDS =
  /(?:\b(?:const|let|var|function|class|namespace|type)\s+str\b|\(\s*str\s*:|,\s*str\s*:)/;
const VIEW_CLASS_USES =
  /(?:\bStr\s*\.|:\s*Str\b|\bnew\s+Str\b|<\s*Str\s*>|\bStr\s*\[\s*\])/;
const VIEW_CLASS_BINDS =
  /(?:\b(?:const|let|var|function|class|namespace|type)\s+Str\b|\(\s*Str\s*:|,\s*Str\s*:)/;
const OWN_SOURCES = new Set([
  "assembly/index.ts",
  "assembly/str.ts",
  "assembly/str8.ts",
  "assembly/util.ts",
  "assembly/util8.ts",
  "index.ts",
]);

export function isPackageSource(source: Source): boolean {
  if (OWN_SOURCES.has(source.normalizedPath)) return true;
  const internalPath = source.internalPath.replace(/\.ts$/, "");
  if (internalPath === `~lib/${PACKAGE_NAME}/index`) return true;
  const libraryPrefix = `~lib/${PACKAGE_NAME}/`;
  return (
    internalPath.startsWith(libraryPrefix) &&
    OWN_SOURCES.has(internalPath.slice(libraryPrefix.length) + ".ts")
  );
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
  return importedNames(source).has(VIEW_NAME) || !VIEW_BINDS.test(source.text);
}

function requestedViewNames(source: Source, forced: boolean): string[] {
  const already = importedNames(source);
  const names: string[] = [];
  if (
    !already.has(VIEW_NAME) &&
    !VIEW_BINDS.test(source.text) &&
    (forced || VIEW_USES.test(source.text))
  ) {
    names.push(VIEW_NAME);
  }
  if (
    !already.has(VIEW_CLASS_NAME) &&
    !VIEW_CLASS_BINDS.test(source.text) &&
    VIEW_CLASS_USES.test(source.text)
  ) {
    names.push(VIEW_CLASS_NAME);
  }
  return names;
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
    "index.ts",
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
    if (isPackageSource(source)) continue;

    const names = requestedViewNames(
      source,
      options.force?.has(source) ?? false,
    );
    if (!names.length) continue;

    const librarySource =
      source.isLibrary || source.internalPath.startsWith("~lib");
    let specifier = PACKAGE_NAME;
    if (!librarySource) {
      const fromPath = path.join(
        options.baseCWD,
        source.normalizedPath.replaceAll("/", path.sep),
      );
      const baseRel = computeImportBaseRel(
        path.dirname(fromPath),
        options.packageDir,
      );
      specifier =
        baseRel === PACKAGE_NAME
          ? PACKAGE_NAME
          : path.posix.join(baseRel, "assembly", "index");
    }
    specifiers.add(specifier);
    injected.push({ source, specifier });

    const range = source.range;
    source.statements.unshift(
      Node.createImportStatement(
        names.map((name) =>
          Node.createImportDeclaration(
            Node.createIdentifierExpression(name, range, false),
            null,
            range,
          ),
        ),
        Node.createStringLiteralExpression(specifier, range),
        range,
      ),
    );

    if (options.debug) {
      options.log(
        `[as-str] inject { ${names.join(", ")} } from "${specifier}" -> ${source.normalizedPath}`,
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
