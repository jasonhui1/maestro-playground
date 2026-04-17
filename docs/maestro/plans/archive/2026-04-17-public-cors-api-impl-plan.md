---
title: "Public CORS File Access API Implementation Plan"
design_ref: "docs/maestro/plans/2026-04-17-public-cors-api-design.md"
created: "2026-04-17T15:00:00Z"
status: "draft"
total_phases: 2
estimated_files: 3
task_complexity: "medium"
---

# Public CORS File Access API Implementation Plan

## Plan Overview
- **Total phases**: 2
- **Agents involved**: `coder`, `tester`
- **Estimated effort**: Medium. Primarily configuration changes and validation scripts.

## Dependency Graph
```
Phase 1: CORS Config (coder)
    |
    v
Phase 2: Verification (tester)
```

## Execution Strategy
| Stage | Phases | Execution | Agent Count | Notes |
|-------|--------|-----------|-------------|-------|
| 1     | Phase 1 | Sequential | 1 | Enable CORS headers |
| 2     | Phase 2 | Sequential | 1 | Verify and Document |

## Phase 1: Enable CORS for Workspace API
### Objective
Enable CORS headers in `next.config.ts` to allow local cross-origin access to the `/api/workspace/*` routes.

### Agent: `coder`
### Parallel: No

### Files to Modify
- `next.config.ts` — Add a `headers()` function to the `nextConfig` object to define `Access-Control-Allow-Origin: *`, `Access-Control-Allow-Methods`, and `Access-Control-Allow-Headers` for `/api/workspace/:path*`.

### Implementation Details
- Configuration must use Next.js 15 `NextConfig` type-safe headers structure.
- Ensure `OPTIONS` method is included to handle pre-flight requests.

### Validation
- Run `npm run lint` to ensure no syntax errors.
- Manually verify headers with `curl -I -X OPTIONS http://localhost:3000/api/workspace` (if possible in current env).

### Dependencies
- Blocked by: None
- Blocks: Phase 2

## Phase 2: Verification and Documentation
### Objective
Create a verification script to confirm CORS is working and provide usage documentation for external applications.

### Agent: `tester`
### Parallel: No

### Files to Create
- `tests/verify-cors.js` — A Node.js script using `fetch` or `curl` to verify that the CORS headers are being correctly served.
- `docs/maestro/api-usage.md` — A guide for other applications on how to fetch from the `/api/workspace/agents/[slug]` and `/api/workspace/chains/[slug]` endpoints.

### Implementation Details
- The verification script should handle pre-flight checks and verify the presence of `Access-Control-Allow-Origin: *`.
- The documentation should include `fetch` examples for JavaScript and `curl` examples.

### Validation
- Execute `node tests/verify-cors.js` and ensure it passes.
- Review `docs/maestro/api-usage.md` for clarity and completeness.

### Dependencies
- Blocked by: Phase 1
- Blocks: None

---

## File Inventory
| # | File | Phase | Purpose |
|---|------|-------|---------|
| 1 | `next.config.ts` | 1 | CORS Configuration |
| 2 | `tests/verify-cors.js` | 2 | Automated CORS verification |
| 3 | `docs/maestro/api-usage.md` | 2 | External API documentation |

## Risk Classification
| Phase | Risk | Rationale |
|-------|------|-----------|
| 1 | LOW | Simple configuration change, highly reversible. |
| 2 | LOW | Purely additive tests and documentation. |

## Execution Profile
```
Execution Profile:
- Total phases: 2
- Parallelizable phases: 0
- Sequential-only phases: 2
- Estimated parallel wall time: N/A
- Estimated sequential wall time: ~10 minutes

Note: Native subagents currently run without user approval gates.
All tool calls are auto-approved without user confirmation.
```

## Cost Estimation
| Phase | Agent | Model | Est. Input | Est. Output | Est. Cost |
|-------|-------|-------|-----------|------------|----------|
| 1 | `coder` | Pro | 2,100 | 600 | $0.05 |
| 2 | `tester` | Pro | 750 | 1,500 | $0.07 |
| **Total** | | | **2,850** | **2,100** | **$0.12** |
