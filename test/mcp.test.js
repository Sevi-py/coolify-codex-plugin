import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { DEFAULT_COOLIFY_BASE_URL } from "../src/credentials.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

test("MCP server initializes, lists tools, and reports connection status", async (context) => {
  const codexHome = await mkdtemp(resolve(tmpdir(), "coolify-codex-test-"));
  context.after(() => rm(codexHome, { recursive: true, force: true }));

  const env = { ...process.env, CODEX_HOME: codexHome };
  delete env.COOLIFY_API_TOKEN;
  delete env.COOLIFY_BASE_URL;

  const server = spawn("./scripts/coolify-mcp", [], {
    cwd: root,
    env,
    stdio: ["pipe", "pipe", "pipe"]
  });
  context.after(() => server.kill());

  const responses = await exchange(server, [
    {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "1" } }
    },
    { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} },
    {
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: { name: "coolify_config_status", arguments: {} }
    }
  ]);

  assert.equal(responses.get(1)?.result?.serverInfo?.name, "coolify");
  assert.equal(responses.get(1)?.result?.serverInfo?.version, "0.1.1");

  const toolNames = responses.get(2)?.result?.tools?.map((tool) => tool.name) || [];
  for (const name of [
    "coolify_configure",
    "coolify_config_status",
    "coolify_health",
    "coolify_deploy",
    "coolify_envs",
    "coolify_request"
  ]) {
    assert.ok(toolNames.includes(name), `missing MCP tool ${name}`);
  }

  const statusText = responses.get(3)?.result?.content?.[0]?.text;
  const status = JSON.parse(statusText);
  assert.equal(status.configured, false);
  assert.equal(status.baseUrl, DEFAULT_COOLIFY_BASE_URL);
  assert.equal(status.envFallbackPresent, false);
});

function exchange(server, messages) {
  return new Promise((resolveResponses, rejectResponses) => {
    const expectedIds = new Set(messages.map((message) => message.id));
    const responses = new Map();
    let stdout = "";
    let stderr = "";

    const timeout = setTimeout(() => {
      rejectResponses(new Error(`Timed out waiting for MCP responses. stderr: ${stderr}`));
    }, 5000);

    function finish(error) {
      clearTimeout(timeout);
      server.stdout.removeAllListeners();
      server.stderr.removeAllListeners();
      server.removeAllListeners();
      if (error) {
        rejectResponses(error);
      } else {
        resolveResponses(responses);
      }
    }

    server.stderr.setEncoding("utf8");
    server.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    server.on("error", finish);
    server.on("exit", (code, signal) => {
      if (responses.size < expectedIds.size) {
        finish(new Error(`MCP server exited early (${code ?? signal}). stderr: ${stderr}`));
      }
    });

    server.stdout.setEncoding("utf8");
    server.stdout.on("data", (chunk) => {
      stdout += chunk;
      while (stdout.includes("\n")) {
        const newline = stdout.indexOf("\n");
        const line = stdout.slice(0, newline).trim();
        stdout = stdout.slice(newline + 1);
        if (!line) {
          continue;
        }
        const message = JSON.parse(line);
        if (expectedIds.has(message.id)) {
          responses.set(message.id, message);
        }
      }
      if (responses.size === expectedIds.size) {
        finish();
      }
    });

    for (const message of messages) {
      server.stdin.write(`${JSON.stringify(message)}\n`);
    }
  });
}
