# Agent 006: Incentive Wargame — Project Context

**Version:** v0.3.0
**Status:** Build complete — awaiting audit
**Last updated:** 2026-03-28

## What This Is

Agent 006 stress-tests incentive designs by running AI-generated adversarial strategies against economic rules and measuring whether the system survives. v0.1.0 simulates the Tragedy of the Commons with 7 fixed agent archetypes. v0.2.0 adds recursive strategy adaptation: agents observe their own results and adapt strategies across multiple simulation runs. v0.3.0 adds user-defined scenarios: users provide a natural language spec, and the system extracts a structured scenario, generates a custom economy module, archetypes, and strategies, then runs the simulation and reports results.

## Architecture

### Commons Mode (v0.1.0/v0.2.0 — unchanged)
- **CLI** (src/cli.ts) — entry point, arg parsing, orchestration (single-run + campaign mode)
- **Archetypes** (src/archetypes.ts) — 7 archetype descriptions
- **Fixtures** (src/fixtures.ts) — 7 hand-written deterministic strategies
- **Fixtures-Adaptation** (src/fixtures-adaptation.ts) — pre-written adapted strategies for deterministic campaign testing
- **Economy Engine** (src/economy.ts) — game state, pro-rata rationing, regeneration, collapse
- **Simulation Runner** (src/runner.ts) — round loop + campaign loop with input validation
- **Adapter** (src/adapter.ts) — observation packets, Claude API strategy adaptation
- **Metrics** (src/metrics.ts) — 8 original metrics + 3 campaign metrics

### Scenario Mode (v0.3.0 — new)
- **Extractor** (src/extractor.ts) — Claude API: natural language spec → NormalizedScenario
- **Confirmation Gate** (src/cli.ts:confirmScenario) — formatted summary + user y/n prompt
- **Economy Generator** (src/economy-gen.ts) — Claude API: NormalizedScenario → JS economy module (6 exports: initState, tick, extractMetrics, checkInvariants, isCollapsed, getObservations)
- **Archetype Generator** (src/archetype-gen.ts) — Claude API: NormalizedScenario → N archetype descriptions
- **Scenario Strategy Generator** (src/generator.ts:generateScenarioStrategies) — Claude API: archetypes + scenario → Strategy[] returning AgentDecision
- **Scenario Runner** (src/runner.ts:runScenarioSimulation) — full round loop using sandbox economy VM with hard/soft invariant checking
- **Scenario Adapter** (src/adapter.ts:adaptAllScenarioStrategies) — scenario-aware strategy adaptation
- **Scenario Reporter** (src/reporter.ts:generateScenarioReport) — scenario-aware analysis report

### Shared Infrastructure
- **Types** (src/types.ts) — all shared type definitions (v0.1.0 + v0.2.0 + v0.3.0 scenario types)
- **Sandbox** (src/sandbox/) — validator, executor, child-runner (VM contexts), round-dispatcher (IPC)
  - **Two-VM Architecture** (v0.3.0): Economy VM (persistent per run, loads generated economy code) + Strategy VM (fresh per execution). Both run in the same child process with JSON serialization boundary between contexts.
- **Strategy Generator** (src/generator.ts) — Claude API → JS strategy functions (commons + scenario)
- **Reporter** (src/reporter.ts) — Claude API → structured findings report (single-run + campaign + scenario)
- **Anthropic Client** (src/anthropic-client.ts) — shared SDK instance

### Scenario Pipeline Flow
```
spec.txt → extractScenario() → confirmScenario() → generateEconomyModule()
→ generateArchetypes() → generateScenarioStrategies() → runScenarioSimulation()
→ generateScenarioReport()
```

## Build Progress

### v0.1.0 (Complete)
- [x] Steps 1-14: Full v0.1.0 implementation and audit

### v0.2.0 (Complete)
- [x] Step 1: Add campaign types to types.ts
- [x] Step 2: Add canonical state battery + campaign metrics to metrics.ts
- [x] Step 3: Create adapter module (src/adapter.ts)
- [x] Step 4: Add campaign loop to runner.ts
- [x] Step 5: Expand reporter.ts for cross-run analysis
- [x] Step 6: Add --runs flag to CLI
- [x] Step 7: Create fixture-adaptation strategies
- [x] Step 8: Write tests (42 new tests)
- [x] Step 9: Update project context
- [x] 8-round Claude Code audit (15 findings fixed)
- [x] Codex cold-eyes security hardening (+6 tests, re-sandboxed drift/convergence)
- [x] Claude Code cross-verification of Codex changes (clean pass)
- [x] Tagged v0.2.0

### v0.3.0 (Build Complete — Awaiting Audit)
- [x] Step 1: Types & Interfaces — NormalizedScenario, ActionDef, ActionParam, ObservationField, AgentDecision, GeneratedEconomy, HardInvariantViolation
- [x] Step 2: Spec Extractor — extractScenario(), validateNormalizedScenario(), 28 tests
- [x] Step 3: CLI Confirmation Gate — formatScenarioSummary(), confirmScenario(), 14 tests
- [x] Step 4: Sandbox Validator Extensions — validateEconomyModule(), validateDecision(), 21 tests
- [x] Step 5: Economy Module Generator — generateEconomyModule() with Claude API, 6 tests
- [x] Step 6: Commons-as-Spec Regression — hand-written economy fixture, 3 divergence tests (<10%)
- [x] Step 7: Sandbox Two-VM Architecture — economy VM (persistent) + strategy VM (fresh), 9 tests
- [x] Step 8: Archetype Generator — generateArchetypes() with Claude API, 9 tests
- [x] Step 9: Scenario Strategy Generator — generateScenarioStrategies() with AgentDecision contract
- [x] Step 10: Scenario-Aware Runner — runScenarioSimulation() with hard/soft invariants, 4 tests
- [x] Step 11: Scenario Adapter — adaptAllScenarioStrategies() with scenario context
- [x] Step 12: Scenario Reporter — generateScenarioReport(), formatScenarioMetricsOnly()
- [x] Step 13: CLI Update — runScenarioMode() full pipeline orchestration, new flags
- [x] Step 14: Example Specs — 4 examples (commons, public-goods, ultimatum, pollution)
- [x] Step 15: Tests — 20 new tests for CLI flags and scenario reporter (267 → 287)

## Test Coverage

301 tests across 20 test files, all passing:

| File | Tests | Scope |
|------|-------|-------|
| economy.test.ts | 13 | Extraction, pro-rata, regeneration, collapse, float stability |
| fixtures.test.ts | 22 | All 7 archetypes incl. forgiver self-exclusion |
| metrics.test.ts | 25 | All 8 original metrics formulas + empty edge cases |
| campaign-metrics.test.ts | 25 | Canonical battery, drift, convergence, resilience, theater, collapse |
| adapter.test.ts | 5 | Observation packets, truncation |
| campaign.test.ts | 15 | CLI --runs flag, campaign loop, fixture-adaptation, abort, adaptFn throws |
| sandbox/validator.test.ts | 45 | Strategy/economy/decision validation, blocked patterns, string gadgets |
| sandbox/executor.test.ts | 11 | Normalization, error handling |
| sandbox/round-dispatcher.test.ts | 10 | IPC, timeout, crash recovery, cross-round contamination |
| sandbox/economy-dispatcher.test.ts | 9 | Economy VM load, function calls, error handling |
| runner.test.ts | 5 | Full simulation, metrics, collapse, float precision |
| scenario-runner.test.ts | 4 | Basic run, metrics, collapse, invalid decisions |
| generator.test.ts | 6 | API calls, retry, fallback, validation |
| reporter.test.ts | 13 | Report generation, truncation, fallback, scenario report, scenario metrics |
| extractor.test.ts | 28 | Scenario validation, field types, bounds, unsupported classes, edge cases |
| economy-gen.test.ts | 6 | Economy module validator acceptance |
| archetype-gen.test.ts | 9 | Archetype validation, count, uniqueness, required fields |
| commons-regression.test.ts | 3 | Pool levels, collapse outcome, total wealth within 10% |
| permutation.test.ts | 1 | Simultaneous-move semantics proof |
| cli.test.ts | 32 | Arg parsing, validation, --spec/--agents/--yes/--dry-run, mutual exclusion, scenario formatting, confirmation gate |

## v0.3.0 Key Design Decisions

- **NormalizedScenario** — structured representation with actions, params, observations, roles, resources, rules, ambiguities
- **scenarioClass: 'single-action-simultaneous'** — only supported class; sequential/phased/negotiation/multi-action rejected at extraction
- **AgentDecision** — `{ action: string, params: Record<string, ...> }` contract for scenario strategies
- **GeneratedEconomy** — 6 required exports (initState, tick, extractMetrics, checkInvariants, isCollapsed, getObservations)
- **Two VM contexts in one child process** — economy VM (persistent, module-scoped state) + strategy VM (fresh per execution), JSON serialization boundary
- **Hard vs soft invariants** — hard (NaN, wrong agent count) = abort run; soft (rule violations) = log + continue
- **Decision validation** — action names, param types/ranges, role permissions checked before each tick; invalid → no-op (first action, minimal params)
- **Commons-as-spec regression gate** — hand-written economy fixture matching hardcoded economy.ts, verifying <10% divergence
- **Confirmation gate default on** — `--yes` to skip, prevents accidental API spend
- **Dry-run mode** — `--dry-run` stops after extractor + economy gen + archetype gen, prints results

## v0.2.0 Key Design Decisions

- **Campaign loop** wraps existing runSimulation() — no changes to core simulation
- **Adapter is separate from generator** — different prompts, different error handling
- **Full economy reset between runs** — isolates adaptation effects
- **All 7 agents adapt** — archetype personality enforced via prompt, not runtime invariants
- **Canonical state battery** (5 fixed + up to 3 run-specific) — deterministic behavioral measurement
- **Drift/convergence evaluated in sandbox** — same child process + VM isolation as simulation; no new Function() in main process
- **Observation packet** — private wealth + public extraction model with truncation for >50 rounds
- **Prompt injection defense** — observation data and prior strategy sanitized and marked as inert in adapter prompts
- **Input validation** — config, archetypes, strategies validated at runSimulation() entry and after each adaptation phase
- **Fixture-adaptation mode** — drop-in replacement for live API calls in tests
- **Abort threshold** — >= 2 adaptation failures OR incomplete run aborts campaign
- **Single cross-run report** — one API call at campaign end, not per-run

## CLI Flags

| Flag | Default | Description |
|------|---------|-------------|
| `--spec <path>` | — | Path to scenario spec file (enables scenario mode) |
| `--agents N` | — | Override agent count (2-20, requires --spec) |
| `--yes` | false | Auto-confirm scenario extraction (skip y/n prompt) |
| `--dry-run` | false | Stop after extraction + economy gen + archetype gen |
| `--runs M` | 3 | Number of simulation runs in campaign (max 10, commons mode only) |
| `--rounds N` | 50 | Rounds per run |
| `--pool` | 1000 | Starting pool size (commons mode only) |
| `--regen` | 0.10 | Regeneration rate (commons mode only) |
| `--max-extract` | 0.20 | Max extraction rate (commons mode only) |
| `--verbose` | false | Show extracted JSON, generated economy code, strategy code |
| `--fixtures` | false | Use fixture strategies (mutually exclusive with --spec and --runs > 1) |

### Mutual Exclusions
- `--spec` and `--fixtures` are mutually exclusive
- `--agents` requires `--spec`
- `--fixtures` and `--runs > 1` are mutually exclusive

## Exit Codes

- **0** = campaign completed / scenario survived, commons survived all runs
- **1** = commons collapsed, incomplete, campaign aborted, or hard violations
- **2** = never started (missing API key, invalid args, etc.)

## Known Limitations

1. **vm module is not a security boundary** — mitigated by --permission flag and normalization
2. **Validator is structural lint, not semantic** — VM isolation is the real enforcement
3. **No persistence** — results printed to stdout only
4. **Fixed archetype count in commons mode** — locked to 7
5. **Campaigns are non-deterministic** — Claude API responses vary; fixture-adaptation covers testing
6. **No runtime archetype enforcement** — personality enforced via prompt, monitored via convergence metric
7. **Single action per round only** — scenarioClass 'single-action-simultaneous' is the only supported class
8. **No complex param types** — action params limited to number, boolean, string (no arrays, objects, enums)
9. **No multi-phase or sequential scenarios** — all agents act simultaneously each round
10. **No negotiation or communication** — agents cannot exchange messages or signal intentions
11. **Generated economy quality depends on Claude** — economy module may not perfectly capture spec intent; commons regression gate provides baseline validation
12. **No scenario campaign mode yet** — scenario mode runs a single simulation (no multi-run adaptation)

## Example Specs

4 example scenarios in `examples/`:
- `commons.txt` — Tragedy of the Commons (regression baseline)
- `public-goods.txt` — Public Goods Game with multiplier
- `ultimatum.txt` — Ultimatum Bargaining with proposer/responder roles
- `pollution.txt` — Pollution Permits with accumulating externality

## Audit Trail

### v0.1.0
| Audit | Auditor | Result |
|-------|---------|--------|
| Design spec (3 rounds) | ChatGPT, Gemini, Grok | All blockers resolved |
| 8-round code audit | Claude Code | 14 findings fixed; 125 tests green |
| Cold-eyes audit | Codex | Clean pass — 0 critical/high/medium |
| Cross-verification | Claude Code | Clean pass |

### v0.2.0
| Audit | Auditor | Result |
|-------|---------|--------|
| 8-round code audit | Claude Code | 15 findings fixed; 167 tests green |
| Cold-eyes security hardening | Codex | Re-sandboxed drift/convergence, tightened IPC/state validation, prompt injection defense, input validation; 173 tests green |
| Cross-verification | Claude Code | Clean pass — all Codex changes correct and complete |

### v0.3.0
| Audit | Auditor | Result |
|-------|---------|--------|
| Cold-eyes audit | Codex | 18 files changed (+931/-305): economy VM fresh per call, single-function validation, role-gated fail-closed, null no-op decisions, economy output validation, prompt data blocks with size limits, prompt-safety.ts; 301 tests green |
| Cross-verification | Claude Code | 3 medium + 4 low findings fixed; 301 tests green. 4 low findings accepted (mitigated by other defense layers). |

## Accepted Low Findings (mitigated, not worth regression risk)

- **L2** (validator.ts:19): `/\bglobal\b(?!\.)/ ` doesn't match `global.process`. Mitigated by per-keyword rules (`process`, `require`, etc.) and VM global scrubbing.
- **L3** (validator.ts:217): Nested template literal stripping incomplete. Worst case is false positive (safe-side failure).
- **L5** (runner.ts:469,492): Double type-erasure casts (`as unknown as ...`) bypass compile-time checks. Mitigated by runtime validation before each cast.
- **L6** (child-runner.js:358-365): Observation spread could collide with non-overridden state fields. Mitigated by explicit overrides for `agentIndex`, `agentCount`, `round`, `totalRounds`.

## Next Steps

1. Tag v0.3.0
