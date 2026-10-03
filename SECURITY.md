# Security policy

## Reporting a vulnerability

Do not open a public issue for a suspected vulnerability, leaked credential,
authentication bypass, location/privacy exposure, or other security-sensitive
report.

Use GitHub's private vulnerability reporting / Security Advisory flow for this
repository when it is available. If that flow is unavailable, contact a
repository maintainer and request a private channel before sharing exploit
details, credentials, tokens, personal information, or production data.

Include the affected commit/version, reproduction steps, impact, and any safe
proof of concept that helps reproduce the issue. Never test against production
accounts or data you do not own or have explicit permission to use.

## Supported code

Security fixes target the current production release and the latest `main`.
Older development snapshots are not independently supported.

## Sensitive data

Never commit or paste:

- provider API keys;
- database connection strings;
- Supabase service-role credentials;
- bearer, participant, invite, refresh, or push tokens;
- production `.env` files;
- user locations, destinations, routes, or other personal trip data.

Use the environment and Secrets Manager contracts documented in
`.env.example` and `infra/README.md`.
