#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const HIGH_SEVERITIES = new Set(["high", "critical"]);

// Temporary, narrowly-scoped exception. GitHub's reviewed advisory says this
// affects only unstable React Server Components APIs. Synapse is a client-side
// BrowserRouter application and does not use those APIs. The exception expires
// quickly so a published patched release must replace it.
export const ALLOWLIST = new Map([
  [
    "GHSA-QWWW-VCR4-C8H2",
    {
      packages: new Set(["react-router", "react-router-dom"]),
      severity: "high",
      expires: "2026-08-09",
      reason: "Unstable RSC APIs are not used by the Synapse SPA.",
    },
  ],
]);

function advisoryIdFromUrl(url) {
  const match = String(url ?? "").match(/GHSA-[a-z0-9-]+/i);
  return match?.[0]?.toUpperCase() ?? null;
}

function collectAdvisoryIds(packageName, vulnerabilities, seen = new Set()) {
  if (seen.has(packageName)) {
    return new Set();
  }
  seen.add(packageName);

  const ids = new Set();
  const vulnerability = vulnerabilities[packageName];
  for (const via of vulnerability?.via ?? []) {
    if (typeof via === "string") {
      for (const id of collectAdvisoryIds(via, vulnerabilities, seen)) {
        ids.add(id);
      }
      continue;
    }

    const id = advisoryIdFromUrl(via?.url);
    if (id) {
      ids.add(id);
    }
  }
  return ids;
}

function isExpired(expires, now) {
  const deadline = new Date(`${expires}T23:59:59.999Z`);
  return Number.isNaN(deadline.getTime()) || now > deadline;
}

export function assessAudit(report, now = new Date()) {
  const vulnerabilities = report?.vulnerabilities ?? {};
  const blocked = [];
  const allowed = [];

  for (const [packageName, vulnerability] of Object.entries(vulnerabilities)) {
    if (!HIGH_SEVERITIES.has(vulnerability?.severity)) {
      continue;
    }

    const advisoryIds = [...collectAdvisoryIds(packageName, vulnerabilities)];
    const reasons = [];

    if (advisoryIds.length === 0) {
      reasons.push("no advisory identifier could be resolved");
    }

    for (const advisoryId of advisoryIds) {
      const rule = ALLOWLIST.get(advisoryId);
      if (!rule) {
        reasons.push(`${advisoryId} is not allowlisted`);
        continue;
      }
      if (!rule.packages.has(packageName)) {
        reasons.push(`${advisoryId} is not allowlisted for ${packageName}`);
      }
      if (rule.severity !== vulnerability.severity) {
        reasons.push(
          `${advisoryId} severity changed from ${rule.severity} to ${vulnerability.severity}`,
        );
      }
      if (isExpired(rule.expires, now)) {
        reasons.push(`${advisoryId} exception expired on ${rule.expires}`);
      }
    }

    const finding = {
      packageName,
      severity: vulnerability.severity,
      advisoryIds,
      reasons,
    };
    if (reasons.length > 0) {
      blocked.push(finding);
    } else {
      allowed.push(finding);
    }
  }

  return { allowed, blocked };
}

function runAudit(directory) {
  const auditArgs = [
    "audit",
    "--package-lock-only",
    "--omit=dev",
    "--json",
  ];
  const executable =
    process.platform === "win32" ? (process.env.ComSpec ?? "cmd.exe") : "npm";
  const args =
    process.platform === "win32"
      ? ["/d", "/s", "/c", `npm ${auditArgs.join(" ")}`]
      : auditArgs;
  const result = spawnSync(executable, args, {
    cwd: directory,
    encoding: "utf8",
  });

  if (result.error) {
    throw new Error(`npm audit could not start: ${result.error.code ?? "unknown"}`);
  }

  let report;
  try {
    report = JSON.parse(result.stdout);
  } catch {
    throw new Error("npm audit did not return valid JSON");
  }

  if (report?.error) {
    throw new Error(`npm audit failed: ${report.error.summary ?? "unknown error"}`);
  }
  return report;
}

function main() {
  const directory = process.argv[2] ?? ".";
  const report = runAudit(directory);
  const assessment = assessAudit(report);

  for (const finding of assessment.allowed) {
    console.warn(
      `Allowed temporary production audit exception: ${finding.packageName} ` +
        `(${finding.advisoryIds.join(", ")})`,
    );
  }

  if (assessment.blocked.length > 0) {
    for (const finding of assessment.blocked) {
      console.error(
        `Blocked ${finding.severity} vulnerability in ${finding.packageName}: ` +
          finding.reasons.join("; "),
      );
    }
    process.exitCode = 1;
    return;
  }

  console.log("Production dependency audit passed.");
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main();
}
