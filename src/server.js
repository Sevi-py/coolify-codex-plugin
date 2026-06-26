#!/usr/bin/env node
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import http from "node:http";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  clearStoredCredentials,
  credentialStatus,
  DEFAULT_COOLIFY_BASE_URL,
  loadCredentials,
  normalizeBaseUrl,
  saveCredentials
} from "./credentials.js";

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
    name: "coolify_setup",
    title: "Coolify Setup Helper",
    description: "Generate setup URLs and local credential guidance for connecting this plugin to a Coolify instance.",
    inputSchema: objectSchema({
      baseUrl: {
        type: "string",
        description: "Optional Coolify root or API URL. Falls back to the saved connection, then Coolify Cloud."
      }
    })
  },
  {
    name: "coolify_configure",
    title: "Configure Coolify Connection",
    description: "Start a local browser setup flow, or save a Coolify instance URL and scoped API token locally.",
    inputSchema: objectSchema({
      baseUrl: {
        type: "string",
        description: "Optional Coolify root or API URL. Defaults to Coolify Cloud unless a URL was previously saved."
      },
      apiToken: {
        type: "string",
        description: "Optional scoped Coolify API token. If omitted, the plugin opens a local browser setup page."
      },
      openBrowser: {
        type: "boolean",
        default: true,
        description: "Open the local setup page in the default browser when apiToken is omitted."
      },
      verify: {
        type: "boolean",
        default: true,
        description: "Verify the token with Coolify before saving it."
      }
    })
  },
  {
    name: "coolify_config_status",
    title: "Coolify Connection Status",
    description: "Show whether this plugin has a saved Coolify connection without revealing the token.",
    inputSchema: objectSchema({})
  },
  {
    name: "coolify_logout",
    title: "Forget Coolify Connection",
    description: "Remove the saved Coolify connection from local plugin storage.",
    inputSchema: objectSchema({})
  },
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
  async coolify_setup(args) {
    const current = loadCredentials({ requireToken: false });
    const baseUrl = optionalString(args.baseUrl, "baseUrl") || current.rootBase || DEFAULT_COOLIFY_BASE_URL;
    const cfg = normalizeBaseUrl(baseUrl);
    return toolText({
      baseUrl: cfg.rootBase,
      apiBaseUrl: cfg.apiBase,
      tokenUrl: `${cfg.rootBase}/security/api-tokens`,
      apiSettingsUrl: `${cfg.rootBase}/settings/advanced`,
      configured: Boolean(current.token),
      tokenSource: current.tokenSource || null,
      docs: {
        authorization: "https://coolify.io/docs/api-reference/authorization",
        mcp: "https://coolify.io/docs/integrations/mcp"
      },
      notes: [
        "Coolify does not currently document OAuth-style browser authorization for API clients.",
        "Create a scoped token in the browser, then call coolify_configure to save it locally.",
        "The token is stored in macOS Keychain when available, otherwise in a local config file with owner-only permissions.",
        "Use the least-privileged token that can perform the work you want Codex to do."
      ]
    }, { revealSensitive: true });
  },

  async coolify_configure(args) {
    const current = loadCredentials({ requireToken: false });
    const baseUrl = optionalString(args.baseUrl, "baseUrl") || current.rootBase || DEFAULT_COOLIFY_BASE_URL;
    const cfg = normalizeBaseUrl(baseUrl);
    const apiToken = optionalString(args.apiToken, "apiToken");

    if (!apiToken) {
      return toolText(await startBrowserSetup({ baseUrl: cfg.rootBase, openBrowser: args.openBrowser !== false }), {
        revealSensitive: true
      });
    }

    if (args.verify !== false) {
      await coolifyFetch("/version", {
        credentials: {
          ...cfg,
          token: apiToken
        }
      });
    }

    return toolText(saveCredentials({ baseUrl: cfg.rootBase, apiToken }));
  },

  async coolify_config_status() {
    return toolText(credentialStatus());
  },

  async coolify_logout() {
    return toolText(clearStoredCredentials());
  },

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

function config({ requireToken = true } = {}) {
  return loadCredentials({ requireToken });
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

async function coolifyFetch(path, { method = "GET", query, body, requireToken = true, apiBase, credentials } = {}) {
  const cfg = credentials || config({ requireToken });
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

let setupSession = null;

async function startBrowserSetup({ baseUrl, openBrowser = true }) {
  if (setupSession) {
    setupSession.close();
    setupSession = null;
  }

  const cfg = normalizeBaseUrl(baseUrl);
  const secret = randomBytes(24).toString("base64url");
  const server = http.createServer((request, response) => {
    handleSetupRequest(request, response, { cfg, secret }).catch((error) => {
      console.error(`Coolify setup failed: ${error.message}`);
      sendSetupPage(response, 500, setupPage({
        baseUrl: cfg.rootBase,
        tokenUrl: `${cfg.rootBase}/security/api-tokens`,
        secret,
        message: "We couldn't save the connection. Check the token and try again.",
        isError: true
      }));
    });
  });

  await new Promise((resolveListen, rejectListen) => {
    server.once("error", rejectListen);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", rejectListen);
      resolveListen();
    });
  });

  const { port } = server.address();
  const setupUrl = `http://127.0.0.1:${port}/?secret=${encodeURIComponent(secret)}`;
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
  const timeout = setTimeout(() => {
    server.close();
    if (setupSession?.server === server) {
      setupSession = null;
    }
  }, 10 * 60 * 1000);
  timeout.unref();

  setupSession = {
    server,
    close() {
      clearTimeout(timeout);
      server.close();
    }
  };

  if (openBrowser) {
    openUrl(setupUrl);
  }

  return {
    setupUrl,
    openedBrowser: Boolean(openBrowser),
    expiresAt,
    baseUrl: cfg.rootBase,
    tokenUrl: `${cfg.rootBase}/security/api-tokens`,
    note: "Complete setup in the browser window. The token is saved locally and is not returned to Codex."
  };
}

async function handleSetupRequest(request, response, { cfg, secret }) {
  const url = new URL(request.url || "/", `http://${request.headers.host || "127.0.0.1"}`);
  if (url.searchParams.get("secret") !== secret) {
    sendSetupPage(response, 404, setupPage({
      baseUrl: cfg.rootBase,
      tokenUrl: `${cfg.rootBase}/security/api-tokens`,
      secret,
      message: "This setup link is no longer available.",
      isError: true
    }));
    return;
  }

  if (request.method === "GET") {
    sendSetupPage(response, 200, setupPage({
      baseUrl: cfg.rootBase,
      tokenUrl: `${cfg.rootBase}/security/api-tokens`,
      secret
    }));
    return;
  }

  if (request.method !== "POST") {
    response.writeHead(405).end();
    return;
  }

  const body = await readRequestBody(request);
  const params = new URLSearchParams(body);
  const apiToken = (params.get("apiToken") || "").trim();
  if (!apiToken) {
    sendSetupPage(response, 400, setupPage({
      baseUrl: cfg.rootBase,
      tokenUrl: `${cfg.rootBase}/security/api-tokens`,
      secret,
      message: "Paste a token to continue.",
      isError: true
    }));
    return;
  }

  try {
    await coolifyFetch("/version", {
      credentials: {
        ...cfg,
        token: apiToken
      }
    });
    saveCredentials({ baseUrl: cfg.rootBase, apiToken });
    sendSetupPage(response, 200, successPage(cfg.rootBase));
    setupSession?.close();
    setupSession = null;
  } catch (error) {
    console.error(`Coolify setup verification failed: ${error.message}`);
    sendSetupPage(response, 400, setupPage({
      baseUrl: cfg.rootBase,
      tokenUrl: `${cfg.rootBase}/security/api-tokens`,
      secret,
      message: "We couldn't connect with that token. Check it and try again.",
      isError: true
    }));
  }
}

function readRequestBody(request) {
  return new Promise((resolveBody, rejectBody) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      body += chunk;
      if (body.length > 64 * 1024) {
        rejectBody(new Error("Request body is too large."));
        request.destroy();
      }
    });
    request.on("end", () => resolveBody(body));
    request.on("error", rejectBody);
  });
}

function openUrl(url) {
  let command;
  let args;
  if (process.platform === "darwin") {
    command = "open";
    args = [url];
  } else if (process.platform === "win32") {
    command = "cmd";
    args = ["/c", "start", "", url];
  } else {
    command = "xdg-open";
    args = [url];
  }
  try {
    const child = spawn(command, args, { detached: true, stdio: "ignore" });
    child.unref();
  } catch (error) {
    console.error(`Could not open setup page: ${error.message}`);
  }
}

function sendSetupPage(response, status, html) {
  response.writeHead(status, {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store",
    "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'"
  });
  response.end(html);
}

function setupPage({ baseUrl, tokenUrl, secret, message = "", isError = false }) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Connect Coolify</title>
  <style>
    :root { color-scheme: light dark; font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #f6f7f9; color: #15171a; }
    main { width: min(440px, calc(100vw - 32px)); }
    h1 { margin: 0 0 12px; font-size: 28px; line-height: 1.15; }
    p { color: #4b5563; line-height: 1.5; }
    a { color: #2563eb; }
    label { display: block; margin: 20px 0 8px; font-weight: 650; }
    input { width: 100%; box-sizing: border-box; padding: 12px 14px; border-radius: 8px; border: 1px solid #cfd5df; font: inherit; }
    button { margin-top: 16px; width: 100%; border: 0; border-radius: 8px; padding: 12px 14px; font: inherit; font-weight: 700; background: #111827; color: white; cursor: pointer; }
    .note { font-size: 14px; }
    .message { margin-top: 16px; padding: 12px; border-radius: 8px; background: ${isError ? "#fee2e2" : "#e8f5ee"}; color: ${isError ? "#7f1d1d" : "#14532d"}; }
    @media (prefers-color-scheme: dark) {
      body { background: #101214; color: #f3f4f6; }
      p { color: #bac1cc; }
      input { background: #181b20; color: #f9fafb; border-color: #3d4552; }
      button { background: #f9fafb; color: #111827; }
      a { color: #93c5fd; }
      .message { background: ${isError ? "#451a1a" : "#10351f"}; color: ${isError ? "#fecaca" : "#bbf7d0"}; }
    }
  </style>
</head>
<body>
  <main>
    <h1>Connect Coolify</h1>
    <p>Create a scoped token in Coolify, then paste it here to save this connection locally.</p>
    <p class="note"><a href="${escapeHtml(tokenUrl)}" target="_blank" rel="noreferrer">Open token page</a> for ${escapeHtml(baseUrl)}</p>
    <form method="post" action="/?secret=${encodeURIComponent(secret)}">
      <label for="apiToken">API token</label>
      <input id="apiToken" name="apiToken" type="password" autocomplete="off" autofocus required>
      <button type="submit">Save Connection</button>
    </form>
    ${message ? `<div class="message">${escapeHtml(message)}</div>` : ""}
  </main>
</body>
</html>`;
}

function successPage(baseUrl) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Coolify Connected</title>
  <style>
    :root { color-scheme: light dark; font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #f6f7f9; color: #15171a; }
    main { width: min(420px, calc(100vw - 32px)); }
    h1 { margin: 0 0 12px; font-size: 28px; line-height: 1.15; }
    p { color: #4b5563; line-height: 1.5; }
    @media (prefers-color-scheme: dark) {
      body { background: #101214; color: #f3f4f6; }
      p { color: #bac1cc; }
    }
  </style>
</head>
<body>
  <main>
    <h1>Coolify Connected</h1>
    <p>The connection for ${escapeHtml(baseUrl)} is saved. You can close this window and return to Codex.</p>
  </main>
</body>
</html>`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
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
