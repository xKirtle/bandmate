# Security policy

## Reporting a vulnerability

Report vulnerabilities privately, through GitHub's [private vulnerability reporting](https://github.com/xKirtle/bandmate/security/advisories/new). Never report one in a public issue, pull request or discussion.

Say what you found, which version or image tag it affects, and how to reproduce it.

## The security model

Bandmate is currently single-user and has no login. It trusts every request that reaches it, and leaves authentication to the reverse proxy in front of it ([ADR 0002](docs/adr/0002-single-user-auth-at-proxy.md)). That's how Bandmate works today, not a permanent design: accounts, multi-user support or OIDC may come later, and this policy will change with them.

## Scope

Anyone who can reach Bandmate can read and change every Song. That's by design under the current model, so it isn't a vulnerability. Keeping people who shouldn't reach it out is the reverse proxy's job.

What is in scope is anything that goes beyond reading and changing Songs through the app, or that turns Song content against the person using it. For example:

- Reading or writing files outside the data directory (`BANDMATE_DATA_DIR`), such as through path traversal
- Injection, such as SQL injection through the API
- Upload handling (Beats, Masters, Takes, Sounds, Covers, imported Songs) that crashes the server or corrupts the data directory
- Cross-site scripting (XSS) through Song content, such as lyrics, notes, titles or names

## Supported versions

Only the latest release gets security fixes. Upgrade to it to get them.

## Hardening

- Put Bandmate behind a reverse proxy that handles HTTPS and authentication. Browsers also only allow the microphone over HTTPS or on localhost.
- Don't expose it directly to the internet: bind its port to localhost or a private network, and let only the proxy reach it.
- Back up the data directory. It holds the database, every audio file and every Cover, so copying it is a full backup.
