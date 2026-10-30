import { Transform } from "assemblyscript/dist/transform.js";
import {
  ASTBuilder,
  Parser,
  Source,
} from "assemblyscript/dist/assemblyscript.js";
import path from "path";
import { fileURLToPath } from "url";
import { injectViewImports } from "./imports.js";
import {
  createSemanticScope,
  readSemanticManifest,
  writeSemanticManifest,
  SemanticScope,
} from "./manifest.js";
import { optimizeSources } from "./optimizer.js";
import { admitSource, configureSourceAdmission } from "./source-admission.js";
import { OptimizationDiagnostic, OptimizationResult } from "./model.js";
import { buildShadowSemanticManifest } from "./analysis.js";

function enabled(name: string): boolean {
  return /^(1|true|on|yes)$/i.test(process.env[name] ?? "");
}

export default class StrAsTransform extends Transform {
  protected optimize = false;
  protected dualPass = false;
  private outputScope: SemanticScope | undefined;
  private outputTransformed = false;

  afterParse(parser: Parser): void {
    const debug = enabled("STR_AS_DEBUG");
    const analyzeOnly = enabled("AS_STR_ANALYZE_ONLY");
    const dump = enabled("STR_AS_DUMP");
    const debugSources = enabled("STR_AS_DEBUG_SOURCES");
    const manifestIn = process.env["AS_STR_MANIFEST_IN"];
    const packageDir = path.resolve(
      fileURLToPath(import.meta.url),
      "..",
      "..",
      "..",
    );
    const baseCWD = path.resolve(process.cwd(), this.baseDir ?? ".");
    configureSourceAdmission(parser.sources, baseCWD);
    if (debugSources) {
      for (const source of parser.sources) {
        this.log(
          `[as-str] source normalized=${source.normalizedPath} internal=${source.internalPath} ` +
            `library=${source.isLibrary} optimizable=${admitSource(source).optimization} ` +
            `reason="${admitSource(source).reason}"`,
        );
      }
    }

    // Resolve explicit view imports before matching an external cache's input graph.
    if (manifestIn && !this.dualPass)
      injectViewImports(parser, {
        baseCWD,
        packageDir,
        debug: false,
        log: () => {},
      });
    const manifest = this.dualPass
      ? buildShadowSemanticManifest(
          this.program,
          parser.sources,
          (shadow) => {
            configureSourceAdmission(shadow.sources, baseCWD);
            const preliminary = optimizeSources(shadow.sources);
            injectViewImports(shadow, {
              baseCWD,
              packageDir,
              debug: false,
              force: preliminary.changedSources,
              log: () => {},
            });
          },
          debug
            ? (reason) =>
                this.log(`[as-str] semantic analysis failed: ${reason}`)
            : undefined,
        )
      : manifestIn
        ? readSemanticManifest(
            manifestIn,
            createSemanticScope(parser.sources, this.program.options),
          )
        : null;
    if (debug && this.dualPass) {
      this.log(
        manifest
          ? `[as-str] semantic analysis: ${manifest.facts.length} facts`
          : "[as-str] semantic analysis unavailable; using conservative syntax analysis",
      );
    }
    if (debug && manifestIn && !this.dualPass)
      this.log(
        manifest
          ? `[as-str] semantic manifest: ${manifest.facts.length} facts`
          : "[as-str] semantic manifest rejected; using conservative syntax analysis",
      );
    const optimization: OptimizationResult =
      this.optimize && !analyzeOnly
        ? optimizeSources(parser.sources, manifest)
        : {
            changedSources: new Set<Source>(),
            diagnostics: [] as OptimizationDiagnostic[],
            summary: {
              tracked: 0,
              promoted: 0,
              rejected: 0,
              conversions: 0,
              estimatedAllocationsRemoved: 0,
            },
          };

    injectViewImports(parser, {
      baseCWD,
      packageDir,
      debug,
      force: optimization.changedSources,
      log: (message) => this.log(message),
    });

    if (process.env["AS_STR_MANIFEST_OUT"]) {
      this.outputScope = createSemanticScope(
        parser.sources,
        this.program.options,
      );
      this.outputTransformed = this.optimize && !analyzeOnly;
    }

    if (debug) {
      for (const diagnostic of optimization.diagnostics) {
        this.log(
          `[as-str] ${diagnostic.source}:${diagnostic.line}:${diagnostic.column} ` +
            `${diagnostic.binding} -> ${diagnostic.decision}: ${diagnostic.reason} ` +
            `(uses=${diagnostic.uses}, conversions=${diagnostic.conversions})`,
        );
      }
      const summary = optimization.summary;
      this.log(
        `[as-str] summary: tracked=${summary.tracked}, promoted=${summary.promoted}, ` +
          `rejected=${summary.rejected}, conversions=${summary.conversions}, ` +
          `estimated-allocations-removed=${summary.estimatedAllocationsRemoved}`,
      );
    }
    if (dump) {
      for (const source of optimization.changedSources) {
        this.log(
          `[as-str] rewritten ${source.normalizedPath}\n${ASTBuilder.build(source)}`,
        );
      }
    }
  }

  afterCompile(): void {
    const manifestOut = process.env["AS_STR_MANIFEST_OUT"];
    if (manifestOut)
      writeSemanticManifest(
        this.program,
        manifestOut,
        this.outputScope,
        this.outputTransformed,
      );
  }
}
