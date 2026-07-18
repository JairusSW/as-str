import { Program, Source } from "assemblyscript/dist/assemblyscript.js";
import { Representation } from "./ast.js";
export interface SemanticFact {
  source: string;
  start: number;
  end: number;
  name: string;
  kind: "local" | "parameter" | "return" | "field" | "global";
  representation: Representation;
  resolvedType: string;
}
export interface SemanticManifest {
  version: 1;
  facts: SemanticFact[];
}
export declare function buildSemanticManifest(
  program: Program,
): SemanticManifest;
export declare function writeSemanticManifest(
  program: Program,
  filename: string,
): void;
export declare function readSemanticManifest(
  filename: string | undefined,
): SemanticManifest | null;
export declare function factsForSource(
  manifest: SemanticManifest | null,
  source: Source,
): Map<string, SemanticFact>;
