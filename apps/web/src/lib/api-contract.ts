import { z } from "zod";

export const healthSchema = z.object({
  status: z.enum(["healthy", "degraded"]),
  service_version: z.string().min(1),
  api_version: z.literal("v1"),
  db_status: z.string().min(1),
  toolchain: z.object({ cargo: z.boolean(), rustc: z.boolean() }),
});

export const errorEnvelopeSchema = z.object({
  code: z.string().min(1),
  message: z.string().min(1),
  details: z.record(z.string(), z.unknown()),
  request_id: z.string().min(1),
  retryable: z.boolean(),
});

export const bootstrapSchema = z.object({
  profile: z.object({ status: z.string(), count: z.number().int().nonnegative() }),
  goals: z.object({ status: z.string(), count: z.number().int().nonnegative() }),
  content: z.object({
    status: z.string(),
    releaseId: z.string().min(1),
    checksum: z.string().length(64),
    graphReleaseId: z.string().min(1),
  }),
  capabilities: z.object({
    database: z.boolean(),
    compiler: z.boolean(),
    offline: z.boolean(),
  }),
  toolchain: z.object({
    cargo: z.boolean(),
    rustc: z.boolean(),
    rustfmt: z.boolean(),
    clippy: z.boolean(),
    rust_analyzer: z.boolean(),
    target: z.string(),
    versions: z.record(z.string(), z.string()),
  }),
});

export type Bootstrap = z.infer<typeof bootstrapSchema>;

export const tutorContentSchema = z.object({
  schemaVersion: z.literal(1),
  releaseId: z.string().startsWith("REL-"),
  sources: z.array(z.object({ id: z.string(), title: z.string(), url: z.string().url() })),
  outcomes: z.array(
    z.object({
      id: z.string(),
      conceptId: z.string(),
      title: z.string(),
      observable: z.string(),
    }),
  ),
  prerequisites: z.array(z.object({ sourceId: z.string(), targetId: z.string() })),
  misconceptions: z.array(z.object({ id: z.string(), title: z.string(), diagnostic: z.string() })),
  diagnostic: z.array(
    z.object({
      id: z.string(),
      outcomeId: z.string(),
      prompt: z.string(),
      choices: z.array(z.string()).min(2),
    }),
  ),
  lesson: z.object({
    id: z.string(),
    title: z.string(),
    recallPrompts: z.array(z.string()).min(1),
    summary: z.string(),
    workedTrace: z.array(
      z.object({
        line: z.number().int().positive(),
        binding: z.string(),
        state: z.string(),
        explanation: z.string(),
      }),
    ),
  }),
  exercises: z.array(
    z.object({
      id: z.string(),
      kind: z.string(),
      outcomeIds: z.array(z.string()).min(1),
      primaryOutcomeIds: z.array(z.string()).min(1),
      supportingOutcomeIds: z.array(z.string()),
      variantGroup: z.string(),
      title: z.string(),
      prompt: z.string(),
      starter: z.string(),
    }),
  ),
  hintLadder: z.array(
    z.object({
      level: z.number().int().min(1).max(7),
      requires: z.string(),
      text: z.string(),
      solutionReveal: z.boolean(),
    }),
  ),
  reviewIntervalsDays: z.tuple([z.literal(1), z.literal(3), z.literal(7), z.literal(21)]),
});

export const evaluationResultSchema = z.object({
  runId: z.string(),
  status: z.enum([
    "ACCEPTED",
    "COMPILE_ERROR",
    "RUNTIME_ERROR",
    "TIME_LIMIT_EXCEEDED",
    "MEMORY_LIMIT_EXCEEDED",
    "WORKSPACE_LIMIT_EXCEEDED",
    "OUTPUT_LIMIT_EXCEEDED",
    "WRONG_ANSWER",
    "CANCELLED",
    "INFRASTRUCTURE_ERROR",
  ]),
  exitCode: z.number().int().nullable(),
  durationMs: z.number().nonnegative(),
  stdout: z.string(),
  stderr: z.string(),
  diagnostics: z.array(
    z.object({
      severity: z.string(),
      code: z.string().nullable(),
      message: z.string(),
      spans: z.array(
        z.object({
          file: z.string(),
          lineStart: z.number().int().nonnegative(),
          lineEnd: z.number().int().nonnegative(),
          columnStart: z.number().int().nonnegative(),
          columnEnd: z.number().int().nonnegative(),
          primary: z.boolean(),
          label: z.string().nullable(),
        }),
      ),
      rendered: z.string().nullable(),
      children: z.array(
        z.object({
          severity: z.string(),
          message: z.string(),
          rendered: z.string().nullable(),
        }),
      ),
      tool: z.string(),
    }),
  ),
  formattedFiles: z.record(z.string(), z.string()),
  cases: z.array(
    z.object({
      id: z.string(),
      input: z.string(),
      expected: z.string().nullable(),
      actual: z.string(),
      stdout: z.string(),
      stderr: z.string(),
      status: z.string(),
      durationMs: z.number().nonnegative(),
    }),
  ),
  outputChunks: z.array(z.object({ channel: z.string(), text: z.string() })),
  replay: z.object({
    action: z.string(),
    contentHash: z.string().length(64),
    toolchain: z.record(z.string(), z.string()),
    network: z.string(),
  }),
});

export const completionResultSchema = z.object({
  items: z
    .array(
      z.object({
        label: z.string(),
        kind: z.number().int().nullable(),
        detail: z.string().nullable(),
        documentation: z.string().nullable(),
        insertText: z.string().nullable(),
        insertTextFormat: z.number().int().nullable(),
        textEdit: z.unknown().nullable(),
      }),
    )
    .max(200),
});

export type TutorContent = z.infer<typeof tutorContentSchema>;
export type EvaluationResult = z.infer<typeof evaluationResultSchema>;
export type CompletionResult = z.infer<typeof completionResultSchema>;
