import { Transform } from "assemblyscript/dist/transform.js";
import { ASTBuilder } from "assemblyscript/dist/assemblyscript.js";
import path from "path";
import { fileURLToPath } from "url";
import { injectViewImports } from "./imports.js";
import { readSemanticManifest, writeSemanticManifest } from "./manifest.js";
import { optimizeSources } from "./optimizer.js";
import { admitSource } from "./source-admission.js";
import { buildShadowSemanticManifest } from "./analysis.js";
function enabled(name) {
  return /^(1|true|on|yes)$/i.test(process.env[name] ?? "");
}
export default class StrAsTransform extends Transform {
  optimize = false;
  dualPass = false;
  afterParse(parser) {
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
    const baseCWD = path.join(process.cwd(), this.baseDir ?? ".");
    if (debugSources) {
      for (const source of parser.sources) {
        this.log(
          `[as-str] source normalized=${source.normalizedPath} internal=${source.internalPath} ` +
            `library=${source.isLibrary} optimizable=${admitSource(source).optimization} ` +
            `reason="${admitSource(source).reason}"`,
        );
      }
    }
    const manifest = this.dualPass
      ? buildShadowSemanticManifest(
          this.program,
          parser.sources,
          (shadow) => {
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
      : readSemanticManifest(manifestIn);
    if (debug && this.dualPass) {
      this.log(
        manifest
          ? `[as-str] semantic analysis: ${manifest.facts.length} facts`
          : "[as-str] semantic analysis unavailable; using conservative syntax analysis",
      );
    }
    const optimization =
      this.optimize && !analyzeOnly
        ? optimizeSources(parser.sources, manifest)
        : {
            changedSources: new Set(),
            diagnostics: [],
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
  afterCompile() {
    const manifestOut = process.env["AS_STR_MANIFEST_OUT"];
    if (manifestOut) writeSemanticManifest(this.program, manifestOut);
  }
}
