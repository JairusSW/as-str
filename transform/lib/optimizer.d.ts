import { Source } from "assemblyscript/dist/assemblyscript.js";
import { SemanticManifest } from "./manifest.js";
import { FunctionSignature, OptimizationResult } from "./model.js";
export declare function optimizeSource(
  source: Source,
  manifest?: SemanticManifest | null,
  sharedSignatures?: Map<string, FunctionSignature> | null,
): OptimizationResult;
export declare function optimizeSources(
  sources: Source[],
  manifest?: SemanticManifest | null,
): OptimizationResult;
