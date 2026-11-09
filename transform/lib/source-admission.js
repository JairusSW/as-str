import {
  ClassDeclaration,
  DecoratorKind,
  FunctionDeclaration,
  IdentifierExpression,
  ImportStatement,
  Node,
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
function libraryPrefixes() {
  return (process.env["AS_STR_LIBRARY_PREFIXES"] ?? "")
    .split(",")
    .map((prefix) => prefix.trim())
    .filter(Boolean);
}
function sourceIsConfigured(source) {
  const dependencySource =
    source.internalPath.startsWith("~lib") ||
    source.internalPath.startsWith("node_modules/") ||
    source.internalPath.includes("/node_modules/");
  return (
    (!source.isLibrary && !dependencySource) ||
    libraryPrefixes().some((prefix) => source.internalPath.startsWith(prefix))
  );
}
function importedNames(source) {
  const names = new Set();
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
function requestsUnboundName(source, name) {
  let requested = false;
  walk(source, (node, ref) => {
    if (
      requested ||
      !(node instanceof IdentifierExpression) ||
      node.text !== name ||
      isDeclarationIdentifier(node, ref)
    )
      return;
    const typeName = ref.parent instanceof TypeName ? ref.parent : null;
    if (typeName && ref.grandparent instanceof TypeName) return;
    if (sourceNameIsUnbound(source, name, node.range, typeName === null))
      requested = true;
  });
  return requested;
}
function hasGlobalBinding(source, name) {
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
function moduleNameIsUnbound(source, name) {
  return (
    sourceNameIsUnbound(source, name, source.range, false) &&
    sourceNameIsUnbound(source, name, source.range, true)
  );
}
export function admitSource(source, forcedImport = false) {
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
  const requestedViewNames = [];
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
