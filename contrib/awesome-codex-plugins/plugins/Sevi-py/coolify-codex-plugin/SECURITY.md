# Security Policy

## Supported Versions

Security fixes are handled on the default branch until the plugin publishes tagged releases.

## Reporting a Vulnerability

Please report suspected vulnerabilities privately through GitHub security advisories for this repository, or by contacting the repository owner directly if advisories are unavailable.

Do not include Coolify API tokens, server IPs, private keys, environment variable values, deployment logs containing secrets, or other sensitive instance data in public issues.

## Operational Notes

- The plugin reads `COOLIFY_BASE_URL` and `COOLIFY_API_TOKEN` from the process environment.
- API tokens are not stored by the plugin.
- Tool responses redact sensitive-looking fields by default.
- Use a scoped Coolify token with only the permissions needed for the task.
