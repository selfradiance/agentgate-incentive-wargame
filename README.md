# Agent 006: Incentive Wargame

Stress-test incentive designs with AI-generated adversarial strategies.

v0.1.0 — Tragedy of the Commons simulation with 7 agent archetypes, 8 metrics, sandboxed execution.

## Setup

```bash
npm install
cp .env.example .env
# Add your ANTHROPIC_API_KEY to .env
```

Requires Node.js >= 22.

## Usage

```bash
# Default run (requires API key)
npx tsx src/cli.ts

# Deterministic run (no API key needed)
npx tsx src/cli.ts --fixtures

# Custom parameters
npx tsx src/cli.ts --rounds 100 --pool 5000 --regen 0.05 --max-extract 0.30

# Show generated strategy code
npx tsx src/cli.ts --verbose
```

### CLI Flags

| Flag | Type | Default | Range | Description |
|------|------|---------|-------|-------------|
| `--rounds` | integer | 50 | 1–200 | Number of simulation rounds |
| `--pool` | number | 1000 | 1.00–100,000.00 | Starting resource pool (also carrying capacity) |
| `--regen` | number | 0.10 | 0.00–1.00 | Pool regeneration rate per round |
| `--max-extract` | number | 0.20 | 0.01–1.00 | Max extraction rate (fraction of current pool) |
| `--fixtures` | boolean | false | — | Use hand-written deterministic strategies (no API key needed) |
| `--verbose` | boolean | false | — | Print generated strategy source code |

### Exit Codes

| Code | Meaning |
|------|---------|
| 0 | Commons survived all rounds |
| 1 | Commons collapsed or simulation incomplete |
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

1. **Gini Coefficient** — wealth inequality (0 = equal, 1 = one agent has everything)
2. **Pool Survival** — did the commons survive all configured rounds?
3. **Per-Agent Total Wealth** — ranked extraction totals per archetype
4. **Over-Extraction Rate** — fraction of agent-rounds where extraction exceeded sustainable share
5. **System Efficiency** — total extraction / total MSY (can exceed 1.0 = borrowing from the future)
6. **Resource Health Trajectory** — min, average, and final pool level as fraction of starting pool
7. **Collapse Velocity** — rounds from first tipping point (extraction > MSY) to collapse
8. **First Over-Extraction Event** — which agent first exceeded sustainable share, and when

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

125 tests across 11 test files. Run with:

```bash
npm test
```

Key test categories: economy engine (13), fixture strategies (22), metrics (22), sandbox validator (19), sandbox executor (11), round dispatcher (10), simulation runner (5), strategy generator (6), reporter (5), permutation invariance (1), CLI (11).

## Audit Trail

| Audit | Auditor | Scope | Result |
|-------|---------|-------|--------|
| Design spec (3 rounds) | ChatGPT, Gemini, Grok | Full spec review | All blockers resolved; ChatGPT Round 3: "Build it" |
| 8-round code audit | Claude Code | Logic, security, sandbox, prompts, CLI, metrics, docs, deps | 14 findings fixed across 8 rounds; 125 tests green |
| Cold-eyes audit | Codex | Full codebase security + code quality review | Clean pass — 0 critical/high/medium findings |
| Cross-verification | Claude Code | Security-focused review of final codebase | Clean pass — confirmed sandbox isolation, IPC safety, economy math |

### Claude Code Audit Detail

| Round | Focus | Findings |
|-------|-------|----------|
| 1 | Logic Deep-Dive | 1 medium (forgiver self-inclusion bug), 1 low (retaliator redundancy) |
| 2 | Security & Sandbox | 1 medium (stale spawn timeout race), 2 lows accepted per spec |
| 3 | Prompt & Generation | 2 lows (archetype description, early abort) |
| 4 | CLI & UX | 2 mediums (progress bar hardcoded, incomplete exit code) |
| 5 | Metrics & Reporting | 2 lows (unused import, misleading label) |
| 6 | Integration & Edge Cases | 1 low (report error path) |
| 7 | Documentation Accuracy | 2 mediums + 2 lows (README, AGENTS.md, context file, gitignore) |
| 8 | Dependencies & Supply Chain | Clean pass |

## Design Spec

The locked design spec is in `agent-006-design-spec-v0.1.0-FINAL.md`. It defines all game rules, archetype behaviors, strategy contract, sandbox model, metrics formulas, error handling policies, and the 14-step build order.

## License

Private.
