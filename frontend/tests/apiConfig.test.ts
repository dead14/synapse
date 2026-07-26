import assert from "node:assert/strict";
import test from "node:test";

import { resolveApiBase } from "../src/utils/apiConfig.ts";

test("production ignores a localhost API override and uses the same origin", () => {
  assert.equal(resolveApiBase("http://localhost:8000", false), "");
  assert.equal(resolveApiBase("http://127.0.0.1:8000", false), "");
});

test("development keeps an explicit localhost API override", () => {
  assert.equal(
    resolveApiBase("http://localhost:8000", true),
    "http://localhost:8000",
  );
});

test("production keeps an explicit non-local API origin", () => {
  assert.equal(
    resolveApiBase("https://api.example.com/", false),
    "https://api.example.com",
  );
});
