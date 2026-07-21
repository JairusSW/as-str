import {
  Compiler,
  Options,
  Program,
} from "assemblyscript/dist/assemblyscript.js";
import { buildSemanticManifest } from "./manifest.js";
function cloneOptions(options) {
  const clone = Object.assign(new Options(), options);
  clone.globalAliases = options.globalAliases
    ? new Map(options.globalAliases)
    : null;
  return clone;
}
function isEntry(source) {
  return source.sourceKind === 1;
}
export function buildShadowSemanticManifest(
  outerProgram,
  sources,
  prepare,
  onFailure,
) {
  const analysis = new Program(cloneOptions(outerProgram.options));
  try {
    for (const source of sources) {
      analysis.parser.parseFile(
        source.text,
        source.normalizedPath,
        isEntry(source),
      );
    }
    prepare?.(analysis.parser);
    while (true) {
      if (analysis.parser.nextFile() === null) break;
    }
    analysis.parser.finish();
    analysis.initialize();
    Compiler.compile(analysis);
    const errors = analysis.diagnostics.filter(
      (diagnostic) => diagnostic.category === 3,
    );
    if (errors.length) {
      const shown = errors.slice(0, 3).map((diagnostic) => diagnostic.message);
      if (errors.length > shown.length) {
        shown.push(`${errors.length - shown.length} more errors`);
      }
      onFailure?.(shown.join("; "));
      return null;
    }
    return buildSemanticManifest(analysis);
  } catch (error) {
    const backlog = analysis.parser.backlog.length
      ? ` (${analysis.parser.backlog.length} unresolved sources)`
      : "";
    onFailure?.(
      (error instanceof Error ? error.message : String(error)) + backlog,
    );
    return null;
  } finally {
    analysis.module.dispose();
  }
}
