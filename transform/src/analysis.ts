import {
  Compiler,
  DiagnosticCategory,
  Options,
  Parser,
  Program,
  Source,
  SourceKind,
} from "assemblyscript/dist/assemblyscript.js";
import { buildSemanticManifest, SemanticManifest } from "./manifest.js";

function cloneOptions(options: Options): Options {
  const clone = Object.assign(new Options(), options);
  clone.globalAliases = options.globalAliases
    ? new Map(options.globalAliases)
    : null;
  return clone;
}

function isEntry(source: Source): boolean {
  return source.sourceKind === SourceKind.UserEntry;
}

export function buildShadowSemanticManifest(
  outerProgram: Program,
  sources: readonly Source[],
  prepare?: (parser: Parser) => void,
  onFailure?: (reason: string) => void,
): SemanticManifest | null {
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
    // All sources have already been cloned above. Draining the dependency
    // queue mirrors asc's loader and marks their imports as resolved.
    while (true) {
      if (analysis.parser.nextFile() === null) break;
    }
    analysis.parser.finish();
    analysis.initialize();

    Compiler.compile(analysis);
    const errors = analysis.diagnostics.filter(
      (diagnostic) => diagnostic.category === DiagnosticCategory.Error,
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
