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
