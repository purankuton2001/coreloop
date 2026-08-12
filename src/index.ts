export {
  type LocalizedText,
  type Locale,
  toLocale,
  pickText,
  fillTemplate,
  joinSections,
} from "./text.ts";

export { sanitizeText, sanitizeDeep } from "./sanitize.ts";

export {
  type TranscriptRole,
  type TranscriptTurn,
  type TranscriptLabels,
  type TranscriptQuestion,
  type FormatTranscriptOptions,
  type FormatQAOptions,
  visibleTurns,
  formatTranscript,
  formatQA,
} from "./transcript.ts";

export {
  type CoreloopFailureReason,
  CoreloopError,
  isCoreloopError,
  isRetryableError,
} from "./errors.ts";

export {
  type ModelLike,
  type DeepPartial,
  type StructuredRequest,
  type StreamStructuredRequest,
  generateStructured,
  streamStructured,
} from "./generate.ts";

export {
  type Engine,
  type EngineDefaults,
  type Bound,
  createEngine,
} from "./engine.ts";

export {
  type Registry,
  type RegistryOptions,
  createRegistry,
} from "./registry.ts";

export {
  type Flow,
  type ClientFlow,
  type FlowQuestion,
  toClientFlow,
} from "./flows.ts";

export {
  type Mode,
  type ClientMode,
  type CoreColumns,
  type ProfilePromptArgs,
  toClientMode,
  createModeRegistry,
} from "./modes.ts";

export {
  type Candidate,
  type CandidatesResult,
  type RefineRound,
  type BuildCandidatesPromptArgs,
  candidatesSchema,
  buildCandidatesPrompt,
} from "./candidates.ts";

export {
  type AxisDef,
  type AxisScore,
  type AxisScoreOptions,
  type AxisImprovement,
  type ComparableScore,
  axisScoresSchema,
  normalizeAxisScores,
  clampScore,
  scoreRatio,
  pickImprovedAxis,
  formatAxisList,
} from "./scoring.ts";

export {
  type QuoteLocation,
  locateQuote,
  resolveTurnIndex,
} from "./quotes.ts";

export {
  type HandleViolation,
  type HandlePolicy,
  type HandlePolicyOptions,
  createHandlePolicy,
} from "./handle.ts";

export {
  type VisibilityPolicy,
  type VisibilityFieldOptions,
  defineVisibilityPolicy,
} from "./visibility.ts";

export {
  type Probe,
  type InterviewStep,
  type AskNextQuestionArgs,
  interviewStepSchema,
  buildNextQuestionPrompt,
  askNextQuestion,
  pendingProbes,
} from "./interview.ts";

export {
  type ShareMoment,
  type ShareMomentKind,
  type PickShareMomentArgs,
  pickShareMoment,
} from "./share.ts";

export {
  type CoreloopEvent,
  type CoreloopEventHandler,
  type EventStage,
  type EventRecorder,
  type FunnelSummary,
  type ProbeStat,
  createEventRecorder,
  summarizeFunnel,
} from "./events.ts";

export {
  type PresentationStep,
  type QuestionStep,
  type ChoicesStep,
  type RevealStep,
  type ShareStep,
  type StepOption,
  type StepReply,
  toQuestionStep,
  toChoicesStep,
  toRevealStep,
  toShareStep,
} from "./presentation.ts";

export {
  type Entitlement,
  type Plan,
  type Grant,
  type AccessDecision,
  type EntitlementPolicy,
  type PaywallPrompt,
  type PaywallStage,
  type PickPaywallPromptArgs,
  createEntitlementPolicy,
  pickPaywallPrompt,
} from "./entitlements.ts";
