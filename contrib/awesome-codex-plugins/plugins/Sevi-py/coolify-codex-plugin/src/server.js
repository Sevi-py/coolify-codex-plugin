#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const openapi = JSON.parse(readFileSync(resolve(__dirname, "../data/openapi-index.json"), "utf8"));

const resourceKinds = ["application", "database", "deployment", "project", "resource", "server", "service", "team"];
const lifecycleKinds = ["application", "database", "service"];
const lifecycleActions = ["start", "stop", "restart"];
const envKinds = ["application", "database", "service"];
const httpMethods = ["GET", "POST", "PATCH", "DELETE"];

const listPaths = {
  application: "/applications",
  database: "/databases",
  deployment: "/deployments",
  project: "/projects",
  resource: "/resources",
  server: "/servers",
  service: "/services",
  team: "/teams"
};

const itemPaths = {
  application: "/applications/{uuid}",
  database: "/databases/{uuid}",
  deployment: "/deployments/{uuid}",
  project: "/projects/{uuid}",
  server: "/servers/{uuid}",
  service: "/services/{uuid}",
  team: "/teams/{id}"
};

const tools = [
  {
    name: "coolify_health",
    title: "Coolify Health",
    description: "Check Coolify health and version without exposing credentials.",
    inputSchema: objectSchema({})
  },
  {
    name: "coolify_openapi_search",
    title: "Search Coolify OpenAPI",
    description: "Search the bundled official Coolify OpenAPI paths before calling less common endpoints.",
    inputSchema: objectSchema({
      query: { type: "string", minLength: 1, description: "Keyword, endpoint path, operation id, or tag to search for." },
      limit: { type: "integer", minimum: 1, maximum: 25, default: 10 }
    }, ["query"])
  },
  {
    name: "coolify_request",
    title: "Coolify API Request",
    description: "Call any Coolify /api/v1 endpoint using the bundled OpenAPI spec as the guide.",
    inputSchema: objectSchema({
      method: { type: "string", enum: httpMethods, default: "GET" },
      path: { type: "string", minLength: 1, description: "Relative API path such as /applications or /servers/{uuid}/validate." },
      query: { type: "object", additionalProperties: true },
      body: { type: "object", additionalProperties: true },
      revealSensitive: { type: "boolean", default: false, description: "Return sensitive-looking response fields instead of redacting them." }
    }, ["path"])
  },
  {
    name: "coolify_list",
    title: "List Coolify Resources",
    description: "List common Coolify resources such as applications, servers, projects, services, databases, and deployments.",
    inputSchema: objectSchema({
      kind: { type: "string", enum: resourceKinds },
      revealSensitive: { type: "boolean", default: false }
    }, ["kind"])
  },
  {
    name: "coolify_get",
    title: "Get Coolify Resource",
    description: "Fetch a single Coolify resource by UUID, or team by numeric ID.",
    inputSchema: objectSchema({
      kind: { type: "string", enum: resourceKinds.filter((kind) => kind !== "resource") },
      id: { type: "string", minLength: 1, description: "Resource UUID, or numeric team ID when kind is team." },
      revealSensitive: { type: "boolean", default: false }
    }, ["kind", "id"])
  },
  {
    name: "coolify_lifecycle",
    title: "Coolify Lifecycle Action",
    description: "Start, stop, or restart an application, database, or service.",
    inputSchema: objectSchema({
      kind: { type: "string", enum: lifecycleKinds },
      uuid: { type: "string", minLength: 1 },
      action: { type: "string", enum: lifecycleActions }
    }, ["kind", "uuid", "action"])
  },
  {
    name: "coolify_deploy",
    title: "Deploy Coolify Resource",
    description: "Trigger a deployment by resource UUID or deployment tag.",
    inputSchema: objectSchema({
      uuid: { type: "string", description: "Resource UUID or comma-separated UUIDs." },
      tag: { type: "string", description: "Deployment tag or comma-separated tags." },
      force: { type: "boolean", default: false },
      pullRequestId: { type: "integer" },
      dockerTag: { type: "string" }
    })
  },
  {
    name: "coolify_application_logs",
    title: "Coolify Application Logs",
    description: "Fetch recent logs for a Coolify application.",
    inputSchema: objectSchema({
      uuid: { type: "string", minLength: 1 },
      lines: { type: "integer", minimum: 1, maximum: 5000, default: 100 }
    }, ["uuid"])
  },
  {
    name: "coolify_envs",
    title: "Coolify Environment Variables",
    description: "List, create, update, bulk update, or delete environment variables for applications, databases, and services.",
    inputSchema: objectSchema({
      kind: { type: "string", enum: envKinds },
      uuid: { type: "string", minLength: 1 },
      action: { type: "string", enum: ["list", "create", "update", "bulk_update", "delete"], default: "list" },
      envUuid: { type: "string", description: "Environment variable UUID for delete." },
      data: { type: "object", additionalProperties: true, description: "Env payload for create/update, or { data: [...] } for bulk_update." },
      revealSensitive: { type: "boolean", default: false }
    }, ["kind", "uuid"])
  }
];

const handlers = {
  async coolify_health() {
    const cfg = config({ requireToken: false });
    let health;
    try {
      health = await coolifyFetch("/health", { requireToken: false });
    } catch (error) {
      if (error.status !== 404) {
        throw error;
      }
      health = await coolifyFetch("/api/health", { requireToken: false, apiBase: cfg.rootBase });
    }
    let version = null;
    if (cfg.token) {
      try {
        version = await coolifyFetch("/version");
      } catch {
        version = null;
      }
    }
    return toolText({ health, version });
  },

  async coolify_openapi_search(args) {
    const query = requiredString(args.query, "query").toLowerCase();
    const limit = clampInteger(args.limit ?? 10, 1, 25, "limit");
    const matches = [];
    for (const [path, methods] of Object.entries(openapi.paths || {})) {
      for (const [method, operation] of Object.entries(methods)) {
        const haystack = [
          path,
          method,
          operation.summary,
          operation.description,
          ...(operation.tags || [])
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        if (haystack.includes(query)) {
          matches.push(summarizeOperation(path, method, operation));
        }
      }
    }
    return toolText({ query: args.query, count: matches.length, matches: matches.slice(0, limit) });
  },

  async coolify_request(args) {
    const method = enumValue((args.method || "GET").toUpperCase(), httpMethods, "method");
    const path = requiredString(args.path, "path");
    const result = await coolifyFetch(path, {
      method,
      query: args.query,
      body: args.body
    });
    return toolText(result, { revealSensitive: Boolean(args.revealSensitive) });
  },

  async coolify_list(args) {
    const kind = enumValue(args.kind, resourceKinds, "kind");
    const result = await coolifyFetch(listPaths[kind]);
    return toolText(result, { revealSensitive: Boolean(args.revealSensitive) });
  },

  async coolify_get(args) {
    const kind = enumValue(args.kind, resourceKinds.filter((item) => item !== "resource"), "kind");
    const id = requiredString(args.id, "id");
    const result = await coolifyFetch(pathWithId(itemPaths[kind], id));
    return toolText(result, { revealSensitive: Boolean(args.revealSensitive) });
  },

  async coolify_lifecycle(args) {
    const kind = enumValue(args.kind, lifecycleKinds, "kind");
    const action = enumValue(args.action, lifecycleActions, "action");
    const uuid = requiredString(args.uuid, "uuid");
    const result = await coolifyFetch(`/${kind}s/${encodeURIComponent(uuid)}/${action}`);
    return toolText(result);
  },

  async coolify_deploy(args) {
    const uuid = optionalString(args.uuid, "uuid");
    const tag = optionalString(args.tag, "tag");
    if (!uuid && !tag) {
      throw new Error("Provide either uuid or tag.");
    }
    const result = await coolifyFetch("/deploy", {
      query: {
        uuid,
        tag,
        force: Boolean(args.force),
        pull_request_id: args.pullRequestId,
        docker_tag: args.dockerTag
      }
    });
    return toolText(result);
  },

  async coolify_application_logs(args) {
    const uuid = requiredString(args.uuid, "uuid");
    const lines = clampInteger(args.lines ?? 100, 1, 5000, "lines");
    const result = await coolifyFetch(`/applications/${encodeURIComponent(uuid)}/logs`, {
      query: { lines }
    });
    return toolText(result);
  },

  async coolify_envs(args) {
    const kind = enumValue(args.kind, envKinds, "kind");
    const uuid = requiredString(args.uuid, "uuid");
    const action = enumValue(args.action || "list", ["list", "create", "update", "bulk_update", "delete"], "action");
    const basePath = `/${kind}s/${encodeURIComponent(uuid)}/envs`;
    if (action === "list") {
      return toolText(await coolifyFetch(basePath), { revealSensitive: Boolean(args.revealSensitive) });
    }
    if (action === "delete") {
      const envUuid = requiredString(args.envUuid, "envUuid");
      return toolText(await coolifyFetch(`${basePath}/${encodeURIComponent(envUuid)}`, { method: "DELETE" }));
    }
    if (!args.data || typeof args.data !== "object" || Array.isArray(args.data)) {
      throw new Error("data must be an object for create, update, and bulk_update.");
    }
    if (action === "create") {
      return toolText(await coolifyFetch(basePath, { method: "POST", body: args.data }), {
        revealSensitive: Boolean(args.revealSensitive)
      });
    }
    if (action === "update") {
      return toolText(await coolifyFetch(basePath, { method: "PATCH", body: args.data }), {
        revealSensitive: Boolean(args.revealSensitive)
      });
    }
    return toolText(await coolifyFetch(`${basePath}/bulk`, { method: "PATCH", body: args.data }), {
      revealSensitive: Boolean(args.revealSensitive)
    });
  }
};

function objectSchema(properties, required = []) {
  return {
    type: "object",
    properties,
    required,
    additionalProperties: false
  };
}

function normalizeBaseUrl(value) {
  const raw = (value || "").trim().replace(/\/+$/, "");
  if (!raw) {
    throw new Error("Set COOLIFY_BASE_URL to your Coolify instance URL.");
  }
  const url = new URL(raw);
  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error("COOLIFY_BASE_URL must start with http:// or https://.");
  }
  const base = url.toString().replace(/\/+$/, "");
  const apiBase = base.endsWith("/api/v1") ? base : `${base}/api/v1`;
  const rootBase = base.endsWith("/api/v1") ? base.slice(0, -"/api/v1".length) : base;
  return { apiBase, rootBase };
}

function config({ requireToken = true } = {}) {
  const token = (process.env.COOLIFY_API_TOKEN || "").trim();
  if (requireToken && !token) {
    throw new Error("Set COOLIFY_API_TOKEN to a Coolify API token.");
  }
  return {
    ...normalizeBaseUrl(process.env.COOLIFY_BASE_URL),
    token
  };
}

function buildUrl(baseUrl, path, query = {}) {
  if (!path.startsWith("/")) {
    throw new Error("API paths must start with /.");
  }
  if (/^https?:\/\//i.test(path)) {
    throw new Error("Use a relative Coolify API path, not a full URL.");
  }
  const url = new URL(`${baseUrl}${path}`);
  for (const [key, value] of Object.entries(query || {})) {
    if (value === undefined || value === null || value === "") {
      continue;
    }
    if (Array.isArray(value)) {
      url.searchParams.set(key, value.join(","));
    } else {
      url.searchParams.set(key, String(value));
    }
  }
  return url;
}

function pathWithId(template, id) {
  return template.replace("{uuid}", encodeURIComponent(id)).replace("{id}", encodeURIComponent(id));
}

async function coolifyFetch(path, { method = "GET", query, body, requireToken = true, apiBase } = {}) {
  const cfg = config({ requireToken });
  const url = buildUrl(apiBase || cfg.apiBase, path, query);
  const headers = { Accept: "application/json" };
  if (cfg.token) {
    headers.Authorization = `Bearer ${cfg.token}`;
  }
  if (body !== undefined && body !== null && method !== "GET") {
    headers["Content-Type"] = "application/json";
  }
  const response = await fetch(url, {
    method,
    headers,
    body: body !== undefined && body !== null && method !== "GET" ? JSON.stringify(body) : undefined
  });
  const text = await response.text();
  let data = text;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }
  if (!response.ok) {
    const message = typeof data === "object" && data && "message" in data ? data.message : response.statusText;
    const error = new Error(`Coolify API returned ${response.status}: ${message}`);
    error.status = response.status;
    error.data = data;
    throw error;
  }
  return { status: response.status, data };
}

function summarizeOperation(path, method, operation) {
  return {
    method: method.toUpperCase(),
    path,
    summary: operation.summary,
    description: operation.description,
    tags: operation.tags || [],
    parameters: operation.parameters || [],
    requestBody: operation.requestBody || undefined
  };
}

function looksSensitive(key) {
  return /token|secret|password|passwd|private|credential|authorization|api[_-]?key|real_value|value/i.test(key);
}

function redact(value, { revealSensitive = false } = {}) {
  if (revealSensitive) {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => redact(item, { revealSensitive }));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        looksSensitive(key) ? "[redacted]" : redact(item, { revealSensitive })
      ])
    );
  }
  return value;
}

function toolText(payload, options = {}) {
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(redact(payload, options), null, 2)
      }
    ]
  };
}

function requiredString(value, name) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${name} must be a non-empty string.`);
  }
  return value;
}

function optionalString(value, name) {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }
  if (typeof value !== "string") {
    throw new Error(`${name} must be a string.`);
  }
  return value;
}

function enumValue(value, allowed, name) {
  if (!allowed.includes(value)) {
    throw new Error(`${name} must be one of: ${allowed.join(", ")}.`);
  }
  return value;
}

function clampInteger(value, min, max, name) {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${name} must be an integer from ${min} to ${max}.`);
  }
  return value;
}

function writeMessage(message) {
  const payload = JSON.stringify(message);
  const byteLength = Buffer.byteLength(payload, "utf8");
  process.stdout.write(`Content-Length: ${byteLength}\r\n\r\n${payload}`);
}

function result(id, value) {
  writeMessage({ jsonrpc: "2.0", id, result: value });
}

function errorResponse(id, code, message, data) {
  const error = { code, message };
  if (data !== undefined) {
    error.data = redact(data);
  }
  writeMessage({ jsonrpc: "2.0", id, error });
}

async function handleMessage(message) {
  if (!message || typeof message !== "object") {
    return;
  }
  const { id, method, params = {} } = message;
  try {
    if (method === "initialize") {
      result(id, {
        protocolVersion: params.protocolVersion || "2025-06-18",
        capabilities: {
          tools: {}
        },
        serverInfo: {
          name: "coolify-api",
          version: "0.1.0"
        }
      });
      return;
    }
    if (method === "notifications/initialized") {
      return;
    }
    if (method === "tools/list") {
      result(id, {
        tools: tools.map(({ name, title, description, inputSchema }) => ({ name, title, description, inputSchema }))
      });
      return;
    }
    if (method === "tools/call") {
      const name = params.name;
      const args = params.arguments || {};
      const handler = handlers[name];
      if (!handler) {
        throw new RpcError(-32602, `Unknown tool: ${name}`);
      }
      result(id, await handler(args));
      return;
    }
    if (id !== undefined) {
      throw new RpcError(-32601, `Unsupported method: ${method}`);
    }
  } catch (err) {
    const code = err instanceof RpcError ? err.code : -32000;
    errorResponse(id, code, err.message || "Unexpected error.", err.data);
  }
}

class RpcError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

let buffer = Buffer.alloc(0);

process.stdin.on("data", (chunk) => {
  buffer = Buffer.concat([buffer, chunk]);
  while (true) {
    const headerEnd = buffer.indexOf("\r\n\r\n");
    if (headerEnd === -1) {
      return;
    }
    const header = buffer.slice(0, headerEnd).toString("utf8");
    const match = /Content-Length:\s*(\d+)/i.exec(header);
    if (!match) {
      buffer = buffer.slice(headerEnd + 4);
      continue;
    }
    const length = Number(match[1]);
    const messageStart = headerEnd + 4;
    const messageEnd = messageStart + length;
    if (buffer.length < messageEnd) {
      return;
    }
    const payload = buffer.slice(messageStart, messageEnd).toString("utf8");
    buffer = buffer.slice(messageEnd);
    Promise.resolve()
      .then(() => handleMessage(JSON.parse(payload)))
      .catch((error) => {
        console.error("Coolify MCP server error:", error);
      });
  }
});

process.stdin.resume();
