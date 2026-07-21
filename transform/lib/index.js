import { Transform } from "assemblyscript/dist/transform.js";
import { ASTBuilder } from "assemblyscript/dist/assemblyscript.js";
import path from "path";
import { fileURLToPath } from "url";
import { injectViewImports } from "./imports.js";
import { readSemanticManifest, writeSemanticManifest } from "./manifest.js";
import { optimizeSources } from "./optimizer.js";
import { buildShadowSemanticManifest } from "./analysis.js";
const DEBUG = /^(1|true|on|yes)$/i.test(process.env["STR_AS_DEBUG"] ?? "");
const ANALYZE_ONLY = /^(1|true|on|yes)$/i.test(
  process.env["AS_STR_ANALYZE_ONLY"] ?? "",
);
const MANIFEST_IN = process.env["AS_STR_MANIFEST_IN"];
const MANIFEST_OUT = process.env["AS_STR_MANIFEST_OUT"];
const DUMP = /^(1|true|on|yes)$/i.test(process.env["STR_AS_DUMP"] ?? "");
export default class StrAsTransform extends Transform {
  optimize = false;
  dualPass = false;
  afterParse(parser) {
    const packageDir = path.resolve(
      fileURLToPath(import.meta.url),
      "..",
      "..",
      "..",
    );
    const baseCWD = path.join(process.cwd(), this.baseDir ?? ".");
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
          DEBUG
            ? (reason) =>
                this.log(`[as-str] semantic analysis failed: ${reason}`)
            : undefined,
        )
      : readSemanticManifest(MANIFEST_IN);
    if (DEBUG && this.dualPass) {
      this.log(
        manifest
          ? `[as-str] semantic analysis: ${manifest.facts.length} facts`
          : "[as-str] semantic analysis unavailable; using conservative syntax analysis",
      );
    }
    const optimization =
      this.optimize && !ANALYZE_ONLY
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
      debug: DEBUG,
      force: optimization.changedSources,
      log: (message) => this.log(message),
    });
    if (DEBUG) {
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
    if (DUMP) {
      for (const source of optimization.changedSources) {
        this.log(
          `[as-str] rewritten ${source.normalizedPath}\n${ASTBuilder.build(source)}`,
        );
      }
    }
  }
  afterCompile() {
    if (MANIFEST_OUT) writeSemanticManifest(this.program, MANIFEST_OUT);
  }
}
