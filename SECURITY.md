# Security reporting

## Supported versions

There are no published releases yet. Version 0.1.0 is an unreleased candidate.
Reports concerning the current main branch are welcome. Published compatibility
and upgrade expectations will follow the versioned README and changelog.

## Report privately

Use GitHub's **Report a vulnerability** option in this repository's Security
tab when available, or email **security@ehven.com**. Use GitHub Issues only for
non-sensitive bugs. Do not post a suspected vulnerability in a public issue.

Include the package version or commit, runtime and a minimal synthetic example,
along with the observed behavior and expected security impact. Remove credentials,
cookies, private response data and client information. If sensitive evidence is
needed, first arrange an appropriate private exchange with the maintainer.

Allow time for investigation and a corrective release before public disclosure.
No response-time SLA or bounty is promised. A report is not confirmation that a
vulnerability exists; findings and remedies require investigation.

## Scope

This package applies caller-selected header rules. It does not certify the
security of an application's CSP, authentication, cache, proxy or hosting setup.
Explicit `enforce`, `skip` and `remove` rules can weaken protection deliberately;
the integrator owns the resulting policy. See the README for response, streaming
and host-specific encoding boundaries.
