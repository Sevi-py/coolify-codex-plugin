import { execFileSync } from "node:child_process";
import { chmodSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";

export const DEFAULT_COOLIFY_BASE_URL = "https://app.coolify.io";

const KEYCHAIN_SERVICE = "coolify-codex-plugin";
const KEYCHAIN_ACCOUNT = "default";

export function normalizeBaseUrl(value) {
  const raw = (value || DEFAULT_COOLIFY_BASE_URL).trim().replace(/\/+$/, "");
  if (!raw) {
    throw new Error("A Coolify base URL is required.");
  }
  const url = new URL(raw);
  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error("The Coolify base URL must start with http:// or https://.");
  }
  const base = url.toString().replace(/\/+$/, "");
  const apiBase = base.endsWith("/api/v1") ? base : `${base}/api/v1`;
  const rootBase = base.endsWith("/api/v1") ? base.slice(0, -"/api/v1".length) : base;
  return { apiBase, rootBase };
}

export function credentialPaths() {
  const codexHome = process.env.CODEX_HOME || resolve(homedir(), ".codex");
  const configDir = resolve(codexHome, "coolify");
  return {
    codexHome,
    configDir,
    configPath: resolve(configDir, "config.json")
  };
}

export function loadCredentials({ requireToken = true } = {}) {
  const stored = readConfigFile();
  const baseUrl = stored.baseUrl || process.env.COOLIFY_BASE_URL || DEFAULT_COOLIFY_BASE_URL;
  const cfg = normalizeBaseUrl(baseUrl);
  const tokenInfo = resolveToken(stored);

  if (requireToken && !tokenInfo.token) {
    throw new Error("Coolify is not connected. Run coolify_configure with a scoped API token, or run npm run setup -- --save.");
  }

  return {
    ...cfg,
    token: tokenInfo.token,
    tokenSource: tokenInfo.source,
    configPath: credentialPaths().configPath
  };
}

export function saveCredentials({ baseUrl, apiToken } = {}) {
  const current = readConfigFile();
  const cfg = normalizeBaseUrl(baseUrl || current.baseUrl || process.env.COOLIFY_BASE_URL || DEFAULT_COOLIFY_BASE_URL);
  const next = {
    version: 1,
    baseUrl: cfg.rootBase
  };

  const cleanToken = typeof apiToken === "string" ? apiToken.trim() : "";
  if (cleanToken) {
    if (saveKeychainToken(cleanToken)) {
      next.tokenStore = "keychain";
    } else {
      next.tokenStore = "file";
      next.apiToken = cleanToken;
    }
  } else if (current.tokenStore === "keychain") {
    next.tokenStore = "keychain";
  } else if (current.apiToken) {
    next.tokenStore = "file";
    next.apiToken = current.apiToken;
  }

  writeConfigFile(next);
  return credentialStatus();
}

export function credentialStatus() {
  const cfg = loadCredentials({ requireToken: false });
  const stored = readConfigFile();
  return {
    configured: Boolean(cfg.token),
    baseUrl: cfg.rootBase,
    apiBaseUrl: cfg.apiBase,
    tokenSource: cfg.tokenSource || null,
    storage: stored.tokenStore || null,
    configPath: cfg.configPath,
    tokenUrl: `${cfg.rootBase}/security/api-tokens`,
    apiSettingsUrl: `${cfg.rootBase}/settings/advanced`,
    envFallbackPresent: Boolean(process.env.COOLIFY_API_TOKEN)
  };
}

export function clearStoredCredentials() {
  const stored = readConfigFile();
  if (stored.tokenStore === "keychain") {
    deleteKeychainToken();
  }
  const { configPath } = credentialPaths();
  try {
    rmSync(configPath, { force: true });
  } catch {
    // Nothing to clear.
  }
  return credentialStatus();
}

function readConfigFile() {
  const { configPath } = credentialPaths();
  try {
    return JSON.parse(readFileSync(configPath, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") {
      return {};
    }
    throw new Error(`Could not read Coolify connection settings: ${error.message}`);
  }
}

function writeConfigFile(value) {
  const { configDir, configPath } = credentialPaths();
  mkdirSync(configDir, { recursive: true, mode: 0o700 });
  chmodSync(configDir, 0o700);
  writeFileSync(configPath, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  chmodSync(configPath, 0o600);
}

function resolveToken(stored) {
  if (stored.tokenStore === "keychain") {
    const token = readKeychainToken();
    if (token) {
      return { token, source: "keychain" };
    }
  }
  if (typeof stored.apiToken === "string" && stored.apiToken.trim()) {
    return { token: stored.apiToken.trim(), source: "file" };
  }
  if (process.env.COOLIFY_API_TOKEN && process.env.COOLIFY_API_TOKEN.trim()) {
    return { token: process.env.COOLIFY_API_TOKEN.trim(), source: "environment" };
  }
  return { token: "", source: null };
}

function saveKeychainToken(token) {
  if (process.platform !== "darwin") {
    return false;
  }
  try {
    deleteKeychainToken();
    execFileSync("security", [
      "add-generic-password",
      "-U",
      "-s",
      KEYCHAIN_SERVICE,
      "-a",
      KEYCHAIN_ACCOUNT,
      "-w",
      token
    ], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function readKeychainToken() {
  if (process.platform !== "darwin") {
    return "";
  }
  try {
    return execFileSync("security", [
      "find-generic-password",
      "-w",
      "-s",
      KEYCHAIN_SERVICE,
      "-a",
      KEYCHAIN_ACCOUNT
    ], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"]
    }).trim();
  } catch {
    return "";
  }
}

function deleteKeychainToken() {
  if (process.platform !== "darwin") {
    return;
  }
  try {
    execFileSync("security", [
      "delete-generic-password",
      "-s",
      KEYCHAIN_SERVICE,
      "-a",
      KEYCHAIN_ACCOUNT
    ], { stdio: "ignore" });
  } catch {
    // The keychain item may not exist yet.
  }
}
