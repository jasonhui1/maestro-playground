## Hotfix: SSE Chat Logging Undefined Error
Date: 2026-04-17
Severity: S1
Reporter: user
Status: COMPLETED

### Problem
Multi-turn chat fails with "unacceptable kind of an object to dump [object Undefined]" during token streaming. This occurs when `js-yaml` encounters an `undefined` value in the frontmatter while saving agent logs.

### Root Cause
The `writeAgentLog` function in `lib/logger.ts` included optional fields (like `thought` and `version_number`) in the frontmatter object. If these fields were `undefined`, `matter.stringify` (which uses `js-yaml` internally) threw an error.

### Fix
Implemented a sanitization loop in `writeAgentLog` that removes all properties with `undefined` values from the `frontmatter` object before it is passed to `matter.stringify`.

### Testing
- [x] Verified code logic: `Object.keys(frontmatter).forEach(...)` correctly removes `undefined` values.
- [x] Build check: `npx tsc --noEmit` passed.


### Approvals
- [ ] Fix reviewed by lead-programmer
- [ ] Regression test passed (qa-tester)
- [ ] Release approved (producer)

### Rollback Plan
Revert changes to `lib/logger.ts`.
