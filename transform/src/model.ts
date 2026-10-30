import {
  FunctionDeclaration,
  Source,
  VariableDeclaration,
} from "assemblyscript/dist/assemblyscript.js";
import { Representation } from "./ast.js";

export type SpanOwner =
  | { kind: "identifier"; name: string }
  | { kind: "string-literal"; value: string };

export interface PackedSpanLink {
  owner: SpanOwner;
}

export interface FunctionSignature {
  declaration: FunctionDeclaration;
  declarations: Set<FunctionDeclaration>;
  parameters: Representation[];
  result: Representation;
  callable: boolean;
  promotable: boolean;
  spanArgumentCounts: Map<number, number>;
  directCallCount: number;
  spanParameters: Map<number, string>;
  lowercaseSpanParameters: Set<number>;
  spanAppliedDeclarations: Set<FunctionDeclaration>;
}

export interface Binding {
  declaration: VariableDeclaration;
  name: string;
  declared: Representation;
  semantic: Representation;
  decision: Representation;
  candidate: boolean;
  preferred: boolean;
  forcedReason: string | null;
  uses: number;
  conversions: number;
  element: Representation;
  scalarizedLength: boolean;
  scalarizedSpan: boolean;
  packedSpan: PackedSpanLink | null;
}

export interface FunctionContext {
  declaration: FunctionDeclaration | null;
  bindings: Map<string, Binding>;
  parameters: Map<string, Representation>;
  parameterSpans: Map<string, PackedSpanLink>;
  lowercaseSpans: Set<string>;
  repeatedLowercaseReceivers: Set<string>;
  profitableLowercaseCalls: Set<number>;
  fields: Map<string, Representation>;
  duplicateNames: Set<string>;
}

export interface ParameterPromotion {
  index: number;
  name: string;
  promoted: boolean;
  reason: string;
  uses: number;
}

export interface ReturnPromotion {
  promoted: boolean;
  reason: string;
  uses: number;
}

export interface OptimizationDiagnostic {
  source: string;
  line: number;
  column: number;
  binding: string;
  decision: Representation;
  reason: string;
  uses: number;
  conversions: number;
}

export interface OptimizationResult {
  changedSources: Set<Source>;
  diagnostics: OptimizationDiagnostic[];
  summary: OptimizationSummary;
}

export interface OptimizationSummary {
  tracked: number;
  promoted: number;
  rejected: number;
  conversions: number;
  estimatedAllocationsRemoved: number;
}
