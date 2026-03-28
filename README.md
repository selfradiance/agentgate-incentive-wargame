# Agent 006: Incentive Wargame

Stress-test incentive designs with AI-generated adversarial strategies.

v0.3.0 — User-defined scenarios via natural language specs, plus the original Tragedy of the Commons simulation with 7 agent archetypes, recursive strategy adaptation, 11 metrics, sandboxed execution.

## Setup

```bash
npm install
cp .env.example .env
# Add your ANTHROPIC_API_KEY to .env
```

Requires Node.js >= 22.

## Usage

### Scenario Mode (v0.3.0)

Define any economic scenario in plain English and let the system generate the full simulation:

```bash
# Run a custom scenario (requires API key)
npx tsx src/cli.ts --spec examples/public-goods.txt --yes

# Override agent count
npx tsx src/cli.ts --spec examples/pollution.txt --agents 6 --yes

# Dry run — extract scenario + generate economy + archetypes, then stop
npx tsx src/cli.ts --spec examples/ultimatum.txt --dry-run --yes

# Verbose — show extracted JSON, generated economy code, and strategies
npx tsx src/cli.ts --spec examples/commons.txt --yes --verbose

# Interactive confirmation (default — prompts y/n after extraction)
npx tsx src/cli.ts --spec examples/public-goods.txt
```

The scenario pipeline:
1. **Extract** — Claude reads your spec and produces a structured scenario (actions, observations, rules, resources)
2. **Confirm** — you review the extracted scenario and approve (or use `--yes` to skip)
3. **Generate Economy** — Claude writes a JavaScript economy module implementing your rules
4. **Generate Archetypes** — Claude designs diverse agent personalities for your scenario
5. **Generate Strategies** — Claude writes strategy code for each archetype
6. **Simulate** — agents play your scenario for N rounds in a sandboxed VM
7. **Report** — Claude analyzes the results

### Commons Mode (v0.1.0/v0.2.0)

The original Tragedy of the Commons simulation with 7 fixed archetypes:

```bash
# Default campaign (3 runs with adaptation, requires API key)
npx tsx src/cli.ts

# Single run (requires API key)
npx tsx src/cli.ts --runs 1

# Campaign with 5 runs
npx tsx src/cli.ts --runs 5

# Deterministic single run (no API key needed)
npx tsx src/cli.ts --fixtures

# Custom parameters
npx tsx src/cli.ts --rounds 100 --pool 5000 --regen 0.05 --max-extract 0.30

# Show generated strategy code
npx tsx src/cli.ts --verbose
```

### CLI Flags

#### Scenario Mode Flags

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `--spec <path>` | string | — | Path to scenario spec file (enables scenario mode) |
| `--agents N` | integer | — | Override agent count, 2–20 (requires `--spec`) |
| `--yes` | boolean | false | Auto-confirm scenario extraction (skip y/n prompt) |
| `--dry-run` | boolean | false | Stop after extraction + economy gen + archetype gen |

#### Commons Mode Flags

| Flag | Type | Default | Range | Description |
|------|------|---------|-------|-------------|
| `--rounds` | integer | 50 | 1–200 | Number of simulation rounds per run |
| `--pool` | number | 1000 | 1.00–100,000.00 | Starting resource pool (also carrying capacity) |
| `--regen` | number | 0.10 | 0.00–1.00 | Pool regeneration rate per round |
| `--max-extract` | number | 0.20 | 0.01–1.00 | Max extraction rate (fraction of current pool) |
| `--runs` | integer | 3 | 1–10 | Number of campaign runs (agents adapt between runs) |
| `--fixtures` | boolean | false | — | Use hand-written deterministic strategies (no API key needed) |

#### Shared Flags

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `--verbose` | boolean | false | Show generated code (strategies, economy module, extracted JSON) |

#### Mutual Exclusions

- `--spec` and `--fixtures` are mutually exclusive
- `--agents` requires `--spec`
- `--fixtures` and `--runs > 1` are mutually exclusive

### Exit Codes

| Code | Meaning |
|------|---------|
| 0 | Scenario survived / commons survived all rounds (single run or campaign) |
| 1 | Collapsed, incomplete, campaign aborted, or hard invariant violations |
| 2 | Never ran (bad args, generation failure, fatal error) |

## Scenario Specs

Write a plain-English description of your economic scenario. The system extracts structured game rules from your text.

### Supported Scenario Class

**Single-action simultaneous-move** — every agent chooses one action per round, all actions resolve simultaneously, state updates deterministically. This covers most classic game theory scenarios (commons dilemmas, public goods games, bargaining games, pollution models, etc.).

Not currently supported: sequential-move, multi-phase, negotiation/communication, or multi-action-per-round scenarios.

### Example Specs

Four example scenarios ship in `examples/`:

| File | Scenario | Agents | Key Mechanic |
|------|----------|--------|--------------|
| `commons.txt` | Tragedy of the Commons | 7 | Shared renewable resource with regeneration |
| `public-goods.txt` | Public Goods Game | 5 | Contribution multiplier split equally |
| `ultimatum.txt` | Ultimatum Bargaining | 6 | Proposer/responder roles with minimum thresholds |
| `pollution.txt` | Pollution Permits | 4 | Accumulating externality with natural decay |

### Writing Your Own Spec

A good spec includes:
- Number of agents and any distinct roles
- Available actions with parameter ranges
- What each agent can observe (public vs private information)
- Resource dynamics (regeneration, decay, caps)
- Collapse condition (when does the system fail?)
- Success condition (when does the system succeed?)

The extractor will flag ambiguities and resolve them with sensible defaults.

## Archetypes (Commons Mode)

| # | Name | Strategy |
|---|------|----------|
| 0 | Greedy | Always extracts the maximum allowed |
| 1 | Cooperative | Extracts only sustainable share (MSY / agentCount) |
| 2 | Retaliator | Cooperative until anyone over-extracts, then max forever (grim trigger) |
| 3 | Forgiver | Tit-for-tat with de-escalation. Excludes own extraction from the check |
| 4 | Opportunist | Cooperates while pool > 50%, max extraction below that |
| 5 | Adaptive | Watches 3-round pool trend, scales extraction with decline |
| 6 | Stabilizer | Extracts exactly what keeps the pool at its current level |

## Metrics

### Per-Run Metrics

1. **Gini Coefficient** — wealth inequality (0 = equal, 1 = one agent has everything)
2. **Pool Survival** — did the commons survive all configured rounds?
3. **Per-Agent Total Wealth** — ranked extraction totals per archetype
4. **Over-Extraction Rate** — fraction of agent-rounds where extraction exceeded sustainable share
5. **System Efficiency** — total extraction / total MSY (can exceed 1.0 = borrowing from the future)
6. **Resource Health Trajectory** — min, average, and final pool level as fraction of starting pool
7. **Collapse Velocity** — rounds from first tipping point (extraction > MSY) to collapse
8. **First Over-Extraction Event** — which agent first exceeded sustainable share, and when

### Campaign Metrics (v0.2.0)

9. **Strategy Drift** — mean behavioral change between adaptation rounds, measured across a canonical state battery (0 = no change, 1 = maximum change)
10. **Behavioral Convergence** — pairwise similarity across all 21 agent pairs (0 = diverse, 1 = identical strategies)
11. **Commons Resilience Trend** — survival rounds as primary signal, final pool health as tiebreaker, across campaign runs

### Detection Flags (v0.2.0)

- **Adaptation Theater** — detects when agents claim to adapt but behavior barely changes (low drift + collapsed = theater; low drift + survived = equilibrium)
- **Archetype Collapse** — detects when distinct agent personalities converge into homogeneous behavior (convergence > 0.8)

### Scenario Mode Metrics (v0.3.0)

In scenario mode, metrics are defined by the generated economy module's `extractMetrics()` function. The runner also tracks:
- **Hard invariant violations** — NaN in state, wrong agent count (aborts run)
- **Soft invariant violations** — rule violations from `checkInvariants()` (logged, run continues)
- **Invalid decision count** — decisions that fail action/param/role validation (replaced with no-op)

## Sandbox Architecture

Strategies and economy modules execute in a **forked child process** with Node.js `--permission` flag (filesystem restricted to the child runner script only).

### Two-VM Architecture (v0.3.0)

In scenario mode, the sandbox maintains two isolated VM contexts in the same child process:
- **Economy VM** — persistent per run, holds the generated economy module with mutable module-scoped state. All 6 economy functions (initState, tick, extractMetrics, checkInvariants, isCollapsed, getObservations) execute here.
- **Strategy VM** — fresh context per execution, same as commons mode. Strategy code runs here with only serialized observations visible.

Data crosses the VM boundary via **JSON serialization** — no object references leak between contexts.

### Defense in Depth

- **String-level validation** — 35 blocked patterns (globals, async, I/O, prototype access) checked after stripping comments/strings
- **Economy module validation** — 6 required exports, mutable module-scope block, 20KB size limit, same security patterns
- **Decision validation** — action names, param types/ranges, role permissions checked before each tick
- **Fresh VM context** — each strategy gets an isolated context with only the serialized state object; no cross-round contamination
- **Code generation disabled** — blocks the primary VM escape vector
- **Permission-restricted child** — even a theoretical VM escape lands in a locked-down process
- **IPC request-ID correlation** — parent validates every response message (type, requestId, array length, element types); mismatches kill the child
- **Parent-enforced 3-second timeout** — SIGKILL + respawn on timeout (sync infinite loops can't be interrupted from inside the event loop)
- **Extraction normalization** — all values clamped, NaN/Infinity/negatives → 0, over-max → capped

## Tests

287 tests across 20 test files. Run with:

```bash
npm test
```

Key test categories: extractor validation (28), sandbox validator (45), CLI + scenario confirmation (32), campaign metrics (25), metrics (25), fixtures (22), campaign integration (15), economy engine (13), reporter + scenario reporter (13), sandbox executor (11), round dispatcher (10), archetype generator (9), economy dispatcher (9), strategy generator (6), economy generator (6), simulation runner (5), adapter (5), scenario runner (4), commons regression (3), permutation invariance (1).

## Audit Trail

| Audit | Auditor | Scope | Result |
|-------|---------|-------|--------|
| v0.1.0 design spec (3 rounds) | ChatGPT, Gemini, Grok | Full spec review | All blockers resolved; ChatGPT Round 3: "Build it" |
| v0.1.0 8-round code audit | Claude Code | Logic, security, sandbox, prompts, CLI, metrics, docs, deps | 14 findings fixed across 8 rounds; 125 tests green |
| v0.1.0 cold-eyes audit | Codex | Full codebase security + code quality review | Clean pass — 0 critical/high/medium findings |
| v0.1.0 cross-verification | Claude Code | Security-focused review of final codebase | Clean pass — confirmed sandbox isolation, IPC safety, economy math |
| v0.2.0 8-round code audit | Claude Code | Adapter, metrics, campaign loop, sandbox, reporter, CLI, docs, deps | 8 rounds + final pass complete; 15 findings fixed, 167 tests green |
| v0.2.0 cold-eyes audit | Codex | Full codebase security hardening | Re-sandboxed drift/convergence, tightened IPC/state validation, prompt injection defense, input validation; 173 tests green |
| v0.2.0 cross-verification | Claude Code | Security review of Codex hardening changes | Clean pass — all changes correct and complete |

## Design Specs

- `agent-006-design-spec-v0.1.0-FINAL.md` — v0.1.0 base game: game rules, archetype behaviors, strategy contract, sandbox model, metrics formulas, error handling policies, and the 14-step build order.
- v0.2.0 adds campaign mode with recursive strategy adaptation, 3 new metrics (drift, convergence, resilience), and detection flags (adaptation theater, archetype collapse).
- v0.3.0 adds user-defined scenarios: spec extraction, economy/archetype/strategy generation, two-VM sandbox, hard/soft invariant checking, and scenario-aware reporting.

## License

MIT License
