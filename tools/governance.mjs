#!/usr/bin/env node

import { createHash } from "node:crypto";
import { access, readFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const read = (path) => readFile(resolve(root, path), "utf8");
const json = async (path) => JSON.parse(await read(path));
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const requiredGlossary = [
  "concept",
  "outcome",
  "item",
  "attempt",
  "event",
  "evidence",
  "mastery",
  "review",
  "transfer",
];
const hashPattern = /^[a-f0-9]{64}$/;

async function validate() {
  const errors = [];
  const check = (condition, message) => {
    if (!condition) errors.push(message);
  };

  const adrIndex = await read("docs/adr/README.md");
  for (let number = 1; number <= 19; number += 1) {
    const id = `ADR-${String(number).padStart(3, "0")}`;
    check(adrIndex.includes(id), `ADR index missing ${id}`);
    const link = adrIndex.match(new RegExp(`\\[${id}\\]\\(([^)]+)\\)`))?.[1];
    check(Boolean(link), `ADR index has no link for ${id}`);
    if (link)
      try {
        await access(resolve(root, "docs/adr", link));
      } catch {
        errors.push(`ADR index link is broken: ${link}`);
      }
  }

  const glossary = await read("docs/glossary.md");
  for (const term of requiredGlossary)
    check(
      (glossary.match(new RegExp(`^\\| ${term} \\|`, "gm")) ?? []).length === 1,
      `glossary must define ${term} exactly once`,
    );

  const profile = await json("content/governance/learner-profile.v1.json");
  check(
    profile.schemaVersion === 1 && /^LEARNER-/.test(profile.profileId),
    "invalid learner profile identity/version",
  );
  check(
    profile.privacy?.containsSecrets === false &&
      profile.privacy?.containsEmployerConfidentialData === false,
    "learner profile privacy declaration failed",
  );
  check(
    profile.weeklyCapacityHours.minimum <= profile.weeklyCapacityHours.target &&
      profile.weeklyCapacityHours.target <= profile.weeklyCapacityHours.maximum,
    "learner capacity bounds are unordered",
  );

  const goals = await json("content/governance/goals.v1.json");
  const ranks = goals.goals.map((goal) => goal.rank);
  check(new Set(ranks).size === ranks.length, "goal ranks must be unique");
  for (const goal of goals.goals)
    check(
      goal.observable && goal.outcomeIds?.length && goal.projectIds?.length,
      `${goal.id}: goal is not observable or linked`,
    );

  const ledger = await json("content/governance/source-ledger.v1.json");
  check(
    ledger.schemaVersion === 1 && ledger.feedRelease === "KF-v0",
    "source ledger release/version mismatch",
  );
  check(
    sha256(JSON.stringify(ledger.sources)) === ledger.sourceSetChecksum,
    "source ledger checksum mismatch",
  );
  check(
    new Set(ledger.sources.map((source) => source.id)).size === ledger.sources.length,
    "source IDs are not unique",
  );
  check(
    ledger.sources.some((source) => source.kind === "local_document") &&
      ledger.sources.some((source) => source.kind === "web_reference"),
    "source ledger lacks local or web records",
  );
  for (const source of ledger.sources) {
    check(source.role && source.snapshotVersion, `${source.id}: missing role or snapshot version`);
    check(
      hashPattern.test(source.snapshotHash) && hashPattern.test(source.wrapperHash),
      `${source.id}: invalid source hash`,
    );
    check(
      ["code", "prose", "tests", "assets"].every((field) => source.license?.[field]),
      `${source.id}: incomplete per-file-class license`,
    );
    if (source.kind === "web_reference")
      try {
        new URL(source.origin);
      } catch {
        errors.push(`${source.id}: malformed URL`);
      }
  }

  const licenseChecklist = await read("docs/contributing/content-license-checklist.md");
  for (const decision of ["Original", "Permissive", "Link-only", "Prohibited"])
    check(licenseChecklist.includes(`**${decision}:**`), `license checklist missing ${decision}`);
  const problemTemplate = await read("docs/contributing/problem-template.md");
  for (const field of [
    "origin:",
    "code_license:",
    "prose_license:",
    "test_license:",
    "asset_license:",
    "originality_review:",
  ])
    check(problemTemplate.includes(field), `problem template missing ${field}`);

  const freshness = await read("docs/governance/source-freshness.md");
  for (const phrase of ["Owner:", "Trigger:", "stale_pending_review"])
    check(freshness.includes(phrase), `freshness policy missing ${phrase}`);
  const changeLog = await read("docs/governance/curriculum-change-log.md");
  for (const phrase of ["Evidence:", "Affected IDs:", "Migration:", "Reviewer:", "Release:"])
    check(changeLog.includes(phrase), `change log missing ${phrase}`);

  const issue = await read(".github/ISSUE_TEMPLATE/work-item.yml");
  for (const label of [
    "foundation",
    "MVP",
    "beta",
    "platform-v1",
    "core-course",
    "parity-catalog",
    "later",
  ])
    check(issue.includes(`- ${label}`), `work-item template missing ${label}`);
  check(
    issue.includes("Required gate") && issue.includes("will not call this released"),
    "work-item template does not gate release claims",
  );

  const risks = await json("content/governance/risks.v1.json");
  check(risks.risks.length === 25, "risk register must contain R01-R25");
  for (let number = 1; number <= 25; number += 1) {
    const id = `R${String(number).padStart(2, "0")}`;
    const risk = risks.risks.find((entry) => entry.id === id);
    check(
      risk?.likelihood && risk.impact && risk.trigger && risk.mitigation,
      `${id}: incomplete risk`,
    );
  }

  const feedback = await read(".github/ISSUE_TEMPLATE/learner-feedback.yml");
  for (const field of [
    "Delayed or changed-context transfer evidence",
    "Product/content friction",
    "Optional reaction or feature request",
  ])
    check(feedback.includes(field), `feedback template missing ${field}`);

  if (errors.length) throw new Error(`Governance validation failed:\n- ${errors.join("\n- ")}`);
  console.log(
    `Validated E00 governance: 19 ADRs, ${requiredGlossary.length} glossary terms, ${goals.goals.length} goals, ${ledger.sources.length} sources, ${risks.risks.length} risks, and 2 gated issue templates.`,
  );
}

const command = process.argv[2] ?? "validate";
if (command !== "validate") throw new Error(`Unknown command: ${command}`);
await validate();
