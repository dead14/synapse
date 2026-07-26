import assert from "node:assert/strict";
import test from "node:test";

import { assessAudit } from "./audit-npm-production.mjs";

function rscReport(severity = "high") {
  return {
    vulnerabilities: {
      "react-router": {
        severity,
        via: [
          {
            severity,
            url: "https://github.com/advisories/GHSA-qwww-vcr4-c8h2",
          },
        ],
      },
      "react-router-dom": {
        severity,
        via: ["react-router"],
      },
    },
  };
}

test("allows only the scoped RSC advisory before its expiry", () => {
  const result = assessAudit(rscReport(), new Date("2026-07-26T00:00:00Z"));

  assert.equal(result.blocked.length, 0);
  assert.deepEqual(
    result.allowed.map(({ packageName }) => packageName).sort(),
    ["react-router", "react-router-dom"],
  );
});

test("blocks the scoped advisory after its expiry", () => {
  const result = assessAudit(rscReport(), new Date("2026-08-10T00:00:00Z"));

  assert.equal(result.allowed.length, 0);
  assert.equal(result.blocked.length, 2);
  assert.ok(
    result.blocked.every(({ reasons }) =>
      reasons.some((reason) => reason.includes("expired")),
    ),
  );
});

test("blocks any other high advisory", () => {
  const report = {
    vulnerabilities: {
      example: {
        severity: "high",
        via: [
          {
            severity: "high",
            url: "https://github.com/advisories/GHSA-aaaa-bbbb-cccc",
          },
        ],
      },
    },
  };

  const result = assessAudit(report, new Date("2026-07-26T00:00:00Z"));

  assert.equal(result.allowed.length, 0);
  assert.equal(result.blocked.length, 1);
});

test("blocks a severity increase on an allowlisted advisory", () => {
  const result = assessAudit(
    rscReport("critical"),
    new Date("2026-07-26T00:00:00Z"),
  );

  assert.equal(result.allowed.length, 0);
  assert.equal(result.blocked.length, 2);
});

test("passes when production dependencies have no high findings", () => {
  const result = assessAudit(
    {
      vulnerabilities: {
        example: {
          severity: "moderate",
          via: [],
        },
      },
    },
    new Date("2026-07-26T00:00:00Z"),
  );

  assert.deepEqual(result, { allowed: [], blocked: [] });
});
