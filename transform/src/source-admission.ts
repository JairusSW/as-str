import {
  ClassDeclaration,
  DecoratorKind,
  FunctionDeclaration,
  IdentifierExpression,
  ImportStatement,
  Node,
  Source,
  TypeName,
  VariableStatement,
} from "assemblyscript/dist/assemblyscript.js";
import { isPackageSource, sourcesFor } from "./source-identity.js";
import {
  sourceBindsName,
  sourceNameIsUnbound,
  stringRepresentation,
} from "./type-resolution.js";
import { isDeclarationIdentifier, walk } from "./visitor.js";
export {
  PACKAGE_NAME,
  PACKAGE_SOURCE_FILES,
  configureSourceAdmission,
  sourcesFor,
} from "./source-identity.js";
export const VIEW_NAME = "str";
export const VIEW_CLASS_NAME = "Str";

export interface SourceAdmission {
  readonly semanticFacts: boolean;
  readonly optimization: boolean;
  readonly packageSource: boolean;
  readonly viewNameAvailable: boolean;
  readonly requestedViewNames: readonly string[];
  readonly reason: string;
}

function libraryPrefixes(): string[] {
  return (process.env["AS_STR_LIBRARY_PREFIXES"] ?? "")
    .split(",")
    .map((prefix) => prefix.trim())
    .filter(Boolean);
}

function sourceIsConfigured(source: Source): boolean {
  const dependencySource =
    source.internalPath.startsWith("~lib") ||
    source.internalPath.startsWith("node_modules/") ||
    source.internalPath.includes("/node_modules/");
  return (
    (!source.isLibrary && !dependencySource) ||
    libraryPrefixes().some((prefix) => source.internalPath.startsWith(prefix))
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

function requestsUnboundName(source: Source, name: string): boolean {
  let requested = false;
  walk(source, (node, ref): boolean | void => {
    if (
      requested ||
      !(node instanceof IdentifierExpression) ||
      node.text !== name ||
      isDeclarationIdentifier(node, ref)
    )
      return;
    const typeName = ref.parent instanceof TypeName ? ref.parent : null;
    // Only the leading identifier of a qualified type names its binding.
    if (typeName && ref.grandparent instanceof TypeName) return;
    if (sourceNameIsUnbound(source, name, node.range, typeName === null))
      requested = true;
  });
  return requested;
}

function hasGlobalBinding(source: Source, name: string): boolean {
  for (const candidate of sourcesFor(source)) {
    for (const statement of candidate.statements) {
      if (
        (statement instanceof FunctionDeclaration ||
          statement instanceof ClassDeclaration) &&
        statement.name.text === name &&
        statement.decorators?.some(
          (decorator) => decorator.decoratorKind === DecoratorKind.Global,
        )
      )
        return true;
      if (
        statement instanceof VariableStatement &&
        statement.decorators?.some(
          (decorator) => decorator.decoratorKind === DecoratorKind.Global,
        ) &&
        statement.declarations.some(
          (declaration) => declaration.name.text === name,
        )
      )
        return true;
    }
  }
  return false;
}

function moduleNameIsUnbound(source: Source, name: string): boolean {
  return (
    sourceNameIsUnbound(source, name, source.range, false) &&
    sourceNameIsUnbound(source, name, source.range, true)
  );
}

/**
 * Decides every source-participation question used by semantic analysis,
 * optimization, and import injection. Callers consume the decision rather
 * than rebuilding package, library, and name-safety policy.
 */
export function admitSource(
  source: Source,
  forcedImport = false,
): SourceAdmission {
  const semanticFacts = sourceIsConfigured(source);
  const packageSource = isPackageSource(source);
  const already = importedNames(source);
  const globalViewBinding = hasGlobalBinding(source, VIEW_NAME);
  const globalClassBinding = hasGlobalBinding(source, VIEW_CLASS_NAME);
  const requestsView =
    !already.has(VIEW_NAME) &&
    !globalViewBinding &&
    moduleNameIsUnbound(source, VIEW_NAME) &&
    (forcedImport || requestsUnboundName(source, VIEW_NAME));
  // Indexing a source's bindings walks all of it. Unconfigured library sources
  // rarely mention the view names, so only answer the question when it matters.
  const viewNameAvailable =
    ((semanticFacts && !packageSource) || requestsView) &&
    !globalViewBinding &&
    !globalClassBinding &&
    !sourceBindsName(source, VIEW_NAME) &&
    (!already.has(VIEW_NAME) ||
      stringRepresentation(
        Node.createNamedType(
          Node.createSimpleTypeName(VIEW_NAME, source.range),
          null,
          false,
          source.range,
        ),
      ) === "view");
  const requestedViewNames: string[] = [];
  if (requestsView) {
    requestedViewNames.push(VIEW_NAME);
  }
  if (
    !already.has(VIEW_CLASS_NAME) &&
    !globalClassBinding &&
    moduleNameIsUnbound(source, VIEW_CLASS_NAME) &&
    requestsUnboundName(source, VIEW_CLASS_NAME)
  ) {
    requestedViewNames.push(VIEW_CLASS_NAME);
  }

  const optimization = semanticFacts && !packageSource && viewNameAvailable;
  const reason = !semanticFacts
    ? "library source is not configured for optimization"
    : packageSource
      ? "as-str package source is never self-optimized"
      : !viewNameAvailable
        ? "source binds the str name"
        : "source admitted";
  return {
    semanticFacts,
    optimization,
    packageSource,
    viewNameAvailable,
    requestedViewNames,
    reason,
  };
}
