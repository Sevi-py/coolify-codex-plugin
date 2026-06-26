# Security Policy

## Supported Versions

Security fixes are handled on the default branch until the plugin publishes tagged releases.

## Reporting a Vulnerability

Please report suspected vulnerabilities privately through GitHub security advisories for this repository, or by contacting the repository owner directly if advisories are unavailable.

Do not include Coolify API tokens, server IPs, private keys, environment variable values, deployment logs containing secrets, or other sensitive Coolify Cloud or instance data in public issues.

## Operational Notes

- The plugin reads `COOLIFY_API_TOKEN` from the process environment and uses `COOLIFY_BASE_URL` when set.
- If `COOLIFY_BASE_URL` is not set, the plugin uses Coolify Cloud at `https://app.coolify.io`.
- API tokens are not stored by the plugin.
- Tool responses redact sensitive-looking fields by default.
- Use a scoped Coolify token with only the permissions needed for the task.
