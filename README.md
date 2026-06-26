# Coolify Codex Plugin

Control self-hosted Coolify from Codex through a local MCP server and a Coolify-aware workflow skill.

The plugin is built around a sanitized endpoint index generated from Coolify's official OpenAPI spec for the `v4.x` branch. It includes named tools for the workflows agents use most often, plus a generic API request tool and OpenAPI search for complete endpoint coverage as Coolify evolves.

## Capabilities

- Check Coolify health and version.
- List and inspect applications, databases, deployments, projects, resources, servers, services, and teams.
- Start, stop, and restart applications, databases, and services.
- Trigger deployments by UUID or tag.
- Read recent application logs.
- List, create, update, bulk update, and delete environment variables.
- Call any Coolify `/api/v1` endpoint with `coolify_request`.
- Search the bundled OpenAPI file with `coolify_openapi_search`.

## Requirements

- Node.js 20 or newer.
- A Coolify instance with API access enabled.
- A Coolify API token.

Create an API token in Coolify at `/security/api-tokens`. Use the least-privileged token that can perform the work you want Codex to do.

## Configuration

Set these environment variables where Codex starts MCP servers:

```bash
export COOLIFY_BASE_URL="https://coolify.example.com"
export COOLIFY_API_TOKEN="your-coolify-api-token"
```

`COOLIFY_BASE_URL` can be either the instance root or the API root:

```bash
https://coolify.example.com
https://coolify.example.com/api/v1
```

## MCP Tools

| Tool | Purpose |
| --- | --- |
| `coolify_health` | Check instance health and version. |
| `coolify_openapi_search` | Find official endpoints, schemas, and request shapes. |
| `coolify_request` | Call any relative Coolify API path. |
| `coolify_list` | List common resource kinds. |
| `coolify_get` | Fetch one common resource. |
| `coolify_lifecycle` | Start, stop, or restart a resource. |
| `coolify_deploy` | Trigger a deployment. |
| `coolify_application_logs` | Fetch application logs. |
| `coolify_envs` | Manage environment variables. |

Sensitive-looking fields are redacted by default. Some tools accept `revealSensitive: true` for cases where the raw API response is explicitly needed.

## Development

```bash
npm run check
npm run inspect:openapi
```

The MCP server is dependency-free and uses only Node.js built-ins.

## Sources

- Coolify authorization docs: <https://coolify.io/docs/api-reference/authorization>
- Coolify OpenAPI source: <https://github.com/coollabsio/coolify/blob/v4.x/openapi.json>
- Coolify CLI automation reference: <https://github.com/coollabsio/coolify-cli>

## License

MIT
