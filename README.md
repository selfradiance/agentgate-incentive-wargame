# Agent 006: Incentive Wargame

Stress-test incentive designs with AI-generated adversarial strategies.

v0.1.0 — Tragedy of the Commons simulation with 7 agent archetypes.

## Setup

```bash
npm install
cp .env.example .env
# Add your ANTHROPIC_API_KEY to .env
```

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
