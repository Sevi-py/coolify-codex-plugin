import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_COOLIFY_BASE_URL,
  normalizeBaseUrl
} from "../src/credentials.js";

test("normalizes Coolify Cloud and self-hosted URLs", () => {
  assert.deepEqual(normalizeBaseUrl(), {
    apiBase: `${DEFAULT_COOLIFY_BASE_URL}/api/v1`,
    rootBase: DEFAULT_COOLIFY_BASE_URL
  });
  assert.deepEqual(normalizeBaseUrl("https://coolify.example.com///"), {
    apiBase: "https://coolify.example.com/api/v1",
    rootBase: "https://coolify.example.com"
  });
  assert.deepEqual(normalizeBaseUrl("https://coolify.example.com/api/v1"), {
    apiBase: "https://coolify.example.com/api/v1",
    rootBase: "https://coolify.example.com"
  });
});

test("rejects non-HTTP Coolify URLs", () => {
  assert.throws(
    () => normalizeBaseUrl("ftp://coolify.example.com"),
    /must start with http:\/\/ or https:\/\//
  );
});
