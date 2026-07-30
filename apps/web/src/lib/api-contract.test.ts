// Cross-language contract check: the Rust service generates
// content/generated/api-contract-v1.json from its authoritative DTOs, and this
// test parses that fixture with the frontend's Zod schemas. Drift on either
// side fails CI.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  bootstrapSchema,
  errorEnvelopeSchema,
  evaluationResultSchema,
  healthSchema,
} from "./api-contract";

const fixturePath = resolve(__dirname, "../../../../content/generated/api-contract-v1.json");
const fixture = JSON.parse(readFileSync(fixturePath, "utf8")) as Record<string, unknown>;

describe("generated Rust API contract", () => {
  it("matches the health schema", () => {
    expect(healthSchema.safeParse(fixture.health).success).toBe(true);
  });

  it("matches the bootstrap schema, including the content identity", () => {
    const parsed = bootstrapSchema.safeParse(fixture.bootstrap);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.content.releaseId).toBe("REL-OWNERSHIP-SLICE-001");
      expect(parsed.data.content.graphReleaseId).toBe("KF-v0");
    }
  });

  it("matches the error envelope schema", () => {
    expect(errorEnvelopeSchema.safeParse(fixture.error).success).toBe(true);
  });

  it("matches the evaluation result schema", () => {
    const parsed = evaluationResultSchema.safeParse(fixture.evaluation);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.replay.action).toBe("test");
    }
  });

  it("rejects a forged status outside the published enum", () => {
    const forged = { ...(fixture.evaluation as Record<string, unknown>), status: "TOTALLY_FINE" };
    expect(evaluationResultSchema.safeParse(forged).success).toBe(false);
  });
});
