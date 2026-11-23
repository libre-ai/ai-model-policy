// policy-core-v2 reference evaluator
// Byte-identical to normative SEMANTICS.md, verified against every policy-core-v2
// golden and operator vector of the pinned contracts authority (see __tests__).

export { type EvaluateResult, evaluate } from "./evaluator";
export { digest, jcs } from "./jcs";
export { normalize } from "./normalize";
export { parseStrictJson } from "./strict-parser";
export type {
  ErrorCode,
  FactValue,
  JsonRecord,
  Operator,
  PolicyEvaluation,
  ReasonCode,
  RuleStatus,
  RuleValue,
  Verdict,
} from "./types";
export { StrictJsonError } from "./types";
