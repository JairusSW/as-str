import { Node } from "assemblyscript/dist/assemblyscript.js";
import { existsSync, readFileSync } from "fs";
import { createRequire } from "module";
import path from "path";
import { admitSource, PACKAGE_NAME } from "./source-admission.js";
export {
  PACKAGE_NAME,
  VIEW_CLASS_NAME,
  VIEW_NAME,
} from "./source-admission.js";
export function normalizeBaseRel(baseRel) {
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
export function computeImportBaseRel(fromDir, packageDir, p = path) {
  return normalizeBaseRel(
    path.posix.join(...p.relative(fromDir, packageDir).split(p.sep)),
  );
}
function parseIfMissing(parser, file, internalPath) {
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
function seedAsStrSources(parser, packageDir, rootInternal) {
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
function seedUtfAsSources(parser) {
  const require = createRequire(import.meta.url);
  let utfPackage;
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
function packageRootInternal(source, specifier) {
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
export function injectViewImports(parser, options) {
  const specifiers = new Set();
  const injected = [];
  for (const source of parser.sources) {
    const forced = options.force?.has(source) ?? false;
    const admission = admitSource(source, forced);
    if (admission.packageSource) continue;
    const librarySource =
      source.isLibrary || source.internalPath.startsWith("~lib");
    const names = admission.requestedViewNames;
    if (!names.length) continue;
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
