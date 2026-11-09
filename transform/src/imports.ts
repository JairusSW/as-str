import {
  ImportStatement,
  Node,
  Parser,
  Source,
} from "assemblyscript/dist/assemblyscript.js";
import { existsSync, readFileSync, realpathSync } from "fs";
import { createRequire } from "module";
import path from "path";
import { scalarTypeAliases, viewTypeAlias } from "./view-aliases.js";
import {
  admitSource,
  configureSourceAdmission,
  PACKAGE_NAME,
  PACKAGE_SOURCE_FILES,
} from "./source-admission.js";
export {
  PACKAGE_NAME,
  VIEW_CLASS_NAME,
  VIEW_NAME,
} from "./source-admission.js";

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
  // Windows cannot express a relative import between drives or UNC shares.
  // The package namespace is independent of the runtime's physical location.
  if (
    p.parse(p.resolve(fromDir)).root.toLowerCase() !==
    p.parse(p.resolve(packageDir)).root.toLowerCase()
  )
    return PACKAGE_NAME;
  return normalizeBaseRel(
    path.posix.join(...p.relative(fromDir, packageDir).split(p.sep)),
  );
}

function packageResolvesTo(
  fromDir: string,
  packageDir: string,
  packageName = PACKAGE_NAME,
): boolean {
  try {
    const require = createRequire(path.join(fromDir, "__as_str_resolve__.cjs"));
    const resolved = path.dirname(
      require.resolve(`${packageName}/package.json`),
    );
    return realpathSync(resolved) === realpathSync(packageDir);
  } catch {
    return false;
  }
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

interface RequestedImport {
  imported: string;
  local: string;
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
  for (const relative of PACKAGE_SOURCE_FILES) {
    parseIfMissing(
      parser,
      path.join(packageDir, ...relative.split("/")),
      path.posix.join(rootInternal, relative),
    );
  }
}

function seedUtfAsSources(parser: Parser, rootInternal: string): void {
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
      path.posix.join(rootInternal, "node_modules/utf-as", relative),
    );
  }
  const packageImport = path.posix.join(rootInternal, "node_modules/utf-as");
  if (!parser.sources.some((source) => source.internalPath === packageImport)) {
    parser.parseFile(
      'export * from "./utf-as/index";',
      packageImport + ".ts",
      false,
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
  configureSourceAdmission(parser.sources, options.baseCWD);
  const specifiers = new Set<string>();
  const injected: InjectedImport[] = [];

  for (const source of parser.sources) {
    const forced = options.force?.has(source) ?? false;
    const admission = admitSource(source, forced);
    if (admission.packageSource) continue;
    const librarySource =
      source.isLibrary || source.internalPath.startsWith("~lib");
    const names: RequestedImport[] = admission.requestedViewNames.map(
      (name) => ({ imported: name, local: name }),
    );
    const alias = viewTypeAlias(source);
    if (
      alias &&
      !source.statements.some(
        (statement) =>
          statement instanceof ImportStatement &&
          statement.declarations?.some(
            (declaration) => declaration.name.text === alias,
          ),
      )
    )
      names.push({ imported: "Str", local: alias });
    for (const [type, local] of scalarTypeAliases(source) ?? [])
      names.push({ imported: `__as_str_${type}`, local });
    // Existing dependency sources may already obtain as-str through
    // AssemblyScript's package globals. Injecting a new explicit import into
    // those modules can create dependency cycles and change static
    // initialization order. Only touch a dependency when optimization has
    // introduced a new view reference or the source already contains an
    // otherwise-unresolved explicit `str` / `Str` reference.
    if (!names.length) continue;

    let specifier = PACKAGE_NAME;
    if (!librarySource) {
      const fromPath = path.join(
        options.baseCWD,
        source.normalizedPath.replaceAll("/", path.sep),
      );
      const fromDir = path.dirname(fromPath);
      const relativeToPackage = path.relative(options.packageDir, fromDir);
      const sourceInsidePackage =
        relativeToPackage === "" ||
        (!relativeToPackage.startsWith("..") &&
          !path.isAbsolute(relativeToPackage));
      const baseRel =
        !sourceInsidePackage && packageResolvesTo(fromDir, options.packageDir)
          ? PACKAGE_NAME
          : computeImportBaseRel(fromDir, options.packageDir);
      specifier =
        baseRel === PACKAGE_NAME
          ? PACKAGE_NAME
          : path.posix.join(baseRel, "assembly", "index");
      // posix.join drops a leading "./". A bare path is a package import to
      // AssemblyScript, even when it points inside the application's directory.
      if (
        specifier !== PACKAGE_NAME &&
        !specifier.startsWith(".") &&
        !specifier.startsWith("/")
      )
        specifier = "./" + specifier;
    }
    if (specifier !== PACKAGE_NAME) {
      const root = packageRootInternal(source, specifier);
      const runtimePaths = new Set(
        PACKAGE_SOURCE_FILES.map((file) =>
          path.posix.join(root, file).replace(/\.ts$/, ""),
        ),
      );
      // Virtual user files can occupy the same logical paths as our runtime.
      // Give the runtime a separate package namespace rather than self-importing.
      if (
        parser.sources.some(
          (candidate) =>
            runtimePaths.has(candidate.internalPath) &&
            !admitSource(candidate).packageSource,
        )
      )
        specifier = PACKAGE_NAME;
    }
    specifiers.add(specifier);
    injected.push({ source, specifier });

    const range = source.range;
    source.statements.unshift(
      Node.createImportStatement(
        names.map(({ imported, local }) =>
          Node.createImportDeclaration(
            Node.createIdentifierExpression(imported, range, false),
            imported !== local
              ? Node.createIdentifierExpression(local, range, false)
              : null,
            range,
          ),
        ),
        Node.createStringLiteralExpression(specifier, range),
        range,
      ),
    );

    if (options.debug) {
      options.log(
        `[as-str] inject { ${names
          .map(({ imported, local }) =>
            imported === local ? imported : `${imported} as ${local}`,
          )
          .join(", ")} } from "${specifier}" -> ${source.normalizedPath}`,
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
  for (const item of injected) {
    seedUtfAsSources(parser, packageRootInternal(item.source, item.specifier));
  }

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
  configureSourceAdmission(parser.sources, options.baseCWD);
}
