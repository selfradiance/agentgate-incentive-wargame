// Agent 006: Incentive Wargame — Shared Type Definitions

// --- Game Configuration ---

export interface GameConfig {
  poolSize: number;           // Starting resource pool (also carrying capacity cap)
  regenerationRate: number;   // Pool regrows by this fraction each round after extraction
  maxExtractionRate: number;  // Maximum any agent can extract per round (fraction of current pool)
  rounds: number;             // Number of rounds to simulate
  agentCount: number;         // Number of agents (locked to archetype count: 7)
}

export const DEFAULT_CONFIG: GameConfig = {
  poolSize: 1000,
  regenerationRate: 0.10,
  maxExtractionRate: 0.20,
  rounds: 50,
  agentCount: 7,
};

// --- Archetype ---

export interface Archetype {
  index: number;              // 0-based agent index
  name: string;               // e.g. "Greedy", "Cooperative"
  description: string;        // Plain-English strategy description for Claude prompt
}

// --- Strategy Function ---

// The state object passed to every strategy function each round
export interface StrategyState {
  round: number;              // Current round (1-indexed)
  totalRounds: number;        // Total rounds in the simulation
  poolLevel: number;          // Current pool level (start of this round)
  startingPoolSize: number;   // Initial pool size (also carrying capacity)
  regenerationRate: number;   // Pool regeneration rate
  maxExtraction: number;      // Maximum allowed extraction THIS round (poolLevel × maxExtractionRate)
  agentCount: number;         // Number of agents
  agentIndex: number;         // This agent's index (0-based)
  myWealth: number;           // This agent's accumulated wealth
  myHistory: number[];        // This agent's actual extractions per prior round
  allHistory: number[][];     // All agents' actual extractions per prior round (indexed by agent)
  poolHistory: number[];      // Pool level at start of each prior round
  sustainableShare: number;   // MSY per agent this round (poolLevel × regenerationRate / agentCount)
}

// Strategy function signature: pure function, state in → extraction amount out
export type StrategyFunction = (state: StrategyState) => number;

// A generated or loaded strategy with its source code and metadata
export interface Strategy {
  archetypeIndex: number;
  archetypeName: string;
  code: string;               // JavaScript source code of the strategy function
  isFallback: boolean;        // True if this is a cooperative fallback substitution
}

// --- Economy State ---

export interface EconomyState {
  pool: number;
  round: number;
  agentWealth: number[];      // Per-agent accumulated wealth
  agentHistory: number[][];   // Per-agent extraction per round
  poolHistory: number[];      // Pool level at start of each round
  collapsed: boolean;
  collapseRound: number | null;
}

// --- Round Result ---

export interface RoundResult {
  round: number;              // 1-indexed
  poolBefore: number;         // Pool level at start of round
  poolAfter: number;          // Pool level after extraction + regeneration
  requested: number[];        // What each agent requested
  actual: number[];           // What each agent actually received (after clamping/pro-rata)
  agentWealth: number[];      // Cumulative wealth after this round
  collapsed: boolean;         // Did the pool collapse this round?
}

// --- Simulation Log ---

export interface SimulationLog {
  config: GameConfig;
  archetypes: Archetype[];
  strategies: Strategy[];
  rounds: RoundResult[];
  finalState: EconomyState;
}

// --- Metric Types ---

export interface GiniResult {
  gini: number;               // 0 (equal) to 1 (one agent has everything)
}

export interface PoolSurvivalResult {
  survived: boolean;
  completed: boolean;
  collapseRound: number | null;
}

export interface AgentWealthResult {
  archetypeName: string;
  totalWealth: number;
}

export interface OverExtractionRateResult {
  overExtractionRate: number; // 0 to 1
  overExtractionCount: number;
  totalAgentRounds: number;
}

export interface SystemEfficiencyResult {
  efficiency: number;         // Can exceed 1.0 (borrowed from the future)
  totalActualExtraction: number;
  totalMSY: number;
}

export interface ResourceHealthResult {
  minPoolFraction: number;
  avgPoolFraction: number;
  finalPoolFraction: number;
}

export interface CollapseVelocityResult {
  tippingPointRound: number | null;
  roundsFromTipToCollapse: number | null;
}

export interface FirstOverExtractionResult {
  round: number;
  agentIndex: number;
  archetypeName: string;
  amount: number;
  sustainableShare: number;
} // null when no agent ever exceeds sustainable share (use type | null at call site)

export interface AllMetrics {
  gini: GiniResult;
  poolSurvival: PoolSurvivalResult;
  agentWealth: AgentWealthResult[];
  overExtractionRate: OverExtractionRateResult;
  systemEfficiency: SystemEfficiencyResult;
  resourceHealth: ResourceHealthResult;
  collapseVelocity: CollapseVelocityResult;
  firstOverExtraction: FirstOverExtractionResult | null;
}

// --- v0.2.0: Campaign Types ---

// Canonical state used for drift/convergence measurement
export interface CanonicalState {
  label: string;                // e.g. "Healthy", "Stressed", "Near-Collapse"
  round: number;
  totalRounds: number;
  poolLevel: number;
  startingPoolSize: number;
  regenerationRate: number;
  maxExtraction: number;
  agentCount: number;
  agentWealth: number[];        // Per-agent wealth before this round
  allHistory: number[][];
  poolHistory: number[];
  sustainableShare: number;
  isRunSpecific?: boolean;      // true for run-specific snapshots (not fixed canonical)
}

// Observation packet: what each agent sees between runs
export interface ObservationPacket {
  agentIndex: number;
  runNumber: number;
  roundCount: number;
  private: {
    wealthPerRound: number[];
    requestedPerRound: number[];
    receivedPerRound: number[];
    wasRationedPerRound: boolean[];
  };
  public: {
    poolLevelPerRound: number[];
    totalExtractionPerRound: number[];
    msyThresholdPerRound: number[];
    agentExtractionsPerRound: number[][];
  };
  metrics: {
    gini: number;
    abuseRate: number;
    survivalRounds: number;
    poolDepletionRate: number;
    totalExtraction: number;
    fairnessIndex: number;
    collapsed: boolean;
    perAgentWealth: number[];
  };
  truncated?: {
    omittedRounds: { start: number; end: number };
    meanExtraction: number;
    meanPoolLevel: number;
    rationingFrequency: number;
    totalVsMsyRatio: number;
  };
}

// Result of a single agent's adaptation attempt
export interface AdaptationResult {
  agentIndex: number;
  archetypeName: string;
  newStrategy: Strategy | null;  // null = fallback to prior
  usedFallback: boolean;
  validationFailed: boolean;
  error?: string;
}

// Per-run result within a campaign
export interface RunResult {
  runNumber: number;
  log: SimulationLog;
  metrics: AllMetrics;
  strategies: Strategy[];
  drift?: StrategyDriftResult;       // undefined for Run 1
  convergence: BehavioralConvergenceResult;
  adaptationResults?: AdaptationResult[];  // undefined for Run 1
}

// Strategy Drift (metric 9)
export interface StrategyDriftResult {
  perAgent: number[];           // 0-1 drift score per agent
  average: number;              // mean across all agents
}

// Behavioral Convergence (metric 10)
export interface BehavioralConvergenceResult {
  score: number;                // 0 = maximally diverse, 1 = identical behavior
}

// Resilience Trend data point (metric 11)
export interface ResilienceTrendPoint {
  survivalRounds: number;
  finalPoolHealth: number;      // pool level as fraction of initial pool
}

// Resilience Trend (metric 11)
export interface ResilienceTrendResult {
  points: ResilienceTrendPoint[];
  trend: 'positive' | 'negative' | 'flat';
}

// Adaptation Theater detection
export interface AdaptationTheaterResult {
  detected: boolean;
  runTransitions: {
    fromRun: number;
    toRun: number;
    averageDrift: number;
    priorCollapsed: boolean;
    priorHeavilyRationed: boolean;
    verdict: 'theater' | 'equilibrium' | 'normal';
  }[];
}

// Archetype Collapse detection
export interface ArchetypeCollapseResult {
  detected: boolean;
  finalConvergence: number;
  message?: string;
}

// Full campaign result
export interface CampaignResult {
  runs: RunResult[];
  resilienceTrend: ResilienceTrendResult;
  adaptationTheater: AdaptationTheaterResult;
  archetypeCollapse: ArchetypeCollapseResult;
  aborted: boolean;
  abortReason?: string;
}

// --- v0.3.0: Scenario Types ---

// Parameter definition for an action
export interface ActionParam {
  name: string;                     // e.g. "amount", "target"
  type: 'number' | 'string' | 'boolean';
  min?: number;                     // For numeric params
  max?: number;                     // For numeric params
  description: string;
}

// Action definition — one kind of move an agent can make
export interface ActionDef {
  name: string;                     // e.g. "extract", "contribute", "vote"
  description: string;
  params: ActionParam[];
  allowedRoles: string[];           // Which roles can perform this action (empty = all)
}

// Observation field definition — one piece of data agents can see
export interface ObservationField {
  name: string;                     // e.g. "poolLevel", "myWealth"
  type: 'number' | 'string' | 'boolean' | 'number[]' | 'string[]';
  visibility: 'public' | 'private';  // public = all agents see, private = only the agent itself
  description: string;
}

// An ambiguity detected during spec extraction
export interface Ambiguity {
  field: string;                    // Which part of the spec is ambiguous
  description: string;              // What's ambiguous
  severity: 'low' | 'medium' | 'high';
  resolution: string;               // How the extractor resolved it
}

// A role that agents can be assigned
export interface Role {
  name: string;                     // e.g. "harvester", "regulator"
  description: string;
}

// A shared resource in the scenario
export interface Resource {
  name: string;                     // e.g. "commons_pool", "bonus_fund"
  description: string;
  initialValue: number;
  min?: number;                     // Floor value (default 0)
  max?: number;                     // Ceiling value
}

// A rule / invariant that the economy must enforce
export interface Rule {
  description: string;
  type: 'hard' | 'soft';           // hard = abort on violation, soft = log + continue
}

// The normalized scenario extracted from a raw spec
export interface NormalizedScenario {
  name: string;
  description: string;
  agentCount: number;
  roles: Role[];
  resources: Resource[];
  actions: ActionDef[];
  observationModel: ObservationField[];
  rules: Rule[];
  ambiguities: Ambiguity[];
  collapseCondition: string;        // Natural-language description of when the scenario ends
  successCondition: string;         // Natural-language description of what "survival" means
  scenarioClass: 'single-action-simultaneous'; // Only supported class in v0.3.0
}

// Agent's decision each round — the strategy output contract for scenario mode
export interface AgentDecision {
  action: string;                   // Must match an ActionDef.name
  params: Record<string, number | string | boolean>;
}

// Generated economy module interface — what the economy generator must produce
export interface GeneratedEconomy {
  initState: (scenario: NormalizedScenario) => Record<string, unknown>;
  tick: (
    state: Record<string, unknown>,
    decisions: AgentDecision[],
    scenario: NormalizedScenario,
  ) => Record<string, unknown>;
  extractMetrics: (state: Record<string, unknown>, scenario: NormalizedScenario) => Record<string, number>;
  checkInvariants: (state: Record<string, unknown>, scenario: NormalizedScenario) => string[];
  isCollapsed: (state: Record<string, unknown>, scenario: NormalizedScenario) => boolean;
  getObservations: (
    state: Record<string, unknown>,
    agentIndex: number,
    scenario: NormalizedScenario,
  ) => Record<string, unknown>;
}

// Hard invariant violation — checked parent-side, not by generated code
export interface HardInvariantViolation {
  round: number;
  type: 'nan-detected' | 'missing-field' | 'wrong-agent-count' | 'type-mismatch';
  details: string;
}
