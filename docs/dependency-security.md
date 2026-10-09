# Dependency security status

Last reviewed: 2026-10-07

LastRide treats `pnpm audit` as one input to release review rather than hiding
transitive findings with blanket ignores. The workspace pins patched compatible
transitives in `pnpm-workspace.yaml` when a safe same-major fix is available,
and Dependabot is enabled for npm and GitHub Actions.

## Current production-dependency audit

After compatible overrides, `pnpm audit --prod --json` reports:

- 0 critical
- 4 high
- 2 moderate
- 0 low

This is down from 37 high findings in the production dependency graph before
the overrides. On 2026-10-07, newly published critical advisories in
`proxy-addr` (Express) and `shell-quote` (React Native devtools) were cleared
with same-major overrides to 2.0.8 and 1.11.0 respectively; both remain covered
by the normal test and production-bundle gates.

The remaining high findings are all transitive through the Expo toolchain:

- `image-size` through Expo Metro has two denial-of-service advisories. The
  audit's patched line is `>=2.0.3`, while Expo currently resolves the 1.x API.
  Forcing a cross-major override is not considered safe without an Expo/Metro
  compatibility upgrade.
- `node-forge` through Expo CLI has an RSA verification advisory for which the
  audit currently reports no patched release.
- `braces` through Expo Metro's file-map/micromatch path has a recursion DoS
  advisory for which the audit currently reports no patched release.

These packages are not imported by the LastRide API application code. They are
part of Expo/Metro/CLI build and development paths. That reduces the direct
server-runtime attack surface, but it does not make the advisories irrelevant:
developers and CI should still treat untrusted project/build inputs cautiously
and update the Expo toolchain when compatible upstream releases remove them.

## Review rule

Before a production release:

1. run `pnpm audit --prod`;
2. investigate every new high or critical finding;
3. prefer a normal direct/upstream upgrade;
4. use a transitive override only when it stays within a compatible API line
   and the full typecheck/test/iOS-Android-web export suite passes;
5. do not force a major transitive version merely to reduce the audit count;
6. remove overrides once the owning dependency resolves to a patched version.

A new critical finding, or a high finding in code bundled into the public API
runtime with a viable exploit path, is a release blocker until resolved or
explicitly reviewed with a concrete mitigation.
