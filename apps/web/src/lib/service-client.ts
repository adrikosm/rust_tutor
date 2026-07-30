import {
  type Bootstrap,
  type CompletionResult,
  type EvaluationResult,
  type TutorContent,
  bootstrapSchema,
  completionResultSchema,
  errorEnvelopeSchema,
  evaluationResultSchema,
  tutorContentSchema,
} from "./api-contract";
import { z } from "zod";

export class ServiceError extends Error {
  constructor(
    message: string,
    readonly code = "service_error",
    readonly requestId?: string,
    readonly retryable = false,
  ) {
    super(message);
    this.name = "ServiceError";
  }
}

async function decodeError(response: Response): Promise<ServiceError> {
  const payload: unknown = await response.json().catch(() => null);
  const parsed = errorEnvelopeSchema.safeParse(payload);
  if (parsed.success) {
    return new ServiceError(
      parsed.data.message,
      parsed.data.code,
      parsed.data.request_id,
      parsed.data.retryable,
    );
  }
  return new ServiceError(`Local service returned ${response.status}.`, "malformed_service_error");
}

export async function getBootstrap(signal?: AbortSignal): Promise<Bootstrap> {
  let response: Response;
  try {
    response = await fetch("/api/v1/bootstrap", { signal });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    throw new ServiceError(
      "The local Rust service is unavailable. Start it, then retry.",
      "service_unavailable",
      undefined,
      true,
    );
  }
  if (!response.ok) throw await decodeError(response);
  const parsed = bootstrapSchema.safeParse(await response.json());
  if (!parsed.success) {
    throw new ServiceError(
      "The local service returned an incompatible bootstrap response.",
      "invalid_response",
    );
  }
  return parsed.data;
}

export async function getAbout() {
  const response = await fetch("/api/v1/about");
  return decode(
    response,
    z.object({
      appVersion: z.string(),
      apiVersion: z.string(),
      databaseSchemaVersion: z.number().int(),
      contentRelease: z.string(),
      contentChecksum: z.string().length(64),
      rustToolchain: z.string(),
      masteryModel: z.string(),
      placementModel: z.string(),
      examForm: z.string(),
      examVersion: z.string(),
      scheduler: z.string(),
      license: z.literal("MIT"),
      offlineRuntime: z.literal(true),
    }),
  );
}

export async function getDiagnosticsPreview() {
  const response = await authedFetch("/api/v1/diagnostics/preview");
  return decode(
    response,
    z.object({
      previewOnly: z.literal(true),
      uploaded: z.literal(false),
      appVersion: z.string(),
      apiVersion: z.string(),
      databaseStatus: z.string(),
      toolAvailability: z.record(z.string(), z.boolean()),
      contentRelease: z.string(),
      contentChecksum: z.string(),
      redacted: z.array(z.string()),
    }),
  );
}

async function decode<T>(
  response: Response,
  schema: {
    safeParse: (value: unknown) => { success: true; data: T } | { success: false };
  },
): Promise<T> {
  if (!response.ok) throw await decodeError(response);
  const parsed = schema.safeParse(await response.json());
  if (!parsed.success) {
    throw new ServiceError(
      "The local service returned an incompatible response.",
      "invalid_response",
    );
  }
  return parsed.data;
}

export async function getTutorContent(signal?: AbortSignal): Promise<TutorContent> {
  const response = await fetch("/api/v1/content/ownership", { signal });
  return decode<TutorContent>(response, tutorContentSchema);
}

let sessionToken: string | undefined;

async function getSessionToken(): Promise<string> {
  if (sessionToken) return sessionToken;
  const response = await fetch("/api/v1/session", { cache: "no-store" });
  if (!response.ok)
    throw new ServiceError("The local session could not be opened.", "session_unavailable");
  const payload: unknown = await response.json();
  if (
    typeof payload !== "object" ||
    payload === null ||
    !("token" in payload) ||
    typeof payload.token !== "string"
  ) {
    throw new ServiceError("The local session response was invalid.", "invalid_response");
  }
  sessionToken = payload.token;
  return sessionToken;
}

/**
 * Session-authenticated fetch. The service issues a fresh in-memory token on
 * every boot, so a cached token goes stale whenever the service restarts; on
 * the first 401 the token is dropped, re-fetched, and the request retried once.
 */
async function authedFetch(
  url: string,
  init: { method?: "POST"; mutation?: boolean; json?: boolean; body?: string } = {},
): Promise<Response> {
  for (let attempt = 0; ; attempt += 1) {
    const token = await getSessionToken();
    const headers: Record<string, string> = { "x-rust-tutor-session": token };
    if (init.mutation || init.method === "POST") headers["x-rust-tutor-mutation"] = "1";
    if (init.json) headers["content-type"] = "application/json";
    const response = await fetch(url, { method: init.method, headers, body: init.body });
    if (response.status !== 401 || attempt > 0) return response;
    sessionToken = undefined;
  }
}

export async function evaluateRust(input: {
  runId: string;
  exerciseId: string;
  action: "check" | "test" | "clippy" | "format_check" | "format_preview" | "run";
  source: string;
  files?: Record<string, string>;
  workspaceRevision?: number;
  contentHash: string;
  case?: { id: string; args: string[]; stdin: string; expectedStdout?: string };
}): Promise<EvaluationResult> {
  const response = await authedFetch("/api/v1/evaluate", {
    method: "POST",
    json: true,
    body: JSON.stringify({
      runId: input.runId,
      exerciseId: input.exerciseId,
      action: input.action,
      files: input.files ?? { "src/main.rs": input.source },
      workspaceRevision: input.workspaceRevision,
      contentHash: input.contentHash,
      case: input.case,
    }),
  });
  return decode<EvaluationResult>(response, evaluationResultSchema);
}

export async function evaluateRustStreaming(
  input: {
    runId: string;
    exerciseId: string;
    action: "check" | "test" | "clippy" | "format_check" | "format_preview" | "run";
    source: string;
    files?: Record<string, string>;
    workspaceRevision?: number;
    contentHash: string;
    case?: { id: string; args: string[]; stdin: string; expectedStdout?: string };
  },
  onChunk: (chunk: { channel: string; text: string }) => void,
): Promise<EvaluationResult> {
  const response = await authedFetch("/api/v1/evaluate/stream", {
    method: "POST",
    json: true,
    body: JSON.stringify({
      runId: input.runId,
      exerciseId: input.exerciseId,
      action: input.action,
      files: input.files ?? { "src/main.rs": input.source },
      workspaceRevision: input.workspaceRevision,
      contentHash: input.contentHash,
      case: input.case,
    }),
  });
  if (!response.ok) throw await decodeError(response);
  if (!response.body) throw new ServiceError("Streaming response body is unavailable.");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let finalResult: EvaluationResult | undefined;
  for (;;) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value, { stream: !done }).replaceAll("\r\n", "\n");
    const frames = buffer.split("\n\n");
    buffer = frames.pop() ?? "";
    for (const frame of frames) {
      const data = frame
        .split("\n")
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trimStart())
        .join("\n");
      if (!data) continue;
      const payload: unknown = JSON.parse(data);
      if (typeof payload !== "object" || payload === null || !("type" in payload)) continue;
      if (payload.type === "chunk" && "chunk" in payload) {
        const chunk = z.object({ channel: z.string(), text: z.string() }).parse(payload.chunk);
        onChunk(chunk);
      }
      if (payload.type === "result" && "result" in payload) {
        finalResult = evaluationResultSchema.parse(payload.result);
      }
      if (payload.type === "error" && "error" in payload) {
        const failure = z.object({ message: z.string() }).parse(payload.error);
        throw new ServiceError(failure.message, "stream_failed");
      }
    }
    if (done) break;
  }
  if (finalResult) return finalResult;
  const recovery = await authedFetch(`/api/v1/evaluate/stream/${encodeURIComponent(input.runId)}`);
  const snapshot = await decode(
    recovery,
    z.object({ result: z.unknown().nullable(), state: z.string() }),
  );
  if (snapshot.result && ["completed", "cancelled"].includes(snapshot.state)) {
    return evaluationResultSchema.parse(snapshot.result);
  }
  throw new ServiceError(
    `Evaluator stream ended in ${snapshot.state} state.`,
    "stream_interrupted",
  );
}

export async function cancelEvaluation(runId: string): Promise<void> {
  const response = await authedFetch(`/api/v1/evaluate/${encodeURIComponent(runId)}/cancel`, {
    method: "POST",
  });
  if (!response.ok) throw await decodeError(response);
}

const workbenchCompletionSchema = z.object({
  itemId: z.string(),
  itemKind: z.enum(["algorithm", "project_stage", "lesson"]),
  unlockedItemId: z.string(),
  evaluatorRunId: z.string(),
  workspaceChecksum: z.string().length(64),
  acceptedAt: z.string(),
});

export async function getWorkbenchProgress() {
  const response = await authedFetch("/api/v1/workbench/progress");
  return decode(response, z.object({ completions: z.array(workbenchCompletionSchema) }));
}

export async function acceptWorkbenchItem(itemId: string, runId: string) {
  const response = await authedFetch(`/api/v1/workbench/${encodeURIComponent(itemId)}/accept`, {
    method: "POST",
    json: true,
    body: JSON.stringify({ runId }),
  });
  return decode(response, workbenchCompletionSchema);
}

const courseChapterProgressSchema = z.object({
  chapterId: z.string(),
  clearedStops: z.array(z.string()),
  ran: z.boolean(),
  updatedAt: z.string(),
});

export type CourseChapterProgress = z.infer<typeof courseChapterProgressSchema>;

export async function getCourseProgress() {
  const response = await authedFetch("/api/v1/course/progress");
  return decode(response, z.object({ chapters: z.array(courseChapterProgressSchema) }));
}

export async function saveCourseProgress(
  chapterId: string,
  input: { clearedStops: string[]; ran: boolean },
) {
  const response = await authedFetch(`/api/v1/course/${encodeURIComponent(chapterId)}/progress`, {
    method: "POST",
    json: true,
    body: JSON.stringify(input),
  });
  return decode(response, courseChapterProgressSchema);
}

export async function completeRust(input: {
  exerciseId: string;
  source: string;
  version: number;
  line: number;
  character: number;
}): Promise<CompletionResult> {
  const response = await authedFetch("/api/v1/analyzer/complete", {
    method: "POST",
    json: true,
    body: JSON.stringify({
      exerciseId: input.exerciseId,
      source: input.source,
      version: input.version,
      position: { line: input.line, character: input.character },
    }),
  });
  return decode<CompletionResult>(response, completionResultSchema);
}

const attemptRecordSchema = z.object({
  attemptId: z.string(),
  evidenceId: z.string(),
  outcomeState: z.string(),
  whyNext: z.string(),
  projectionChecksum: z.string().length(64),
});

export async function recordAttempt(input: {
  exerciseId: string;
  conceptId: string;
  plan: string;
  confidence: number;
  support: "none" | "compiler" | "official_docs" | "hint" | "full_reveal" | "external_help";
  reflection: string;
  evaluatorRunId: string;
  hintLevel: number;
  accessibilityBypass: boolean;
}) {
  const response = await authedFetch("/api/v1/attempts/record", {
    method: "POST",
    json: true,
    body: JSON.stringify(input),
  });
  return decode(response, attemptRecordSchema);
}

const evidenceTimelineSchema = z.object({
  events: z.array(
    z.object({
      evidenceId: z.string(),
      conceptId: z.string(),
      score: z.number(),
      modelVersion: z.string(),
      createdAt: z.string(),
      itemId: z.string(),
      variantGroup: z.string(),
      kind: z.string(),
      support: z.unknown(),
      day: z.number().int().nonnegative(),
      primaryOutcome: z.boolean(),
      sourceEvent: z.string(),
    }),
  ),
});

export async function getEvidenceTimeline(conceptId?: string) {
  const query = conceptId ? `?conceptId=${encodeURIComponent(conceptId)}` : "";
  const response = await authedFetch(`/api/v1/evidence${query}`);
  return decode(response, evidenceTimelineSchema);
}

const reviewQueueSchema = z.object({
  day: z.number().int().nonnegative(),
  limit: z.number().int().positive(),
  overflow: z.number().int().nonnegative(),
  modelVersion: z.string(),
  items: z.array(
    z.object({
      conceptId: z.string(),
      dueDay: z.number().int().nonnegative(),
      intervalIndex: z.number().int().min(0).max(3),
      reason: z.string(),
      modelVersion: z.string(),
      evidenceIds: z.array(z.string()),
      estimatedMode: z.string(),
      supportPolicy: z.string(),
      suggestedExerciseId: z.string().nullable(),
    }),
  ),
});

export async function getReviewQueue() {
  const response = await authedFetch("/api/v1/review");
  return decode(response, reviewQueueSchema);
}

const reviewRatingResultSchema = z.object({
  ratingId: z.string(),
  conceptId: z.string(),
  rating: z.enum(["again", "hard", "good", "easy"]),
  day: z.number().int().nonnegative(),
  dueDay: z.number().int().nonnegative(),
  intervalIndex: z.number().int().min(0).max(3),
  reason: z.string(),
  modelVersion: z.string(),
});

export async function rateReview(conceptId: string, rating: "again" | "hard" | "good" | "easy") {
  const response = await authedFetch(`/api/v1/review/${encodeURIComponent(conceptId)}/rate`, {
    method: "POST",
    json: true,
    body: JSON.stringify({ rating }),
  });
  return decode(response, reviewRatingResultSchema);
}

const confidenceCalibrationSchema = z.object({
  minimumSamples: z.number().int().positive(),
  bands: z.array(
    z.object({
      band: z.string(),
      sampleCount: z.number().int().nonnegative(),
      accuracy: z.number().nullable(),
      confidenceMidpoint: z.number().nullable(),
      gap: z.number().nullable(),
      message: z.string(),
    }),
  ),
});

export async function getConfidenceCalibration() {
  const response = await authedFetch("/api/v1/confidence-calibration");
  return decode(response, confidenceCalibrationSchema);
}

const graphNodeSchema = z
  .object({
    id: z.string(),
    kind: z.string(),
    title: z.string(),
    summary: z.string(),
    contentVersion: z.string(),
    reviewState: z.string(),
    provenanceIds: z.array(z.string()),
  })
  .passthrough();

const graphEdgeSchema = z
  .object({
    edgeId: z.string(),
    sourceId: z.string(),
    targetId: z.string(),
    kind: z.string(),
    rationale: z.string(),
    provenanceIds: z.array(z.string()),
  })
  .passthrough();

const graphResultSchema = z.object({
  releaseId: z.string(),
  selectedId: z.string(),
  nodes: z.array(graphNodeSchema).max(200),
  edges: z.array(graphEdgeSchema),
  truncated: z.boolean(),
  legend: z.record(z.string(), z.string()),
});

export type GraphResult = z.infer<typeof graphResultSchema>;

export async function getGraph(input: {
  id: string;
  depth: number;
  kinds?: string;
}): Promise<GraphResult> {
  const query = new URLSearchParams({ id: input.id, depth: String(input.depth), limit: "80" });
  if (input.kinds) query.set("kinds", input.kinds);
  const response = await fetch(`/api/v1/graph?${query}`);
  return decode(response, graphResultSchema);
}

const graphPathSchema = z.object({
  releaseId: z.string(),
  startId: z.string(),
  goalId: z.string(),
  found: z.boolean(),
  steps: z.array(
    z.object({
      node: graphNodeSchema,
      via: graphEdgeSchema.nullable(),
      explanation: z.string(),
    }),
  ),
});

export async function getGraphPrerequisites(id: string) {
  const response = await fetch(`/api/v1/graph/prerequisites?id=${encodeURIComponent(id)}`);
  return decode(response, graphPathSchema);
}

export async function getGraphPath(start: string, goal: string) {
  const query = new URLSearchParams({ start, goal });
  const response = await fetch(`/api/v1/graph/path?${query}`);
  return decode(response, graphPathSchema);
}

export async function getGraphOverlay() {
  const response = await authedFetch("/api/v1/graph/overlay");
  return decode(
    response,
    z.object({
      releaseId: z.string(),
      learnerState: z.array(z.record(z.string(), z.unknown())),
    }),
  );
}

const toursSchema = z.object({
  releaseId: z.string(),
  tours: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      entryGate: z.string(),
      draft: z.boolean(),
      steps: z.array(
        z.object({
          nodeId: z.string(),
          what: z.string(),
          whyNow: z.string(),
          previousConnection: z.string(),
          lessonId: z.string().nullable(),
          exerciseId: z.string().nullable(),
          projectId: z.string(),
        }),
      ),
    }),
  ),
});

export async function getGraphTours() {
  const response = await fetch("/api/v1/graph/tours");
  return decode(response, toursSchema);
}

const searchResultSchema = z.object({
  query: z.string(),
  count: z.number().int().nonnegative(),
  groups: z.record(
    z.string(),
    z.array(
      z.object({
        id: z.string(),
        kind: z.string(),
        title: z.string(),
        snippet: z.string(),
        source: z.string(),
      }),
    ),
  ),
  suggestions: z.array(z.string()),
  latencyMicros: z.number().nonnegative(),
  fuzzySearchDecision: z.string(),
});

export async function searchContent(q: string, kind?: string) {
  const query = new URLSearchParams({ q });
  if (kind) query.set("kind", kind);
  const response = await fetch(`/api/v1/search?${query}`);
  return decode(response, searchResultSchema);
}

const diagnosticItemSchema = z.object({
  id: z.string(),
  format: z.string(),
  prompt: z.string(),
  outcomeId: z.string(),
  placementDecision: z.string(),
  choices: z.array(z.string()).min(2),
  justificationRequired: z.boolean(),
  profileOnly: z.boolean(),
});

const diagnosticBlueprintSchema = z.object({
  schemaVersion: z.literal(1),
  releaseId: z.string(),
  modelVersion: z.string(),
  minimumPerformanceItemsPerDomain: z.number().int().min(2),
  packets: z.array(
    z.object({
      id: z.string(),
      domain: z.string(),
      title: z.string(),
      items: z.array(diagnosticItemSchema),
    }),
  ),
});

export type DiagnosticBlueprint = z.infer<typeof diagnosticBlueprintSchema>;

export async function getDiagnosticBlueprint() {
  const response = await fetch("/api/v1/diagnostic/blueprint");
  return decode(response, diagnosticBlueprintSchema);
}

const diagnosticSessionSchema = z.object({
  sessionId: z.string(),
  releaseId: z.string(),
  modelVersion: z.string(),
  resumed: z.boolean(),
  answers: z.record(z.string(), z.unknown()),
  startedAt: z.string(),
});

export async function openDiagnosticSession(retake = false) {
  const response = await authedFetch("/api/v1/diagnostic/sessions", {
    method: "POST",
    json: true,
    body: JSON.stringify({ retake }),
  });
  return decode(response, diagnosticSessionSchema);
}

export type DiagnosticAnswer = {
  answerIndex?: number;
  unknown: boolean;
  accessibilityBypass: boolean;
  justification: string;
};

export async function saveDiagnosticAnswer(
  sessionId: string,
  itemId: string,
  answer: DiagnosticAnswer,
) {
  const response = await authedFetch(
    `/api/v1/diagnostic/sessions/${encodeURIComponent(sessionId)}/items/${encodeURIComponent(itemId)}`,
    {
      method: "POST",
      json: true,
      body: JSON.stringify(answer),
    },
  );
  return decode(
    response,
    z.object({
      sessionId: z.string(),
      savedItemId: z.string(),
      answerCount: z.number().int().nonnegative(),
      answers: z.record(z.string(), z.unknown()),
    }),
  );
}

const placementSchema = z.object({
  sessionId: z.string(),
  placement: z.object({
    releaseId: z.string(),
    modelVersion: z.string(),
    performance: z.array(z.unknown()),
    profileContext: z.array(z.unknown()),
    decisions: z.array(
      z.object({
        domain: z.string(),
        demonstrated: z.number().int().nonnegative(),
        attempted: z.number().int().nonnegative(),
        optionalDecisions: z.array(z.string()),
        explanation: z.string(),
      }),
    ),
    gapMap: z.array(
      z.object({
        outcomeId: z.string(),
        status: z.string(),
        evidence: z.string(),
        learnerOverrideAllowed: z.boolean(),
      }),
    ),
  }),
  openedPrerequisites: z.array(
    z.object({ outcomeId: z.string(), prerequisiteIds: z.array(z.string()) }),
  ),
  comparability: z.string(),
});

export async function finishDiagnosticSession(sessionId: string) {
  const response = await authedFetch(
    `/api/v1/diagnostic/sessions/${encodeURIComponent(sessionId)}/finish`,
    { method: "POST" },
  );
  return decode(response, placementSchema);
}

export async function overrideGapStatus(
  sessionId: string,
  input: {
    outcomeId: string;
    requestedStatus: "open" | "optional" | "priority";
    explanation: string;
  },
) {
  const response = await authedFetch(
    `/api/v1/diagnostic/sessions/${encodeURIComponent(sessionId)}/gap-override`,
    {
      method: "POST",
      json: true,
      body: JSON.stringify(input),
    },
  );
  return decode(
    response,
    z.object({
      overrideId: z.string(),
      outcomeId: z.string(),
      requestedStatus: z.string(),
      explanation: z.string(),
      recordedAt: z.string(),
      masteryChanged: z.literal(false),
    }),
  );
}

const labReportSchema = z.object({
  modelVersion: z.string(),
  scenario: z.string(),
  seed: z.number().int().nonnegative(),
  virtualClock: z.number().int().nonnegative(),
  passed: z.boolean(),
  invariant: z.string(),
  events: z.array(z.object({ tick: z.number().int(), kind: z.string(), detail: z.string() })),
  outputs: z.array(z.unknown()),
  metrics: z.record(z.string(), z.number()),
  replayManifest: z.object({
    modelVersion: z.string(),
    seed: z.number().int(),
    fixtureVersion: z.string(),
    wallClockUsed: z.literal(false),
    networkUsed: z.literal(false),
  }),
});

export type LabReport = z.infer<typeof labReportSchema>;

export async function runSystemsLab(
  scenario: string,
  input: { seed: number; hypothesis?: string; capacity?: number },
) {
  const response = await authedFetch(`/api/v1/labs/${encodeURIComponent(scenario)}/run`, {
    method: "POST",
    json: true,
    body: JSON.stringify({
      seed: input.seed,
      hypothesis: input.hypothesis ?? "",
      capacity: input.capacity ?? 3,
    }),
  });
  return decode(response, labReportSchema);
}

export async function compareSqlResults(input: {
  ordered: boolean;
  numericTolerance: number;
  expected: unknown[][];
  actual: unknown[][];
}) {
  const response = await authedFetch("/api/v1/labs/sql/compare", {
    method: "POST",
    json: true,
    body: JSON.stringify(input),
  });
  return decode(
    response,
    z.object({
      accepted: z.boolean(),
      ordered: z.boolean(),
      numericTolerance: z.number(),
      nullSemantics: z.string(),
      datasets: z.number().int(),
    }),
  );
}

const learnerPlanSchema = z.object({
  plan: z
    .object({
      goalId: z.string(),
      goalTitle: z.string(),
      horizonWeeks: z.number().int(),
      weeklyCapacityHours: z.number().int(),
      updatedAt: z.string(),
    })
    .nullable(),
  curriculumMutated: z.literal(false),
});

export async function getLearnerPlan() {
  const response = await authedFetch("/api/v1/learner-plan");
  return decode(response, learnerPlanSchema);
}

export async function saveLearnerPlan(input: {
  goalId: string;
  goalTitle: string;
  horizonWeeks: number;
  weeklyCapacityHours: number;
}) {
  const response = await authedFetch("/api/v1/learner-plan", {
    method: "POST",
    json: true,
    body: JSON.stringify(input),
  });
  return decode(response, learnerPlanSchema);
}

const catalogSchema = z.object({
  releaseId: z.string(),
  kind: z.string(),
  count: z.number().int().nonnegative(),
  records: z.array(graphNodeSchema.extend({ runnable: z.boolean().optional() })),
});

const sourceLinkSchema = z.object({
  id: z.string().optional(),
  title: z.string().optional(),
  url: z.string().url(),
  license: z.string().optional(),
});

const curriculumFileSchema = z.object({
  path: z.string(),
  content: z.string(),
  editable: z.boolean().optional(),
});

export const lessonV2Schema = z
  .object({
    id: z.string(),
    moduleId: z.string(),
    title: z.string(),
    slug: z.string(),
    aliases: z.array(z.string()).default([]),
    summary: z.string(),
    estimateMinutes: z.number().int().positive(),
    difficulty: z.string(),
    objectives: z.array(z.union([z.string(), z.object({ id: z.string(), text: z.string() })])),
    prerequisiteIds: z.array(z.string()).default([]),
    mentalModel: z.string(),
    keyTerms: z.array(z.object({ term: z.string(), definition: z.string() })).default([]),
    syntaxExamples: z
      .array(z.object({ title: z.string(), code: z.string(), explanation: z.string() }))
      .default([]),
    workedTrace: z
      .array(
        z.object({
          step: z.union([z.string(), z.number()]),
          state: z.string(),
          explanation: z.string(),
        }),
      )
      .default([]),
    misconceptions: z
      .array(z.object({ symptom: z.string(), explanation: z.string(), repair: z.string() }))
      .default([]),
    recallChecks: z
      .array(
        z.object({
          id: z.string(),
          prompt: z.string(),
          options: z.array(z.string()).min(2),
          explanation: z.string().optional(),
        }),
      )
      .default([]),
    terminalWork: z
      .object({
        files: z.array(curriculumFileSchema),
        command: z.string(),
        instructions: z.string(),
      })
      .optional(),
    practiceBridge: z
      .array(z.object({ exerciseId: z.string(), requirement: z.string(), whyNow: z.string() }))
      .default([]),
    projectTransfer: z.array(z.object({ stageId: z.string(), reason: z.string() })).default([]),
    recap: z.array(z.string()).default([]),
    sources: z.array(sourceLinkSchema).default([]),
    sourceIds: z.array(z.string()).default([]),
    sectionSources: z.array(sourceLinkSchema).default([]),
    completion: z
      .object({ requiredCheckIds: z.array(z.string()), requiredExerciseIds: z.array(z.string()) })
      .optional(),
    review: z
      .object({ status: z.string(), reviewedAt: z.string(), reviewer: z.string() })
      .optional(),
  })
  .passthrough();

export const practiceItemV2Schema = z
  .object({
    id: z.string(),
    family: z.string(),
    sequence: z.number().int().nonnegative().optional(),
    title: z.string(),
    moduleId: z.string().optional(),
    lessonId: z.string().optional(),
    concepts: z.array(z.string()).default([]),
    difficulty: z.string(),
    pattern: z.string().optional(),
    estimateMinutes: z.number().int().positive(),
    runnable: z.boolean(),
    scored: z.boolean(),
    requirement: z.string().default("core"),
    whyNow: z.string().default("Practice the concept while its mental model is fresh."),
    prepares: z.array(z.string()).default([]),
    prerequisiteIds: z.array(z.string()).default([]),
    outcomes: z.array(z.string()).default([]),
    prompt: z.string().default(""),
    constraints: z.array(z.string()).default([]),
    starter: z
      .object({
        manifest: z.string().default(""),
        files: z.array(curriculumFileSchema).default([]),
      })
      .optional(),
    hints: z.array(z.union([z.string(), z.object({ text: z.string() })])).default([]),
    commonMistakes: z.array(z.string()).default([]),
    tradeoffs: z.array(z.string()).default([]),
    complexity: z.string().optional(),
    // The service strips hidden/regression tests server-side; only the
    // learner-facing visible contract ever reaches this schema.
    tests: z
      .object({
        visible: z
          .array(
            z
              .object({
                name: z.string().optional(),
                path: z.string().optional(),
                content: z.string().default(""),
              })
              .passthrough(),
          )
          .default([]),
      })
      .passthrough()
      .optional(),
    externalReferences: z.array(sourceLinkSchema).default([]),
    provenance: z.record(z.string(), z.unknown()).optional(),
    projectId: z.string().optional(),
    stageId: z.string().optional(),
  })
  .passthrough();

const lessonEnvelopeSchema = z.object({ releaseId: z.string(), lesson: lessonV2Schema });
export const practiceListSchema = z.object({
  releaseId: z.string(),
  items: z.array(practiceItemV2Schema),
  total: z.number().int().nonnegative(),
  page: z.number().int().positive(),
  pageSize: z.number().int().min(1).max(25),
  totalPages: z.number().int().nonnegative(),
});
const practiceDetailSchema = z.object({ releaseId: z.string(), item: practiceItemV2Schema });

export type CurriculumLesson = z.infer<typeof lessonV2Schema>;
export type CurriculumPracticeItem = z.infer<typeof practiceItemV2Schema>;

export async function getCurriculumLesson(id: string) {
  const response = await fetch(`/api/v1/lessons/${encodeURIComponent(id)}`);
  return decode(response, lessonEnvelopeSchema);
}

export type PracticeFilters = {
  family?: string;
  module?: string;
  lesson?: string;
  concept?: string;
  difficulty?: string;
  status?: string;
  runnable?: boolean;
  page?: number;
  pageSize?: number;
};

export async function getPracticeCatalog(filters: PracticeFilters = {}) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value !== undefined && value !== "") query.set(key, String(value));
  }
  const response = await fetch(`/api/v1/practice?${query}`);
  return decode(response, practiceListSchema);
}

export async function getPracticeItem(id: string) {
  const response = await fetch(`/api/v1/practice/${encodeURIComponent(id)}`);
  return decode(response, practiceDetailSchema);
}

export async function revealPracticeItem(id: string) {
  const response = await authedFetch(`/api/v1/practice/${encodeURIComponent(id)}/reveal`, {
    method: "POST",
    mutation: true,
    json: true,
    body: "{}",
  });
  return decode(
    response,
    z.object({
      exerciseId: z.string(),
      support: z.literal("full_reveal"),
      explanation: z.union([z.string(), z.record(z.string(), z.unknown())]),
      referenceSolution: z.object({ files: z.array(curriculumFileSchema) }),
    }),
  );
}

export async function getCatalog(kind: string, prefix?: string, limit = 100) {
  const query = new URLSearchParams({ kind, limit: String(limit) });
  if (prefix) query.set("prefix", prefix);
  const response = await fetch(`/api/v1/catalog?${query}`);
  return decode(response, catalogSchema);
}

const curriculumSchema = z.object({
  releaseId: z.string(),
  modules: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      status: z.string(),
      records: z.array(graphNodeSchema),
      review: z.object({
        technical: z.string(),
        editorial: z.string(),
        accessibility: z.string(),
        reviewer: z.string(),
        reviewedAt: z.string(),
      }),
    }),
  ),
  ordering: z.string(),
  virtualizationDecision: z.string(),
});

export async function getCurriculum() {
  const response = await fetch("/api/v1/curriculum");
  return decode(response, curriculumSchema);
}

const projectDetailSchema = z.object({
  releaseId: z.string(),
  project: graphNodeSchema,
  stages: z.array(
    z.object({
      stage: graphNodeSchema,
      relations: z.array(graphEdgeSchema),
      runnable: z.boolean(),
    }),
  ),
  entryPrerequisites: z.array(graphNodeSchema),
  templates: z.record(z.string(), z.unknown()),
  portfolioChecklist: z.array(z.string()),
});

export async function getProject(projectId: string) {
  const response = await fetch(`/api/v1/projects/${encodeURIComponent(projectId)}`);
  return decode(response, projectDetailSchema);
}

const projectStageV2Schema = z
  .object({
    id: z.string(),
    projectId: z.string(),
    sequence: z.number().int().nonnegative(),
    title: z.string(),
    brief: z.string(),
    boundaries: z.array(z.string()).default([]),
    nonGoals: z.array(z.string()).default([]),
    entryReadiness: z.array(z.string()).default([]),
    relatedLessonIds: z.array(z.string()).default([]),
    relatedExerciseIds: z.array(z.string()).default([]),
    predecessorStageId: z.string().nullable().optional(),
    starter: z.object({ manifest: z.string(), files: z.array(curriculumFileSchema) }),
    definitionOfDone: z.array(z.string()).default([]),
    rubric: z
      .array(z.object({ criterion: z.string(), evidence: z.string(), weight: z.number() }))
      .default([]),
    artifacts: z
      .array(
        z.object({
          id: z.string(),
          title: z.string(),
          template: z.string(),
          required: z.boolean(),
        }),
      )
      .default([]),
    hints: z.array(z.union([z.string(), z.object({ text: z.string() })])).default([]),
    runnable: z.boolean().optional(),
    scored: z.boolean().optional(),
  })
  .passthrough();

export async function getProjectStage(projectId: string, stageId: string) {
  const response = await fetch(
    `/api/v1/projects/${encodeURIComponent(projectId)}/stages/${encodeURIComponent(stageId)}`,
  );
  return decode(
    response,
    z.object({
      releaseId: z.string(),
      project: z.object({ id: z.string(), title: z.string(), summary: z.string() }).passthrough(),
      stage: projectStageV2Schema,
    }),
  );
}

const projectWorkspaceRevisionSchema = z.object({
  projectId: z.string(),
  stageId: z.string(),
  revision: z.number().int().positive(),
  files: z.record(z.string(), z.string()),
  workspaceChecksum: z.string().length(64),
  checkpoint: z.boolean(),
  createdAt: z.string(),
});

export type ProjectWorkspaceRevision = z.infer<typeof projectWorkspaceRevisionSchema>;

export async function getProjectWorkspace(projectId: string, stageId: string) {
  const response = await authedFetch(
    `/api/v1/projects/${encodeURIComponent(projectId)}/stages/${encodeURIComponent(stageId)}/workspace`,
  );
  if (response.status === 204) return null;
  return decode(response, projectWorkspaceRevisionSchema);
}

async function writeProjectWorkspace(
  projectId: string,
  stageId: string,
  files: Record<string, string>,
  checkpoint: boolean,
) {
  const suffix = checkpoint ? "/checkpoint" : "";
  const response = await authedFetch(
    `/api/v1/projects/${encodeURIComponent(projectId)}/stages/${encodeURIComponent(stageId)}/workspace${suffix}`,
    {
      method: "POST",
      json: true,
      body: JSON.stringify({ files }),
    },
  );
  return decode(response, projectWorkspaceRevisionSchema);
}

export function saveProjectWorkspace(
  projectId: string,
  stageId: string,
  files: Record<string, string>,
) {
  return writeProjectWorkspace(projectId, stageId, files, false);
}

export function checkpointProjectWorkspace(
  projectId: string,
  stageId: string,
  files: Record<string, string>,
) {
  return writeProjectWorkspace(projectId, stageId, files, true);
}

const projectCheckpointSchema = z.object({
  checkpointId: z.string(),
  projectId: z.string(),
  stageId: z.string(),
  parentCheckpointId: z.string().nullable(),
  workspaceChecksum: z.string().length(64),
  status: z.enum(["starter", "saved", "submitted", "accepted"]),
  createdAt: z.string(),
});

export async function getProjectCheckpoints(projectId: string) {
  const response = await authedFetch(
    `/api/v1/projects/${encodeURIComponent(projectId)}/checkpoints`,
  );
  return decode(
    response,
    z.object({ projectId: z.string(), checkpoints: z.array(projectCheckpointSchema) }),
  );
}

export async function createProjectCheckpoint(
  projectId: string,
  input: {
    stageId: string;
    parentCheckpointId: string | null;
    workspaceChecksum: string;
    status: "saved" | "submitted";
    evaluatorRunId: string | null;
    regressions: string[];
  },
) {
  const response = await authedFetch(
    `/api/v1/projects/${encodeURIComponent(projectId)}/checkpoints`,
    {
      method: "POST",
      json: true,
      body: JSON.stringify(input),
    },
  );
  return decode(response, projectCheckpointSchema);
}

export async function downloadProjectPortfolio(projectId: string) {
  const response = await authedFetch(`/api/v1/projects/${encodeURIComponent(projectId)}/portfolio`);
  const archive = await decode(response, z.unknown());
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(archive, null, 2)], { type: "application/json" }),
  );
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${projectId.toLowerCase()}-portfolio-evidence.json`;
  anchor.click();
  URL.revokeObjectURL(url);
}

const journalEntrySchema = z.object({
  entryId: z.string(),
  kind: z.string(),
  title: z.string(),
  body: z.string(),
  projectId: z.string().nullable(),
  conceptId: z.string().nullable(),
  errorId: z.string().nullable(),
  support: z.unknown(),
  confidence: z.number().int().nullable(),
  reattemptDay: z.number().int().nullable(),
  createdAt: z.string(),
});

export type JournalFilters = {
  q?: string;
  projectId?: string;
  conceptId?: string;
  errorId?: string;
  from?: number;
  to?: number;
};

export async function getJournal(filters: JournalFilters = {}) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value !== undefined && value !== "") query.set(key, String(value));
  }
  const response = await authedFetch(`/api/v1/journal?${query}`);
  return decode(response, z.object({ entries: z.array(journalEntrySchema) }));
}

export async function createJournalEntry(input: {
  kind: string;
  title: string;
  body: string;
  projectId?: string;
  conceptId?: string;
  errorId?: string;
  confidence?: number;
  reattemptDay?: number;
}) {
  const response = await authedFetch("/api/v1/journal", {
    method: "POST",
    json: true,
    body: JSON.stringify({ ...input, support: { source: "learner_reflection" } }),
  });
  return decode(response, z.object({ entryId: z.string(), createdAt: z.string() }));
}

const errorRecordSchema = z.object({
  errorId: z.string(),
  code: z.string(),
  rootCause: z.string(),
  correction: z.string(),
  futureCue: z.string(),
  conceptIds: z.array(z.string()),
  occurrenceCount: z.number().int().positive(),
  latestOccurrence: z.string().nullable(),
});

export async function getErrors() {
  const response = await authedFetch("/api/v1/errors");
  return decode(response, z.object({ errors: z.array(errorRecordSchema) }));
}

export async function recordError(input: {
  code: string;
  rootCause: string;
  correction: string;
  futureCue: string;
  conceptIds: string[];
}) {
  const response = await authedFetch("/api/v1/errors", {
    method: "POST",
    json: true,
    body: JSON.stringify(input),
  });
  return decode(
    response,
    z.object({ errorId: z.string(), occurrenceId: z.string(), fingerprint: z.string().length(64) }),
  );
}

export async function startFocusSession(input: { mode: string; intention: string }) {
  const response = await authedFetch("/api/v1/focus-sessions", {
    method: "POST",
    json: true,
    body: JSON.stringify(input),
  });
  return decode(
    response,
    z.object({
      focusSessionId: z.string(),
      mode: z.string(),
      intention: z.string(),
      startedAt: z.string(),
      timeIsMasteryEvidence: z.literal(false),
      surveillance: z.literal(false),
    }),
  );
}

export async function finishFocusSession(
  focusSessionId: string,
  input: { interruptionNotes: string[]; endReview: string },
) {
  const response = await authedFetch(
    `/api/v1/focus-sessions/${encodeURIComponent(focusSessionId)}/finish`,
    {
      method: "POST",
      json: true,
      body: JSON.stringify(input),
    },
  );
  return decode(
    response,
    z.object({
      focusSessionId: z.string(),
      endedAt: z.string(),
      interruptionNotes: z.array(z.string()),
      endReview: z.string(),
      timeIsMasteryEvidence: z.literal(false),
      surveillance: z.literal(false),
    }),
  );
}

export async function getHintDependence() {
  const response = await authedFetch("/api/v1/hint-dependence");
  return decode(
    response,
    z.object({
      status: z.enum(["insufficient_evidence", "measured"]),
      minimumComparableAttempts: z.number().int(),
      comparisonClass: z.string(),
      crossDifficultyComparison: z.literal(false),
      groups: z.array(
        z.object({
          itemId: z.string(),
          itemVersion: z.number().int(),
          sample: z.number().int(),
          firstHalfAverageSupportLevel: z.number(),
          secondHalfAverageSupportLevel: z.number(),
          declining: z.boolean(),
        }),
      ),
    }),
  );
}

export async function registerProjectArtifact(input: {
  projectId: string;
  stageId: string;
  kind: string;
  pastedText: string;
}) {
  const response = await authedFetch("/api/v1/projects/artifacts/register", {
    method: "POST",
    json: true,
    body: JSON.stringify(input),
  });
  return decode(
    response,
    z.object({
      registrationId: z.string(),
      checksum: z.string().length(64),
      executed: z.literal(false),
      createdAt: z.string(),
    }),
  );
}

export async function saveExternalPractice(input: {
  platform: string;
  urlOrId: string;
  localExerciseId: string;
  notes: string;
}) {
  const response = await authedFetch("/api/v1/external-practice", {
    method: "POST",
    json: true,
    body: JSON.stringify({
      ...input,
      status: "attempted",
      support: { provenance: "learner_reported" },
    }),
  });
  return decode(
    response,
    z.object({
      bookmarkId: z.string(),
      createdAt: z.string(),
      externalContentFetched: z.literal(false),
      masteryChanged: z.literal(false),
    }),
  );
}

const questionKindSchema = z.enum([
  "multiple_choice",
  "multiple_select",
  "true_false",
  "predict_output",
  "identify_compiler_error",
  "fill_missing_code",
  "ordering",
  "short_response",
  "complexity_analysis",
  "debugging_decision",
]);

const publicQuestionSchema = z.object({
  id: z.string(),
  version: z.number().int().positive(),
  lessonId: z.string(),
  kind: questionKindSchema,
  prompt: z.string(),
  options: z.array(z.string()),
  starter: z.string().nullable(),
  outcomeIds: z.array(z.string()).min(1),
  rubric: z.array(z.string()).min(1),
  supportPolicy: z.string(),
  partialCreditPolicy: z.string(),
  randomizationSeed: z.number().int(),
});

export type PublicQuestion = z.infer<typeof publicQuestionSchema>;

export type QuestionResponse =
  | { type: "index"; value: number }
  | { type: "indices"; values: number[] }
  | { type: "boolean"; value: boolean }
  | { type: "text"; value: string }
  | { type: "compiler_code"; value: string }
  | { type: "evaluator"; passed: boolean }
  | { type: "order"; values: string[] }
  | { type: "checklist"; checked: string[]; response: string }
  | { type: "complexity"; time: string; space: string; reasoning: string; checked: string[] }
  | { type: "debugging"; hypothesis: string; action: string; checked: string[] };

export async function getQuestionBank() {
  return decode(
    await fetch("/api/v1/questions"),
    z.object({
      schemaVersion: z.literal(1),
      count: z.literal(10),
      questions: z.array(publicQuestionSchema).length(10),
    }),
  );
}

const questionSubmissionSchema = z.object({
  result: z.object({
    questionId: z.string(),
    version: z.number().int(),
    correct: z.boolean(),
    score: z.number(),
    deterministic: z.literal(true),
    manualSelfReview: z.boolean(),
    rubricChecks: z.array(z.string()),
    explanation: z.string(),
    outcomeIds: z.array(z.string()),
    revealedAnswer: z.object({ type: z.string(), value: z.unknown().optional() }),
    reviewAdditions: z.array(z.string()),
  }),
  history: z.object({
    attemptId: z.string(),
    idempotentRetry: z.boolean(),
    firstResult: z.object({
      score: z.number(),
      correct: z.boolean(),
      support: z.unknown(),
      confidence: z.number().int(),
    }),
    bestResult: z.object({ score: z.number(), correct: z.boolean() }),
    attemptCount: z.number().int().positive(),
    support: z.unknown(),
    confidence: z.number().int(),
  }),
  lessonId: z.string(),
  conceptMappings: z.array(z.string()),
  selfAssessed: z.boolean(),
  reviewRecommendation: z.object({
    added: z.array(z.string()),
    deduplicated: z.literal(true),
    persisted: z.boolean(),
    ordering: z.string(),
  }),
});

export type QuestionSubmission = z.infer<typeof questionSubmissionSchema>;

export async function submitQuestion(
  questionId: string,
  input: {
    idempotencyKey: string;
    confirmed: boolean;
    response: QuestionResponse;
    support: Record<string, unknown>;
    confidence: number;
    evaluatorEvidence?: { runId: string };
  },
) {
  const response = await authedFetch(`/api/v1/questions/${encodeURIComponent(questionId)}/submit`, {
    method: "POST",
    json: true,
    body: JSON.stringify(input),
  });
  return decode(response, questionSubmissionSchema);
}

const examItemSchema = z.object({
  id: z.string(),
  category: z.string(),
  format: z.string(),
  prompt: z.string(),
  choices: z.array(z.string()).min(2),
  itemChecksum: z.string().length(64),
  primaryOutcomeId: z.string(),
  rubric: z.string(),
  support: z.string(),
  explanation: z.string(),
  remediationLessonId: z.string(),
  independentPracticeId: z.string(),
  checkpointId: z.string(),
});

const finalExamSchema = z.object({
  schemaVersion: z.literal(1),
  formId: z.string(),
  formVersion: z.string(),
  passThresholdPercent: z.literal(80),
  supportPolicy: z.string(),
  retryPolicy: z.string(),
  items: z.array(examItemSchema).length(15),
});

export type FinalExam = z.infer<typeof finalExamSchema>;

export async function getFinalExam() {
  return decode(await fetch("/api/v1/exam/blueprint"), finalExamSchema);
}

const examSessionSchema = z.object({
  sessionId: z.string(),
  formId: z.string(),
  formVersion: z.string(),
  resumed: z.boolean(),
  answers: z.record(z.string(), z.unknown()),
  startedAt: z.string(),
});

export async function openFinalExam(retake = false) {
  const response = await authedFetch("/api/v1/exam/sessions", {
    method: "POST",
    json: true,
    body: JSON.stringify({ retake }),
  });
  return decode(response, examSessionSchema);
}

export async function saveExamAnswer(
  sessionId: string,
  itemId: string,
  answer: { answerIndex: number; commitment: string; accessibilityBypass: boolean },
) {
  const response = await authedFetch(
    `/api/v1/exam/sessions/${encodeURIComponent(sessionId)}/items/${encodeURIComponent(itemId)}`,
    {
      method: "POST",
      json: true,
      body: JSON.stringify(answer),
    },
  );
  return decode(
    response,
    z.object({
      sessionId: z.string(),
      savedItemId: z.string(),
      answerCount: z.number().int(),
      answers: z.record(z.string(), z.unknown()),
    }),
  );
}

const examResultSchema = z.object({
  sessionId: z.string(),
  result: z.object({
    formId: z.string(),
    formVersion: z.string(),
    correct: z.number().int(),
    total: z.literal(15),
    percent: z.number().int(),
    passed: z.boolean(),
    passThresholdPercent: z.literal(80),
    results: z.array(
      z.object({
        itemId: z.string(),
        category: z.string(),
        outcomeId: z.string(),
        correct: z.boolean(),
        support: z.string(),
        rubric: z.string(),
        explanation: z.string(),
        nextProof: z.string(),
        remediationLessonId: z.string().nullable(),
        accessibilityBypass: z.boolean(),
      }),
    ),
    masteryAutomaticallyChanged: z.literal(false),
    reviewPolicy: z.string(),
  }),
});

export async function finishFinalExam(sessionId: string) {
  const response = await authedFetch(
    `/api/v1/exam/sessions/${encodeURIComponent(sessionId)}/finish`,
    { method: "POST" },
  );
  return decode(response, examResultSchema);
}

const portableArchiveSchema = z.object({
  manifest: z.object({
    schemaVersion: z.literal(1),
    format: z.literal("rust-tutor-portable-json"),
    checksumSha256: z.string().length(64),
    rowCounts: z.record(z.string(), z.number().int().nonnegative()),
    canonicalOrdering: z.string(),
    redactionPolicy: z.string(),
  }),
  payload: z.record(z.string(), z.unknown()),
});

export type PortableArchive = z.infer<typeof portableArchiveSchema>;

export async function exportLearnerData() {
  const response = await authedFetch("/api/v1/data/export");
  return decode(response, portableArchiveSchema);
}

export async function createDatabaseBackup() {
  const response = await authedFetch("/api/v1/data/backup", { method: "POST" });
  return decode(
    response,
    z.object({
      source: z.string(),
      backupPath: z.string(),
      bytes: z.number().int().positive(),
      checksumSha256: z.string().length(64),
      integrity: z.literal("ok"),
      method: z.literal("SQLite VACUUM INTO"),
    }),
  );
}

export async function dryRunImport(archive: unknown) {
  const response = await authedFetch("/api/v1/data/import", {
    method: "POST",
    json: true,
    body: JSON.stringify({ archive, mode: "dry_run" }),
  });
  return decode(
    response,
    z.object({
      valid: z.literal(true),
      checksumSha256: z.string().length(64),
      rowCounts: z.record(z.string(), z.number().int().nonnegative()),
      conflicts: z.string(),
      canonicalRowsChanged: z.number().int().nonnegative(),
      mode: z.literal("dry_run"),
    }),
  );
}

export async function applyVerifiedImport(archive: unknown, expectedChecksum: string) {
  const response = await authedFetch("/api/v1/data/import", {
    method: "POST",
    json: true,
    body: JSON.stringify({
      archive,
      mode: "apply",
      confirmation: "APPLY VERIFIED IMPORT",
      expectedChecksum,
    }),
  });
  return decode(
    response,
    z.object({
      backup: z.object({ checksumSha256: z.string().length(64) }).passthrough(),
      apply: z.object({
        appliedRows: z.number().int().nonnegative(),
        checksumSha256: z.string().length(64),
        projectionChecksum: z.string(),
        integrity: z.literal("ok"),
      }),
      ledger: z.object({ appendOnly: z.literal(true) }).passthrough(),
    }),
  );
}

export async function resetProgress(input: {
  scope: "module" | "lesson" | "all_progress";
  targetId: string | null;
  confirmation: string;
}) {
  const response = await authedFetch("/api/v1/data/reset", {
    method: "POST",
    json: true,
    body: JSON.stringify(input),
  });
  return decode(
    response,
    z.object({
      backup: z.object({ checksumSha256: z.string().length(64) }).passthrough(),
      reset: z.object({
        resetId: z.string(),
        scope: z.string(),
        targetId: z.string().nullable(),
        auditHistoryPreserved: z.literal(true),
        canonicalDataDeleted: z.literal(false),
      }),
    }),
  );
}

export async function getDashboardSnapshot() {
  const response = await authedFetch("/api/v1/dashboard");
  return decode(
    response,
    z.object({
      outcomeDistribution: z.object({
        not_started: z.number().int().nonnegative(),
        states: z.record(z.string(), z.number().int().nonnegative()),
      }),
      retainedCoverage: z.object({
        numerator: z.number().int().nonnegative(),
        denominator: z.number().int().nonnegative(),
        fraction: z.number().min(0).max(1),
      }),
      counts: z.object({
        distinctAttemptedItems: z.number().int().nonnegative(),
        attempts: z.number().int().nonnegative(),
        evidenceEvents: z.number().int().nonnegative(),
        scheduledReviews: z.number().int().nonnegative(),
        dueReviews: z.number().int().nonnegative(),
        projectArtifacts: z.number().int().nonnegative(),
        focusSessions: z.number().int().nonnegative(),
        studyDayCount: z.number().int().nonnegative(),
      }),
      recentCompilerActivity: z.array(
        z.object({
          evaluatorRunId: z.string(),
          status: z.string(),
          createdAt: z.string(),
          itemId: z.string(),
        }),
      ),
      exam: z
        .object({
          formVersion: z.string(),
          status: z.string(),
          startedAt: z.string(),
          completedAt: z.string().nullable(),
          result: z.unknown().nullable(),
        })
        .nullable(),
      metricGlossary: z.record(z.string(), z.string()),
    }),
  );
}
