# Review Standards

## Passes
1. Bugs and logic errors
2. Security and vulnerabilities
3. Compliance against spec.md, plan.md, and design principles

## Evidence Requirement
Every finding cites file/line and concrete evidence.

## Severity Levels
- **Critical**: Must fix before merge
- **Important**: Should fix before merge
- **Nit**: Minor style/preference (max 5 per review)

## Skip
- Generated paths
- Anything CI already enforces

## Bidirectional
- Agent reviews incoming PRs
- Agent addresses review comments on its own PRs
- Second-time mistake → correction goes into CLAUDE.md