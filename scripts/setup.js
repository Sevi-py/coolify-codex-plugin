#!/usr/bin/env node
import { spawn } from "node:child_process";

const args = new Set(process.argv.slice(2));
const positional = process.argv.slice(2).filter((arg) => !arg.startsWith("--"));
const DEFAULT_COOLIFY_BASE_URL = "https://app.coolify.io";

function usage() {
  console.log(`Coolify Codex Plugin setup

Usage:
  npm run setup
  npm run setup -- --no-open
  npm run setup -- https://coolify.example.com

This helper opens the Coolify API token page and prints the environment
variables this plugin needs. Coolify does not currently document a browser
OAuth flow for API clients, so the token still has to be created in Coolify.
Without a URL argument, setup uses Coolify Cloud (${DEFAULT_COOLIFY_BASE_URL}).`);
}

function normalizeBaseUrl(value) {
  const raw = (value || "").trim().replace(/\/+$/, "");
  if (!raw) {
    throw new Error("A Coolify base URL is required.");
  }
  const url = new URL(raw);
  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error("The Coolify base URL must start with http:// or https://.");
  }
  const base = url.toString().replace(/\/+$/, "");
  return base.endsWith("/api/v1") ? base.slice(0, -"/api/v1".length) : base;
}

function browserCommand(url) {
  if (process.platform === "darwin") {
    return { command: "open", args: [url] };
  }
  if (process.platform === "win32") {
    return { command: "cmd", args: ["/c", "start", "", url] };
  }
  return { command: "xdg-open", args: [url] };
}

function openBrowser(url) {
  const { command, args: commandArgs } = browserCommand(url);
  const child = spawn(command, commandArgs, {
    detached: true,
    stdio: "ignore"
  });
  child.unref();
}

if (args.has("--help") || args.has("-h")) {
  usage();
  process.exit(0);
}

const rawBaseUrl = positional[0] || process.env.COOLIFY_BASE_URL || DEFAULT_COOLIFY_BASE_URL;
const baseUrl = normalizeBaseUrl(rawBaseUrl);
const tokenUrl = `${baseUrl}/security/api-tokens`;
const apiSettingsUrl = `${baseUrl}/settings/advanced`;

console.log("\nCoolify setup URLs:");
console.log(`  API token page: ${tokenUrl}`);
console.log(`  API settings:   ${apiSettingsUrl}`);

if (!args.has("--no-open")) {
  openBrowser(tokenUrl);
  console.log("\nOpened the API token page in your browser.");
}

console.log(`
After creating a scoped token, set these where Codex starts MCP servers:

  export COOLIFY_BASE_URL="${baseUrl}"
  export COOLIFY_API_TOKEN="<token from Coolify>"

Use the least-privileged token that can perform the work you want Codex to do.
`);
