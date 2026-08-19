import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  buildAttemptPayload,
  canAcceptPractice,
  canRecordAttempt,
  editableWorkspacePayload,
  PracticeExplanation,
  resolveAttemptConceptId,
  WorkspaceFileButtons,
} from "./PracticePages";

const attempt = {
  exerciseId: "mainmatter-01-intro-00-welcome",
  plan: "Follow the failing assertion.",
  confidence: 3,
  support: "compiler" as const,
  reflection: "The repaired function satisfies the pinned contract.",
  hintLevel: 0,
  accessibilityBypass: false,
};

describe("practice evidence concept mapping", () => {
  it("uses the reviewed v2 canonical concept even when a legacy outcome says borrowing", () => {
    const conceptId = resolveAttemptConceptId(
      { concepts: ["CON-RUST-STATIC-CHECK-001"] },
      "CON-BORROW-001",
    );
    const payload = buildAttemptPayload({
      ...attempt,
      conceptId,
      evaluatorRunId: "RUN-ACCEPTED-001",
    });

    expect(payload.conceptId).toBe("CON-RUST-STATIC-CHECK-001");
    expect(JSON.stringify(payload)).not.toContain("CON-BORROW-001");
  });

  it("fails closed for an unmapped v2 item instead of borrowing a legacy concept", () => {
    const conceptId = resolveAttemptConceptId({ concepts: [] }, "CON-BORROW-001");
    const readiness = {
      reflection: attempt.reflection,
      evaluatorRunId: "RUN-ACCEPTED-001",
      conceptId,
    };

    expect(conceptId).toBeUndefined();
    expect(canRecordAttempt(readiness)).toBe(false);
    expect(() => buildAttemptPayload({ ...attempt, ...readiness })).toThrow(
      "no reviewed canonical concept mapping",
    );
    expect(JSON.stringify({ ...attempt, ...readiness })).not.toContain("CON-BORROW-001");
  });

  it("keeps submission disabled until reflection, a test run, and a mapping all exist", () => {
    expect(
      canRecordAttempt({
        reflection: "",
        evaluatorRunId: "RUN-ACCEPTED-001",
        conceptId: "CON-RUST-STATIC-CHECK-001",
      }),
    ).toBe(false);
    expect(
      canRecordAttempt({
        reflection: attempt.reflection,
        conceptId: "CON-RUST-STATIC-CHECK-001",
      }),
    ).toBe(false);
    expect(
      canRecordAttempt({
        reflection: attempt.reflection,
        evaluatorRunId: "RUN-ACCEPTED-001",
        conceptId: "CON-RUST-STATIC-CHECK-001",
      }),
    ).toBe(true);
  });
});

describe("Mainmatter multi-file pilot", () => {
  it("renders structured reveal explanations as readable sections", () => {
    const html = renderToStaticMarkup(
      <PracticeExplanation
        explanation={{
          purpose: "Practice the edit-compile-test loop.",
          compilerImplications: "The compiler checks the return type.",
          followUps: ["Try the next exercise."],
        }}
      />,
    );

    expect(html).toContain("Why this exercise matters");
    expect(html).toContain("What the compiler checks");
    expect(html).toContain("Try the next exercise.");
    expect(html).not.toContain("{&quot;purpose&quot;");
  });

  it("submits only curriculum-declared editable files", () => {
    expect(
      editableWorkspacePayload([
        { path: "src/lib.rs", content: "pub fn changed() {}", editable: true },
        { path: "src/data.rs", content: "server-owned support", editable: false },
        { path: "tests/check.rs", content: "visible test", editable: false },
        { path: "Cargo.toml", content: "[package]", editable: true },
      ]),
    ).toEqual({ "src/lib.rs": "pub fn changed() {}", "Cargo.toml": "[package]" });
  });

  it("requires a successful test plus committed learning context before acceptance", () => {
    const ready = {
      plan: "Change the narrowest declared file.",
      reflection: "The behavior now satisfies the reviewed suite.",
      confidence: 3,
      evaluatorRunId: "RUN-PILOT-001",
      accepted: true,
    };
    expect(canAcceptPractice(ready)).toBe(true);
    expect(canAcceptPractice({ ...ready, plan: "" })).toBe(false);
    expect(canAcceptPractice({ ...ready, accepted: false })).toBe(false);
    expect(canAcceptPractice({ ...ready, evaluatorRunId: undefined })).toBe(false);
  });

  it("uses native keyboard-focusable buttons and labels locked files without a partial tab ARIA pattern", () => {
    const html = renderToStaticMarkup(
      <WorkspaceFileButtons
        files={[
          { path: "src/lib.rs", content: "", editable: true },
          { path: "tests/check.rs", content: "", editable: false },
        ]}
        activePath="src/lib.rs"
        onSelect={() => undefined}
      />,
    );
    // A fieldset/legend groups the files with native semantics; the accessible
    // name must survive, and no roving-tabindex tab pattern may appear.
    expect(html).toContain("<fieldset");
    expect(html).toContain("Workspace files");
    expect(html).toContain('<button type="button" aria-pressed="true"');
    expect(html).toContain('<button type="button" aria-pressed="false"');
    expect(html).toContain("read only");
    expect(html).not.toContain('role="tab"');
  });
});
