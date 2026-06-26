---
name: coolify
description: Control self-hosted Coolify instances from Codex using the bundled Coolify API MCP server. Use when the user asks to inspect, deploy, create, update, restart, stop, configure, or troubleshoot Coolify applications, services, databases, servers, projects, deployments, environment variables, domains, teams, private keys, GitHub apps, cloud tokens, scheduled tasks, backups, or other Coolify API resources.
license: MIT
---

# Coolify

Use this skill when working with a self-hosted Coolify instance.

## Before Acting

1. Confirm the task affects the intended Coolify instance, project, environment, and resource.
2. Prefer read-only discovery first: health, current team, projects, servers, and resources.
3. Never print API tokens, private keys, password values, environment variable values, raw secrets, IPs, or credentials unless the user explicitly asks and the task requires it.
4. Treat deployments, starts, stops, restarts, deletes, env changes, private key changes, cloud token changes, API enable/disable, MCP enable/disable, server creation, and domain overrides as mutating operations.
5. For destructive or broad mutating operations, restate the exact target UUID/name and proceed only when the user's request is already clear.

## Configuration

The MCP server expects:

- `COOLIFY_BASE_URL`: the Coolify instance root, or the `/api/v1` URL.
- `COOLIFY_API_TOKEN`: a scoped Coolify API token.

If a tool reports missing configuration, help the user set those environment variables. Do not ask the user to paste secrets into chat unless there is no safer path.

Coolify does not currently document browser OAuth-style authorization for API clients. If the user wants setup help, use `coolify_setup` or suggest running:

```bash
npm run setup -- https://coolify.example.com
```

## Tooling Strategy

Use MCP tools from `coolify-api` when available:

- `coolify_health`: verify instance health and version.
- `coolify_setup`: generate setup URLs and token guidance.
- `coolify_list`: list common resources.
- `coolify_get`: inspect one resource.
- `coolify_lifecycle`: start, stop, or restart apps, services, and databases.
- `coolify_deploy`: trigger deployments by UUID or tag.
- `coolify_application_logs`: fetch application logs.
- `coolify_envs`: manage environment variables.
- `coolify_openapi_search`: find less common endpoint details.
- `coolify_request`: call any relative `/api/v1` endpoint.

For endpoints not covered by named tools, call `coolify_openapi_search` first, then use `coolify_request` with the path, query, and body shape from the bundled OpenAPI spec.

## Common Workflows

### Instance Inventory

1. Run `coolify_health`.
2. Run `coolify_request` for `/teams/current`.
3. List `project`, `server`, `resource`, `application`, `service`, and `database` as needed.
4. Summarize names, UUIDs, status, domains, servers, and project/environment relationships.

### Deployment

1. Identify the exact resource UUID or deployment tag.
2. Check current resource status and recent deployments.
3. Run `coolify_deploy`.
4. Poll deployments or fetch application logs if the user wants follow-up.

### Environment Variables

1. Use `coolify_envs` with `action: "list"` first.
2. Keep values redacted by default.
3. For creates or updates, use `action: "create"`, `action: "update"`, or `action: "bulk_update"`.
4. Do not delete variables unless the user explicitly requested deletion.

### Logs and Troubleshooting

1. Inspect the resource and its server.
2. Fetch recent application logs with an appropriate line count.
3. Check deployments for failed or running jobs.
4. Use `coolify_request` for server validation, domains, backups, scheduled task executions, or specific API endpoints after finding them in OpenAPI.

## API Notes

- Coolify API base path is `/api/v1`.
- Authentication uses `Authorization: Bearer <token>`.
- Common resource identifiers are UUIDs. Team endpoints use numeric IDs.
- `/health` may be available outside `/api/v1`; the MCP health tool handles both forms.
- `GET /deploy` triggers deployment by UUID or tag. Coolify also accepts deployment parameters in other forms, but prefer the tool unless OpenAPI lookup says otherwise.
- Environment variable list responses can contain sensitive fields. Keep default redaction on unless raw values are required.

## Safety Defaults

- Use least-privilege tokens.
- Avoid logging secrets.
- Prefer exact UUIDs over fuzzy names for mutating calls.
- If a domain conflict or force override appears, surface the conflict and ask for confirmation before proceeding.
- If Coolify returns a 401 or 403, explain that the token may be missing, expired, scoped too narrowly, or associated with the wrong team.
