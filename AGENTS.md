# Agent 006: Incentive Wargame — Agent Archetypes

| # | Archetype   | Strategy                                                                 |
|---|-------------|--------------------------------------------------------------------------|
| 0 | Greedy      | Always extracts the maximum allowed.                                     |
| 1 | Cooperative | Extracts only sustainable share (MSY / agentCount) or less.              |
| 2 | Retaliator  | Starts cooperative. Grim trigger: permanent max if anyone over-extracts. |
| 3 | Forgiver    | Tit-for-tat with de-escalation. Punishes once, then forgives. Excludes own extraction from the check. |
| 4 | Opportunist | Cooperates while pool > 50%. Max extraction below that threshold.        |
| 5 | Adaptive    | Watches 3-round pool trend. Increases extraction proportional to decline.|
| 6 | Stabilizer  | Extracts exactly what keeps the pool at its current level.               |
