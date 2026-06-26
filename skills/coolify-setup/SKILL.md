---
name: coolify-setup
description: Connect, authenticate, configure, reset, or troubleshoot the Coolify Codex plugin connection. Use when the user asks to set up Coolify from the Codex marketplace, connect Coolify, configure saved credentials, log in, log out, switch Coolify instances, avoid environment variables, or resolve missing/invalid Coolify API token errors.
license: MIT
---

# Coolify Setup

Use this skill for first-time setup, marketplace onboarding, saved credentials, login/logout, and connection troubleshooting for the Coolify plugin.

## Marketplace Flow

Marketplace users should not need a repo checkout or shell command.

1. Run `coolify_config_status` to see whether a connection is already saved.
2. If no usable connection exists, run `coolify_configure` without an `apiToken` argument.
3. Tell the user to complete the browser window that opens. The page lets them create or paste a scoped Coolify API token and saves it locally.
4. Run `coolify_config_status` again after the user says they finished.
5. If configured, continue with the requested Coolify task or switch to the `coolify` skill for operational work.

`coolify_configure` returns a short-lived local setup URL. If the browser does not open automatically, provide that URL to the user.

## Self-Hosted Instances

For self-hosted Coolify, call `coolify_configure` with `baseUrl` set to the instance root or `/api/v1` URL:

```json
{
  "baseUrl": "https://coolify.example.com"
}
```

The setup page links to the matching `/security/api-tokens` page.

## Storage

The token is stored locally:

- macOS Keychain when available.
- Otherwise, a local config file under `CODEX_HOME` or `~/.codex` with owner-only permissions.

Environment variables are fallback-only for automation:

- `COOLIFY_BASE_URL`
- `COOLIFY_API_TOKEN`

Do not make marketplace users set these manually.

## Token Handling

- Coolify API authentication uses `Authorization: Bearer <token>`.
- Coolify does not currently document browser OAuth-style authorization for API clients.
- Ask users to create a least-privileged scoped token.
- Do not ask users to paste tokens into chat unless the browser setup page is unavailable and they explicitly accept that tradeoff.
- Never print, summarize, or echo API tokens.

## Reset Or Switch Instance

- Use `coolify_logout` to forget the saved local connection.
- Then run `coolify_configure` again, passing `baseUrl` for a self-hosted instance when needed.

## Local Development Fallback

If the user is developing the plugin from a local checkout and specifically wants a terminal command, they can run:

```bash
npm run setup -- --save
```

For self-hosted instances:

```bash
npm run setup -- --save https://coolify.example.com
```
