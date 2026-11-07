import { ImportStatement, Node } from "assemblyscript/dist/assemblyscript.js";
import { isPackageSource } from "./source-identity.js";
import { sourceBindsName, stringRepresentation } from "./type-resolution.js";
export {
  PACKAGE_NAME,
  PACKAGE_SOURCE_FILES,
  configureSourceAdmission,
  sourcesFor,
} from "./source-identity.js";
export const VIEW_NAME = "str";
export const VIEW_CLASS_NAME = "Str";
const VIEW_USES =
  /(?:\bstr\s*[.(]|:\s*str\b|\bnew\s+str\b|<\s*str\s*>|\bstr\s*\[\s*\])/;
const VIEW_CLASS_USES =
  /(?:\bStr\s*\.|:\s*Str\b|\bnew\s+Str\b|<\s*Str\s*>|\bStr\s*\[\s*\])/;
function libraryPrefixes() {
  return (process.env["AS_STR_LIBRARY_PREFIXES"] ?? "")
    .split(",")
    .map((prefix) => prefix.trim())
    .filter(Boolean);
}
function sourceIsConfigured(source) {
  return (
    (!source.isLibrary && !source.internalPath.startsWith("~lib")) ||
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
export function admitSource(source, forcedImport = false) {
  const semanticFacts = sourceIsConfigured(source);
  const packageSource = isPackageSource(source);
  const already = importedNames(source);
  const requestsView =
    !already.has(VIEW_NAME) && (forcedImport || VIEW_USES.test(source.text));
  const viewNameAvailable =
    ((semanticFacts && !packageSource) || requestsView) &&
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
  if (requestsView && viewNameAvailable) {
    requestedViewNames.push(VIEW_NAME);
  }
  if (
    !already.has(VIEW_CLASS_NAME) &&
    VIEW_CLASS_USES.test(source.text) &&
    !sourceBindsName(source, VIEW_CLASS_NAME)
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
