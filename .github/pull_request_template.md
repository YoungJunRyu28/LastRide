## What changed

Describe the user-visible and architectural change.

## Validation

- [ ] Typecheck passes.
- [ ] Generated API code has no drift.
- [ ] Tests pass against a database created from committed migrations.
- [ ] API bundle and Expo iOS/Android/web export pass.

## Release safety

- [ ] Any schema migration is backward compatible with the currently deployed code.
- [ ] No real credentials, tokens, locations, routes, addresses, or production data were added.
- [ ] Privacy/data-retention behavior is unchanged, or PRIVACY.md was updated.
- [ ] Provider-call volume / quota impact was considered.
- [ ] Operational changes have a rollback path.
