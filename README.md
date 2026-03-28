# Agent 006: Incentive Wargame

Stress-test incentive designs with AI-generated adversarial strategies.

v0.2.0 — Tragedy of the Commons simulation with 7 agent archetypes, recursive strategy adaptation, 11 metrics, sandboxed execution.

## Setup

```bash
npm install
cp .env.example .env
# Add your ANTHROPIC_API_KEY to .env
```

Requires Node.js >= 22.

## Usage

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

| Flag | Type | Default | Range | Description |
|------|------|---------|-------|-------------|
| `--rounds` | integer | 50 | 1–200 | Number of simulation rounds per run |
| `--pool` | number | 1000 | 1.00–100,000.00 | Starting resource pool (also carrying capacity) |
| `--regen` | number | 0.10 | 0.00–1.00 | Pool regeneration rate per round |
| `--max-extract` | number | 0.20 | 0.01–1.00 | Max extraction rate (fraction of current pool) |
| `--runs` | integer | 3 | 1–10 | Number of campaign runs (agents adapt between runs) |
| `--fixtures` | boolean | false | — | Use hand-written deterministic strategies (no API key needed; mutually exclusive with --runs > 1) |
| `--verbose` | boolean | false | — | Print generated strategy source code |

### Exit Codes

| Code | Meaning |
|------|---------|
| 0 | Commons survived all rounds (single run) or all runs (campaign) |
| 1 | Commons collapsed, simulation incomplete, or campaign aborted |
| 2 | Never ran (bad args, generation failure, fatal error) |

## Archetypes

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

## Sandbox Architecture

Strategies execute in a **forked child process** with Node.js `--permission` flag (filesystem restricted to the child runner script only). Each strategy runs in a **fresh `node:vm` context** per execution with `codeGeneration: { strings: false, wasm: false }` — no `eval`, no `Function` constructor, no access to `process`, `require`, or any Node globals.

**Defense in depth:**
- **String-level validation** — 35 blocked patterns (globals, async, I/O, prototype access) checked after stripping comments/strings
- **Fresh VM context** — each strategy gets an isolated context with only the serialized state object; no cross-round contamination
- **Code generation disabled** — blocks the primary VM escape vector
- **Permission-restricted child** — even a theoretical VM escape lands in a locked-down process
- **IPC request-ID correlation** — parent validates every response message (type, requestId, array length, element types); mismatches kill the child
- **Parent-enforced 3-second timeout** — SIGKILL + respawn on timeout (sync infinite loops can't be interrupted from inside the event loop)
- **Extraction normalization** — all values clamped, NaN/Infinity/negatives → 0, over-max → capped

## Tests

173 tests across 14 test files. Run with:

```bash
npm test
```

Key test categories: economy engine (13), fixture strategies (22), metrics (25), campaign metrics (25), adapter (5), campaign integration (15), sandbox validator (24), sandbox executor (11), round dispatcher (10), simulation runner (5), strategy generator (6), reporter (6), permutation invariance (1), CLI (5).

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

## License

Private.
