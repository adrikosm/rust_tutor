import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import {
  acceptWorkbenchItem,
  checkpointProjectWorkspace,
  createProjectCheckpoint,
  type DiagnosticAnswer,
  downloadProjectPortfolio,
  evaluateRustStreaming,
  finishDiagnosticSession,
  type GraphResult,
  getBootstrap,
  getCatalog,
  getConfidenceCalibration,
  getCurriculum,
  getDiagnosticBlueprint,
  getGraph,
  getGraphOverlay,
  getGraphPrerequisites,
  getGraphTours,
  getLearnerPlan,
  getLearnTracks,
  getProject,
  getProjectCheckpoints,
  getProjectStage,
  getProjectWorkspace,
  getReviewQueue,
  getWorkbenchProgress,
  openDiagnosticSession,
  overrideGapStatus,
  rateReview,
  registerProjectArtifact,
  saveDiagnosticAnswer,
  saveLearnerPlan,
  saveProjectWorkspace,
  searchContent,
} from "../../lib/service-client";

import { useCourseProgressSync } from "./ChapterPage";
import { chapterIsComplete, chapterProgress, chapters, strands } from "./course";
import { GraphMap } from "./GraphMap";
import { ContextStrip, PageHero, statusLabel } from "./LearningShared";

const MonacoSourceEditor = lazy(() =>
  import("../workbench/MonacoSourceEditor").then((module) => ({
    default: module.MonacoSourceEditor,
  })),
);

export function ReviewPage() {
  const queryClient = useQueryClient();
  const queue = useQuery({ queryKey: ["review-queue"], queryFn: getReviewQueue });
  const concepts = useQuery({
    queryKey: ["catalog", "concept"],
    queryFn: () => getCatalog("concept", undefined, 500),
  });
  const calibration = useQuery({
    queryKey: ["confidence-calibration"],
    queryFn: getConfidenceCalibration,
  });
  const [revealed, setRevealed] = useState(false);
  const [gradedCount, setGradedCount] = useState(0);
  const rating = useMutation({
    mutationFn: (value: "again" | "hard" | "good" | "easy") => {
      const concept = queue.data?.items[0]?.conceptId;
      if (!concept) throw new Error("No review item is due.");
      return rateReview(concept, value);
    },
    onSuccess: () => {
      setRevealed(false);
      setGradedCount((count) => count + 1);
      for (const key of ["review-queue", "dashboard-snapshot"]) {
        void queryClient.invalidateQueries({ queryKey: [key] });
      }
    },
  });
  const conceptIndex = new Map((concepts.data?.records ?? []).map((r) => [r.id, r]));
  const currentReview = queue.data?.items[0];
  const comingUp = queue.data?.items.slice(1) ?? [];
  const dueCount = queue.data?.items.length ?? 0;
  const totalToday = gradedCount + dueCount;
  const concept = currentReview ? conceptIndex.get(currentReview.conceptId) : undefined;
  const conceptTitle = concept?.title ?? currentReview?.conceptId ?? "";
  const resumeChapter =
    chapters.find((chapter) => !chapterIsComplete(chapter)) ?? chapters[chapters.length - 1];
  return (
    <>
      <PageHero
        eyebrow="Retrieval practice"
        title={
          queue.isPending
            ? "Loading your review queue."
            : dueCount > 0
              ? `${dueCount} ${dueCount === 1 ? "retrieval is" : "retrievals are"} due.`
              : "Queue clear."
        }
        lede="Recall from memory before you reveal. Your grade sets the next interval — honesty now saves relearning later."
        numeral={queue.data ? (dueCount > 0 ? String(dueCount).padStart(2, "0") : "✓") : undefined}
      />
      <ContextStrip meta="again → relearn · hard → same interval · good → next · easy → skip ahead (1 · 3 · 7 · 21 days)">
        <span>
          {queue.data ? (
            dueCount > 0 ? (
              <>
                card <strong>{gradedCount + 1}</strong> of {totalToday} · {gradedCount} graded
              </>
            ) : gradedCount > 0 ? (
              `${gradedCount} of ${gradedCount} graded`
            ) : (
              "nothing due today"
            )
          ) : (
            "checking the schedule…"
          )}
        </span>
      </ContextStrip>
      <div className="review-layout">
        <div>
          {queue.isPending && <p role="status">Loading scheduled retrieval…</p>}
          {queue.isError && <p role="alert">{queue.error.message}</p>}
          {currentReview ? (
            <section className="review-current" aria-labelledby="current-review-title">
              <p className="eyebrow">
                Card {gradedCount + 1} of {totalToday} · concept
              </p>
              <h2 id="current-review-title">{conceptTitle}</h2>
              <p>
                From memory: state the rule this concept names, and predict what its compiler
                evidence looks like.
              </p>
              {!revealed ? (
                <button className="button" type="button" onClick={() => setRevealed(true)}>
                  Reveal answer
                </button>
              ) : (
                <>
                  <div className="review-answer">
                    <p>{concept?.summary ?? currentReview.reason}</p>
                  </div>
                  <fieldset className="review-rating" disabled={rating.isPending}>
                    <legend>Rate your retrieval — the grade reschedules this concept</legend>
                    <div className="review-rating-actions">
                      {(
                        [
                          ["again", "Again", "Again — relearn, due tomorrow"],
                          ["hard", "Hard", "Hard — repeat the previous interval"],
                          ["good", "Good", "Good — advance to the next interval"],
                          ["easy", "Easy", "Easy — skip an interval ahead"],
                        ] as const
                      ).map(([value, label, description]) => (
                        <button
                          key={value}
                          type="button"
                          data-grade={value}
                          aria-label={description}
                          title={description}
                          onClick={() => rating.mutate(value)}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  </fieldset>
                  <details className="review-why">
                    <summary>Why this is due</summary>
                    <p>{currentReview.reason}</p>
                    <p>
                      Due day {currentReview.dueDay} · {statusLabel(currentReview.estimatedMode)} ·{" "}
                      {statusLabel(currentReview.supportPolicy)} · scheduler{" "}
                      {currentReview.modelVersion} · evidence {currentReview.evidenceIds.join(", ")}
                    </p>
                  </details>
                </>
              )}
              {rating.data && (
                <p role="status">
                  Rated {rating.data.rating}; next due day {rating.data.dueDay} (
                  {rating.data.reason})
                </p>
              )}
              {rating.error && <p role="alert">{rating.error.message}</p>}
              {currentReview.suggestedExerciseId ? (
                <Link
                  className="button secondary"
                  to="/practice/rust/$exerciseId"
                  params={{ exerciseId: currentReview.suggestedExerciseId }}
                >
                  Prove it on a fresh variant
                </Link>
              ) : null}
            </section>
          ) : (
            queue.data && (
              <section className="review-current review-done" aria-labelledby="review-done-title">
                <p className="eyebrow">Queue clear</p>
                <h2 id="review-done-title">
                  {gradedCount > 0
                    ? `All ${gradedCount} ${gradedCount === 1 ? "retrieval" : "retrievals"} graded.`
                    : "Nothing is due yet."}
                </h2>
                <p>
                  {gradedCount > 0
                    ? "Each grade set its next interval on the 1 · 3 · 7 · 21-day schedule."
                    : "A review enters this queue only after scored evidence exists — clear a chapter stop or a workbench exercise first."}
                </p>
                <div className="review-done-actions">
                  <Link
                    className="button"
                    to="/learn/$chapterId"
                    params={{ chapterId: resumeChapter?.id ?? "hello-rust" }}
                  >
                    Back to chapter {resumeChapter?.number ?? 1} →
                  </Link>
                  <Link className="button secondary" to="/dashboard">
                    Dashboard
                  </Link>
                </div>
              </section>
            )
          )}
        </div>
        <aside className="review-rail" aria-label="Review schedule">
          <p className="eyebrow">Coming up</p>
          {comingUp.length > 0 ? (
            <ul className="review-coming-up">
              {comingUp.map((item) => (
                <li key={item.conceptId}>
                  <span>{conceptIndex.get(item.conceptId)?.title ?? item.conceptId}</span>
                  <small>day {item.dueDay}</small>
                </li>
              ))}
            </ul>
          ) : (
            <p className="review-rail-note">Nothing else scheduled today.</p>
          )}
          {queue.data && queue.data.overflow > 0 && (
            <p role="status" className="review-rail-note">
              {queue.data.overflow} additional due items are deferred by the daily cap.
            </p>
          )}
          <details className="review-calibration">
            <summary>Confidence calibration</summary>
            <section className="calibration" aria-label="Confidence calibration">
              {calibration.isPending && <p role="status">Loading calibration evidence…</p>}
              {calibration.isError && <p role="alert">{calibration.error.message}</p>}
              {calibration.data?.bands.map((band) => (
                <article key={band.band}>
                  <h3>{band.band}</h3>
                  <p>{band.message}</p>
                  <p>
                    {band.sampleCount} samples
                    {band.accuracy === null
                      ? ""
                      : ` · ${Math.round(band.accuracy * 100)}% observed`}
                  </p>
                </article>
              ))}
            </section>
          </details>
        </aside>
      </div>
    </>
  );
}

export function DiagnosticPage() {
  const queryClient = useQueryClient();
  const blueprint = useQuery({
    queryKey: ["diagnostic-blueprint"],
    queryFn: getDiagnosticBlueprint,
  });
  const learnerPlan = useQuery({ queryKey: ["learner-plan"], queryFn: getLearnerPlan });
  const [currentIndex, setCurrentIndex] = useState(0);
  const [selected, setSelected] = useState<number>();
  const [justification, setJustification] = useState("");
  const [accessibilityBypass, setAccessibilityBypass] = useState(false);
  const items = blueprint.data?.packets.flatMap((packet) =>
    packet.items.map((item) => ({ ...item, domain: packet.domain, packetTitle: packet.title })),
  );
  const active = items?.[currentIndex];
  const session = useMutation({
    mutationFn: (retake: boolean) => openDiagnosticSession(retake),
    onSuccess: (opened) => {
      setCurrentIndex(
        Math.min(Object.keys(opened.answers).length, Math.max(0, (items?.length ?? 1) - 1)),
      );
      setSelected(undefined);
      setJustification("");
    },
  });
  const saving = useMutation({
    mutationFn: (answer: DiagnosticAnswer) => {
      if (!session.data || !active) throw new Error("Open the diagnostic session first.");
      return saveDiagnosticAnswer(session.data.sessionId, active.id, answer);
    },
    onSuccess: () => {
      setCurrentIndex((index) => index + 1);
      setSelected(undefined);
      setJustification("");
      setAccessibilityBypass(false);
    },
  });
  const finishing = useMutation({
    mutationFn: () => {
      if (!session.data) throw new Error("Open the diagnostic session first.");
      return finishDiagnosticSession(session.data.sessionId);
    },
    onSuccess: () => {
      for (const key of ["dashboard-snapshot", "graph"]) {
        void queryClient.invalidateQueries({ queryKey: [key] });
      }
    },
  });
  const planSaving = useMutation({
    mutationFn: saveLearnerPlan,
    onSuccess: (data) => queryClient.setQueryData(["learner-plan"], data),
  });
  const answeredCount = session.data
    ? Math.max(Object.keys(session.data.answers).length, saving.data?.answerCount ?? 0)
    : 0;

  return (
    <>
      <PageHero
        eyebrow="Diagnostic · placement by performance"
        title="Diagnostic"
        lede="Four domains, answer-private items. Results place you on the path — retake any time; the path re-plans and nothing is erased."
        numeral="Dx"
      />
      {!session.data && (
        <section className="diagnostic-start">
          <h2>{items?.length ?? "…"} answer-private items across four domains</h2>
          <p>
            A session resumes after restart. “I don’t know” records uncertainty without a guessing
            penalty.
          </p>
          <button
            className="button"
            type="button"
            disabled={!blueprint.data || session.isPending}
            onClick={() => session.mutate(false)}
          >
            Open or resume diagnostic
          </button>
        </section>
      )}
      {session.data && active && !finishing.data && (
        <section className="diagnostic-active" aria-labelledby="diagnostic-active-title">
          <p className="eyebrow">
            {statusLabel(active.domain)} · {active.packetTitle}
          </p>
          <h2 id="diagnostic-active-title">
            {currentIndex + 1}. {active.prompt}
          </h2>
          <p>
            {answeredCount} saved · release {session.data.releaseId} ·{" "}
            {session.data.resumed ? "resumed" : "new"} session
          </p>
          <fieldset disabled={saving.isPending}>
            <legend>Commit one response</legend>
            {active.choices.map((choice, index) => (
              <label key={choice}>
                <input
                  type="radio"
                  name={active.id}
                  checked={selected === index}
                  onChange={() => setSelected(index)}
                />
                {choice}
              </label>
            ))}
          </fieldset>
          {active.justificationRequired && (
            <label htmlFor="diagnostic-why">
              Justification
              <textarea
                id="diagnostic-why"
                rows={4}
                value={justification}
                onChange={(event) => setJustification(event.target.value)}
              />
            </label>
          )}
          <label>
            <input
              type="checkbox"
              checked={accessibilityBypass}
              onChange={(event) => setAccessibilityBypass(event.target.checked)}
            />
            Record accessibility bypass for this interaction
          </label>
          <div className="diagnostic-actions">
            <button
              className="button"
              type="button"
              disabled={
                selected === undefined ||
                (active.justificationRequired && !justification.trim()) ||
                saving.isPending
              }
              onClick={() =>
                saving.mutate({
                  answerIndex: selected,
                  unknown: false,
                  accessibilityBypass,
                  justification,
                })
              }
            >
              Save response
            </button>
            <button
              type="button"
              disabled={saving.isPending}
              onClick={() =>
                saving.mutate({ unknown: true, accessibilityBypass, justification: "" })
              }
            >
              I don’t know
            </button>
          </div>
        </section>
      )}
      {session.data && items && currentIndex >= items.length && !finishing.data && (
        <section className="diagnostic-finish">
          <h2>All responses are saved.</h2>
          <button
            className="button"
            type="button"
            onClick={() => finishing.mutate()}
            disabled={finishing.isPending}
          >
            Calculate deterministic gap map
          </button>
        </section>
      )}
      {(session.error || saving.error || finishing.error || planSaving.error) && (
        <p role="alert">
          {(session.error ?? saving.error ?? finishing.error ?? planSaving.error)?.message}
        </p>
      )}
      {finishing.data && (
        <section className="placement-result" aria-labelledby="placement-title">
          <h2 id="placement-title">Editable evidence gap map</h2>
          <p>{finishing.data.comparability}</p>
          {(() => {
            const start = recommendedStart(finishing.data.placement.gapMap);
            return (
              <aside className="placement-recommendation">
                <p className="eyebrow">Where to start in the course</p>
                <h3>{start.title}</h3>
                <p>{start.why}</p>
                <Link
                  className="button"
                  to="/learn/$chapterId"
                  params={{ chapterId: start.chapterId }}
                >
                  Open chapter {start.number} →
                </Link>
                <p className="placement-recommendation__note">
                  A recommendation only — every chapter stays open, and nothing was marked complete.
                </p>
              </aside>
            );
          })()}
          <div className="placement-domains">
            {finishing.data.placement.decisions.map((decision) => (
              <article key={decision.domain}>
                <h3>{statusLabel(decision.domain)}</h3>
                <p>
                  {decision.demonstrated} demonstrated · {decision.attempted} attempted
                </p>
                <p>{decision.explanation}</p>
              </article>
            ))}
          </div>
          <ol className="gap-map">
            {finishing.data.placement.gapMap.map((gap) => (
              <GapMapRow key={gap.outcomeId} gap={gap} sessionId={finishing.data.sessionId} />
            ))}
          </ol>
          <button className="button" type="button" onClick={() => session.mutate(true)}>
            Start version-labeled retake
          </button>
        </section>
      )}
      <details className="diagnostic-plan-disclosure">
        <summary>Goal and capacity — reprioritizes recommendations</summary>
        <section className="diagnostic-plan" aria-labelledby="plan-title">
          <h2 id="plan-title">Goal and capacity</h2>
          <p>
            These settings reprioritize recommendations. They never rewrite the reviewed curriculum.
          </p>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              const form = new FormData(event.currentTarget);
              planSaving.mutate({
                goalId: String(form.get("goalId")),
                goalTitle: String(form.get("goalTitle")),
                horizonWeeks: Number(form.get("horizonWeeks")),
                weeklyCapacityHours: Number(form.get("weeklyCapacityHours")),
              });
            }}
          >
            <label htmlFor="goal-id">Goal path</label>
            <select
              id="goal-id"
              name="goalId"
              defaultValue={learnerPlan.data?.plan?.goalId ?? "PRJ-QUAY"}
            >
              <option value="PRJ-PULSE">PULSE</option>
              <option value="PRJ-QUAY">QUAY</option>
              <option value="PRJ-TESSERA">TESSERA</option>
            </select>
            <label htmlFor="goal-title">Goal description</label>
            <input
              id="goal-title"
              name="goalTitle"
              defaultValue={
                learnerPlan.data?.plan?.goalTitle ?? "Build QUAY with independent evidence"
              }
              required
            />
            <label htmlFor="goal-horizon">Horizon in weeks</label>
            <input
              id="goal-horizon"
              name="horizonWeeks"
              type="number"
              min="1"
              max="156"
              defaultValue={learnerPlan.data?.plan?.horizonWeeks ?? 24}
              required
            />
            <label htmlFor="goal-capacity">Weekly capacity in hours</label>
            <input
              id="goal-capacity"
              name="weeklyCapacityHours"
              type="number"
              min="1"
              max="80"
              defaultValue={learnerPlan.data?.plan?.weeklyCapacityHours ?? 10}
              required
            />
            <button className="button" type="submit" disabled={planSaving.isPending}>
              Save learning constraints
            </button>
          </form>
          {planSaving.data && (
            <p role="status">Goal constraints saved; curriculum records were not changed.</p>
          )}
        </section>
      </details>
    </>
  );
}

// One gap row with the audited learner-override control the title promises.
function GapMapRow({
  gap,
  sessionId,
}: {
  gap: { outcomeId: string; status: string; evidence: string; learnerOverrideAllowed: boolean };
  sessionId: string;
}) {
  const [editing, setEditing] = useState(false);
  const [requestedStatus, setRequestedStatus] = useState<"open" | "optional" | "priority">("open");
  const [explanation, setExplanation] = useState("");
  const override = useMutation({
    mutationFn: () =>
      overrideGapStatus(sessionId, { outcomeId: gap.outcomeId, requestedStatus, explanation }),
    onSuccess: () => setEditing(false),
  });
  return (
    <li>
      <Link to="/graph" search={{ id: gap.outcomeId, depth: 1 }}>
        {gap.outcomeId}
      </Link>
      <strong>
        {override.data ? `${gap.status} → ${override.data.requestedStatus}` : gap.status}
      </strong>
      <p>{gap.evidence}</p>
      {gap.learnerOverrideAllowed && !override.data && (
        <button type="button" onClick={() => setEditing((current) => !current)}>
          {editing ? "Cancel override" : "Adjust status"}
        </button>
      )}
      {editing && (
        <form
          className="gap-override-form"
          onSubmit={(event) => {
            event.preventDefault();
            override.mutate();
          }}
        >
          <label>
            Requested status
            <select
              value={requestedStatus}
              onChange={(event) => setRequestedStatus(event.target.value as typeof requestedStatus)}
            >
              <option value="open">Open — keep it on the path</option>
              <option value="optional">Optional — defer for now</option>
              <option value="priority">Priority — pull it forward</option>
            </select>
          </label>
          <label>
            Why (recorded with the override)
            <textarea
              required
              rows={2}
              value={explanation}
              onChange={(event) => setExplanation(event.target.value)}
            />
          </label>
          <button type="submit" disabled={override.isPending || !explanation.trim()}>
            Record audited override
          </button>
        </form>
      )}
      {override.data && (
        <p role="status">Override {override.data.overrideId} recorded; mastery unchanged.</p>
      )}
      {override.error && <p role="alert">{override.error.message}</p>}
    </li>
  );
}

export function GraphPage({
  selectedId = "CON-RUST-OWNERSHIP-001",
  kinds = "",
  depth = 1,
}: {
  selectedId?: string;
  kinds?: string;
  depth?: number;
}) {
  const graph = useQuery({
    queryKey: ["graph", selectedId, kinds, depth],
    queryFn: () => getGraph({ id: selectedId, kinds, depth }),
  });
  const tours = useQuery({ queryKey: ["graph-tours"], queryFn: getGraphTours });
  const prerequisites = useQuery({
    queryKey: ["graph-prerequisites", selectedId],
    queryFn: () => getGraphPrerequisites(selectedId),
  });
  const overlay = useQuery({ queryKey: ["graph-overlay"], queryFn: getGraphOverlay });
  const [search, setSearch] = useState("");
  const searchResults = useQuery({
    queryKey: ["graph-node-search", search],
    queryFn: () => searchContent(search),
    enabled: search.trim().length >= 2,
  });
  const [selectedKinds, setSelectedKinds] = useState(() => kinds.split(",").filter(Boolean));
  const navigate = useNavigate();
  // The overlay is a flat list of `{ nodeId, state, … }` projection rows; the
  // map only needs the ids the learner has retained, which is the predicate
  // the dashboard's retained coverage already counts. The set must be
  // referentially stable or the canvas effect would tear down on every render.
  const masteredIds = useMemo(() => {
    const ids = new Set<string>();
    for (const row of overlay.data?.learnerState ?? []) {
      if (typeof row.nodeId === "string" && row.state === "retained") ids.add(row.nodeId);
    }
    return ids;
  }, [overlay.data]);
  const heading = useRef<HTMLHeadingElement>(null);
  const graphLoaded = useRef(false);
  useEffect(() => {
    if (!graph.data) return;
    if (graphLoaded.current) heading.current?.focus();
    else graphLoaded.current = true;
  }, [graph.data]);

  const selectedNode = graph.data?.nodes.find((node) => node.id === selectedId);
  const nodeById = new Map(graph.data?.nodes.map((node) => [node.id, node]) ?? []);
  const selectedRelations =
    graph.data?.edges.filter(
      (edge) => edge.sourceId === selectedId || edge.targetId === selectedId,
    ) ?? [];
  const symmetricKinds = new Set(["confusable_with", "related", "alternative_to"]);
  const incoming = selectedRelations.filter(
    (edge) => edge.targetId === selectedId && !symmetricKinds.has(edge.kind),
  );
  const outgoing = selectedRelations.filter(
    (edge) => edge.sourceId === selectedId && !symmetricKinds.has(edge.kind),
  );
  const related = selectedRelations.filter((edge) => symmetricKinds.has(edge.kind));
  const searchGroups = Object.values(searchResults.data?.groups ?? {})
    .flat()
    .slice(0, 8);

  function peerFor(edge: GraphResult["edges"][number]) {
    const peerId = edge.sourceId === selectedId ? edge.targetId : edge.sourceId;
    return (
      nodeById.get(peerId) ?? {
        id: peerId,
        kind: "unknown",
        title: peerId,
        summary: "",
        contentVersion: "",
        reviewState: "",
        provenanceIds: [],
      }
    );
  }

  function relationList(
    title: string,
    relations: GraphResult["edges"],
    direction: "incoming" | "outgoing" | "related",
  ) {
    return (
      <section className={`relationship-column relationship-column--${direction}`}>
        <h2>{title}</h2>
        {relations.length ? (
          <ol>
            {relations.map((edge) => {
              const peer = peerFor(edge);
              return (
                <li key={edge.edgeId}>
                  <Link to="/graph" search={{ id: peer.id, depth, kinds: kinds || undefined }}>
                    <span>{statusLabel(peer.kind)}</span>
                    <strong>{peer.title}</strong>
                  </Link>
                  <p>
                    <b>{statusLabel(edge.kind)}</b> · {edge.rationale}
                  </p>
                </li>
              );
            })}
          </ol>
        ) : (
          <p>No direct relationships in this direction.</p>
        )}
      </section>
    );
  }

  return (
    <>
      <PageHero
        eyebrow="Knowledge graph · relationship explorer"
        title="See what leads here—and what this unlocks."
        lede="Follow authored prerequisites, practice, misconceptions, sources, and project transfer without losing the reason behind each connection."
      />
      <section className="graph-tools" aria-label="Graph search and filters">
        <div className="graph-search">
          <label htmlFor="graph-search">Find a concept, exercise, lesson, or project</label>
          <input
            id="graph-search"
            type="search"
            value={search}
            placeholder="ownership, binary search, PULSE…"
            onChange={(event) => setSearch(event.target.value)}
            autoComplete="off"
          />
          {searchResults.isPending && search.length >= 2 && <p role="status">Searching…</p>}
          {searchGroups.length > 0 && (
            <ul className="graph-search__results">
              {searchGroups.map((result) => (
                <li key={result.id}>
                  <Link to="/graph" search={{ id: result.id, depth, kinds: kinds || undefined }}>
                    <strong>{result.title}</strong>
                    <span>{statusLabel(result.kind)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
        <form className="graph-query" action="/graph" method="get">
          <input type="hidden" name="id" value={selectedId} />
          <input type="hidden" name="kinds" value={selectedKinds.join(",")} />
          <label htmlFor="graph-depth">Relationship depth</label>
          <select id="graph-depth" name="depth" defaultValue={depth}>
            <option value="1">Direct relationships</option>
            <option value="2">Two steps</option>
            <option value="3">Three steps</option>
          </select>
          {graph.data && (
            <details className="graph-query__kinds">
              <summary>
                Focused relationship kinds · {selectedKinds.length || "all"} selected
              </summary>
              <fieldset>
                <legend className="visually-hidden">Filter focused relationship kinds</legend>
                <div className="graph-kind-filters">
                  {Object.keys(graph.data.legend).map((kind) => (
                    <label key={kind}>
                      <input
                        type="checkbox"
                        checked={selectedKinds.length === 0 || selectedKinds.includes(kind)}
                        onChange={(event) => {
                          if (selectedKinds.length === 0) {
                            setSelectedKinds(
                              event.target.checked
                                ? []
                                : Object.keys(graph.data.legend).filter((entry) => entry !== kind),
                            );
                          } else {
                            setSelectedKinds((current) =>
                              event.target.checked
                                ? [...current, kind]
                                : current.filter((entry) => entry !== kind),
                            );
                          }
                        }}
                      />
                      {statusLabel(kind)}
                    </label>
                  ))}
                </div>
              </fieldset>
            </details>
          )}
          <button className="button" type="submit">
            Apply graph filters
          </button>
          <Link to="/graph" search={{ id: selectedId, depth: 1 }}>
            Reset filters
          </Link>
        </form>
      </section>
      <GraphMap
        selectedId={selectedId}
        masteredIds={masteredIds}
        onSelect={(id) =>
          navigate({ to: "/graph", search: { id, depth, kinds: kinds || undefined } })
        }
      />

      {graph.isPending && <p role="status">Loading the reviewed graph release…</p>}
      {graph.isError && <p role="alert">{graph.error.message}</p>}
      {graph.data && (
        <section className="graph-inspector" aria-labelledby="graph-inspector-title">
          <p className="eyebrow">Focused {statusLabel(selectedNode?.kind) ?? "node"}</p>
          <h2 id="graph-inspector-title" ref={heading} tabIndex={-1}>
            {selectedNode?.title ?? graph.data.selectedId}
          </h2>
          {selectedNode?.summary && <p>{selectedNode.summary}</p>}
          <p className="graph-inspector__meta">
            {selectedRelations.length} direct relationships · release {graph.data.releaseId} ·
            review {selectedNode?.reviewState || "unreviewed"}
          </p>
          {Object.entries(selectedNode ?? {}).filter(
            ([key, value]) =>
              ![
                "id",
                "kind",
                "title",
                "summary",
                "contentVersion",
                "reviewState",
                "provenanceIds",
              ].includes(key) && ["string", "number", "boolean"].includes(typeof value),
          ).length > 0 && (
            <details>
              <summary>Node details</summary>
              <dl>
                {Object.entries(selectedNode ?? {})
                  .filter(
                    ([key, value]) =>
                      ![
                        "id",
                        "kind",
                        "title",
                        "summary",
                        "contentVersion",
                        "reviewState",
                        "provenanceIds",
                      ].includes(key) && ["string", "number", "boolean"].includes(typeof value),
                  )
                  .map(([key, value]) => (
                    <div key={key}>
                      <dt>{statusLabel(key)}</dt>
                      <dd>{String(value)}</dd>
                    </div>
                  ))}
              </dl>
            </details>
          )}
        </section>
      )}
      {graph.data && (
        <section className="relationship-map" aria-label="Directed relationships">
          {relationList("What leads here", incoming, "incoming")}
          <div className="relationship-focus" aria-hidden="true">
            <span>Focus</span>
            <strong>{selectedNode?.title ?? selectedId}</strong>
          </div>
          {relationList("What this enables", outgoing, "outgoing")}
          {related.length > 0 && relationList("Related concepts and risks", related, "related")}
        </section>
      )}
      {graph.data && (
        <section className="graph-overview" aria-label="Visual relationship overview">
          <svg
            viewBox="0 0 900 280"
            role="img"
            aria-label={`Overview of ${selectedNode?.title ?? selectedId} and ${selectedRelations.length} direct relationships`}
          >
            <defs>
              <marker
                id="graph-arrow"
                viewBox="0 0 10 10"
                refX="8"
                refY="5"
                markerWidth="6"
                markerHeight="6"
                orient="auto-start-reverse"
              >
                <path d="M 0 0 L 10 5 L 0 10 z" />
              </marker>
            </defs>
            {incoming.slice(0, 6).map((edge, index) => (
              <line
                key={edge.edgeId}
                x1="190"
                y1={40 + index * 36}
                x2="420"
                y2="140"
                markerEnd="url(#graph-arrow)"
              />
            ))}
            {outgoing.slice(0, 6).map((edge, index) => (
              <line
                key={edge.edgeId}
                x1="480"
                y1="140"
                x2="710"
                y2={40 + index * 36}
                markerEnd="url(#graph-arrow)"
              />
            ))}
            <rect x="350" y="105" width="200" height="70" rx="8" />
            <text x="450" y="145" textAnchor="middle">
              {selectedNode?.title.slice(0, 28) ?? selectedId}
            </text>
            {incoming.slice(0, 6).map((edge, index) => (
              <text key={`in-${edge.edgeId}`} x="20" y={44 + index * 36}>
                {peerFor(edge).title.slice(0, 24)}
              </text>
            ))}
            {outgoing.slice(0, 6).map((edge, index) => (
              <text key={`out-${edge.edgeId}`} x="720" y={44 + index * 36}>
                {peerFor(edge).title.slice(0, 24)}
              </text>
            ))}
          </svg>
        </section>
      )}
      <section className="graph-evidence-grid">
        <details open>
          <summary>Unsatisfied prerequisite path · {prerequisites.data?.steps.length ?? 0}</summary>
          {prerequisites.isError && <p>{prerequisites.error.message}</p>}
          <ol>
            {prerequisites.data?.steps.map((step) => (
              <li key={step.node.id}>
                <Link to="/graph" search={{ id: step.node.id, depth: 1 }}>
                  {step.node.title}
                </Link>
                <p>{step.explanation}</p>
              </li>
            ))}
          </ol>
        </details>
        <details>
          <summary>Learner mastery overlay</summary>
          {overlay.isPending && <p role="status">Loading learner evidence…</p>}
          {overlay.isError && <p>{overlay.error.message}</p>}
          {overlay.data && (
            <pre>
              <code>
                {JSON.stringify(
                  overlay.data.learnerState.filter((entry) => entry.nodeId === selectedId),
                  null,
                  2,
                )}
              </code>
            </pre>
          )}
        </details>
      </section>
      {graph.data?.truncated && (
        <p role="status">
          This bounded view was truncated. Reduce depth or select relationship kinds.
        </p>
      )}
      {graph.data && (
        <section className="graph-legend" aria-labelledby="graph-legend-title">
          <h2 id="graph-legend-title">Edge legend</h2>
          <dl>
            {Object.entries(graph.data.legend).map(([kind, description]) => (
              <div key={kind}>
                <dt>{statusLabel(kind)}</dt>
                <dd>{description}</dd>
              </div>
            ))}
          </dl>
        </section>
      )}
      <section className="tour-list" aria-labelledby="tour-title">
        <p className="eyebrow">Released learning paths</p>
        <h2 id="tour-title">Guided tours</h2>
        {tours.isPending && <p role="status">Loading guided paths…</p>}
        {tours.isError && <p role="alert">{tours.error.message}</p>}
        {tours.data?.tours.length === 0 && <p>No guided paths are in this release.</p>}
        {tours.data?.tours.map((tour) => (
          <details key={tour.id}>
            <summary>
              {tour.id} · {tour.title}
            </summary>
            <p>{tour.entryGate}</p>
            <ol>
              {tour.steps.map((step) => (
                <li key={step.nodeId}>
                  <Link to="/graph" search={{ id: step.nodeId, depth: 1 }}>
                    {step.nodeId}
                  </Link>
                  <p>{step.what}</p>
                  <p>
                    <strong>Why now:</strong> {step.whyNow} {step.previousConnection}
                  </p>
                  {step.lessonId && (
                    <Link to="/lessons/$lessonId" params={{ lessonId: step.lessonId }}>
                      Open lesson {step.lessonId}
                    </Link>
                  )}
                  {step.exerciseId &&
                    (step.exerciseId.startsWith("EXE-ALG") ? (
                      <Link
                        to="/practice/algorithms/$problemId"
                        params={{ problemId: step.exerciseId }}
                      >
                        Attempt {step.exerciseId}
                      </Link>
                    ) : (
                      <Link
                        to="/practice/rust/$exerciseId"
                        params={{ exerciseId: step.exerciseId }}
                      >
                        Attempt {step.exerciseId}
                      </Link>
                    ))}
                  {!step.lessonId && !step.exerciseId && (
                    <small>
                      No dedicated lesson or executable exercise ships for this subject yet; inspect
                      the concept's evidence contract instead.
                    </small>
                  )}
                </li>
              ))}
            </ol>
          </details>
        ))}
      </section>
    </>
  );
}

// Maps demonstrated diagnostic outcomes to a from-zero course starting point.
// It only recommends — it never marks chapters complete, because completion
// means the learner ran and passed the chapter's code, not that they answered
// a placement item.
function recommendedStart(gapMap: { outcomeId: string; status: string }[]): {
  chapterId: string;
  number: number;
  title: string;
  why: string;
} {
  const demonstrated = new Set(
    gapMap.filter((gap) => gap.status === "demonstrated").map((gap) => gap.outcomeId),
  );
  const foundations =
    demonstrated.has("OUT-RUST-TRACE-EXPRESSION-VALUE-001") &&
    demonstrated.has("OUT-RUST-SELECT-CONTROL-FLOW-001");
  const ownership = demonstrated.has("OUT-RUST-TRACE-OWNERSHIP-001");
  const borrowing = demonstrated.has("OUT-RUST-SELECT-PARAMETER-MODE-001");
  if (ownership && borrowing) {
    return {
      chapterId: "structs",
      number: 8,
      title: "Jump ahead to structs and methods",
      why: "You demonstrated ownership and borrowing, so the foundations and the ownership model are already behind you.",
    };
  }
  if (ownership) {
    return {
      chapterId: "borrowing",
      number: 6,
      title: "Start at borrowing and references",
      why: "Ownership is demonstrated; pick the thread back up where borrowing sharpens it.",
    };
  }
  if (foundations) {
    return {
      chapterId: "ownership",
      number: 5,
      title: "Start at ownership and moves",
      why: "Bindings, types, and control flow look solid — the ownership model is the next real step.",
    };
  }
  return {
    chapterId: "hello-rust",
    number: 1,
    title: "Start from chapter one",
    why: "Begin with the compiler and the core mental models; nothing here assumes prior Rust.",
  };
}

function CoursePath() {
  const current =
    chapters.find((chapter) => !chapterIsComplete(chapter)) ?? chapters[chapters.length - 1];
  return (
    <section className="course-path" aria-label="The course, chapter by chapter">
      {strands.map((strand) => (
        <section key={strand} className="course-path__strand">
          <h3>{strand}</h3>
          <ol>
            {chapters
              .filter((chapter) => chapter.strand === strand)
              .map((chapter) => {
                const progress = chapterProgress(chapter.id);
                const stopTotal = chapter.sections.filter(
                  (section) => section.kind === "stop",
                ).length;
                const complete = chapterIsComplete(chapter);
                const state = complete
                  ? "complete"
                  : chapter.id === current?.id
                    ? "current"
                    : undefined;
                return (
                  <li key={chapter.id} data-state={state}>
                    <Link to="/learn/$chapterId" params={{ chapterId: chapter.id }}>
                      <span className="course-path__number" aria-hidden="true">
                        {String(chapter.number).padStart(2, "0")}
                      </span>
                      <span className="course-path__body">
                        <strong>{chapter.title}</strong>
                        <small>
                          {chapter.minutes} min · {progress.stops.length}/{stopTotal} stops
                          {progress.ran ? " · code ran" : ""}
                        </small>
                      </span>
                      <span className="course-path__state" aria-hidden="true">
                        {complete ? "✓" : "→"}
                      </span>
                    </Link>
                  </li>
                );
              })}
          </ol>
        </section>
      ))}
    </section>
  );
}

/**
 * The Rust Book track: 23 containers over 109 pinned pages, in source order.
 *
 * Reading order is navigation, not readiness — no page is locked. A page counts
 * as read only once its recall checks are committed, so opening one never
 * manufactures progress.
 */
function BookTrackOutline() {
  const tracks = useQuery({ queryKey: ["learn-tracks"], queryFn: getLearnTracks });
  if (tracks.isPending) return <p role="status">Loading the Rust Book track…</p>;
  if (tracks.isError) return <p role="alert">{tracks.error.message}</p>;
  const { book, nextRecommendation } = tracks.data;
  const resume = nextRecommendation.book;
  const currentModule = book.modules.find((module) =>
    module.pages.some((page) => page.id === resume?.id),
  );
  return (
    <section className="book-track" aria-label="Complete Rust Book track">
      <div className="book-track__status">
        <p>
          <strong>
            {book.progress.pagesRead} of {book.progress.pages}
          </strong>{" "}
          pages checked · source pinned to the stable Rust Book
        </p>
        {resume && (
          <Link className="button" to="/lessons/$lessonId" params={{ lessonId: resume.id }}>
            {book.progress.pagesRead === 0 ? "Start reading" : "Resume"} · {resume.title} →
          </Link>
        )}
      </div>
      {book.modules.map((module) => (
        <details key={module.id} open={module.id === currentModule?.id}>
          <summary>
            <span className="book-track__number" aria-hidden="true">
              {String(module.number).padStart(2, "0")}
            </span>
            <span>
              <strong>{module.title}</strong>
              <small>
                {module.pages.filter((page) => page.read).length}/{module.pages.length} pages
              </small>
            </span>
          </summary>
          <p className="book-track__summary">{module.summary}</p>
          <ol className="book-track__pages">
            {module.pages.map((page) => (
              <li key={page.id} data-current={page.id === resume?.id || undefined}>
                <Link to="/lessons/$lessonId" params={{ lessonId: page.id }}>
                  {page.title}
                </Link>
                <small>
                  {page.pageRole === "lesson" ? `${page.estimateMinutes} min` : page.pageRole} ·{" "}
                  {page.read ? "checked" : "unread"}
                </small>
              </li>
            ))}
          </ol>
        </details>
      ))}
    </section>
  );
}

export function CurriculumPage({ query = "", track = "" }: { query?: string; track?: string }) {
  // Re-hydrate the local progress cache from SQLite so the path reflects work
  // done in another browser or after a storage clear.
  useCourseProgressSync();
  // `track` selects which of the two linked tracks is shown; `q` alone drives
  // the released-record search.
  const bookTrack = track === "book";
  const searching = Boolean(query);
  const curriculum = useQuery({ queryKey: ["curriculum"], queryFn: getCurriculum });
  const chaptersComplete = chapters.filter(chapterIsComplete).length;
  const started = chapters.some((chapter) => {
    const progress = chapterProgress(chapter.id);
    return progress.ran || progress.stops.length > 0;
  });
  const current =
    chapters.find((chapter) => !chapterIsComplete(chapter)) ?? chapters[chapters.length - 1];
  const filtered = searching
    ? (curriculum.data?.modules
        .map((module) => ({
          ...module,
          records: module.records.filter((record) => {
            const text = `${record.id} ${record.title} ${record.summary}`.toLowerCase();
            return !query || text.includes(query.toLowerCase());
          }),
        }))
        .filter((module) => module.records.length > 0) ?? [])
    : [];
  const matchCount = filtered.reduce((sum, module) => sum + module.records.length, 0);
  return (
    <>
      {bookTrack ? (
        <PageHero
          eyebrow="Curriculum · the complete Rust Book · 109 pinned pages"
          title="The Rust Book, end to end"
          lede="Every page from the Introduction through Appendix G, byte-for-byte from the pinned stable source, with Rust Tutor objectives, checks, and practice links layered on top."
          numeral="109"
        />
      ) : (
        <PageHero
          eyebrow={`Curriculum · ${chapters.length} chapters · one ordered route`}
          title="The learning path"
          lede="Read the model, clear the stops, run real code. Ownership arrives in chapter five with the compiler ready to check your reasoning."
          numeral={String(chapters.length)}
          actions={
            current && (
              <Link className="button" to="/learn/$chapterId" params={{ chapterId: current.id }}>
                {started ? `Continue chapter ${current.number} →` : "Start chapter 1 →"}
              </Link>
            )
          }
        />
      )}
      {!bookTrack && (
        <ContextStrip
          meta={
            <Link to="/graph" search={{ id: "CON-RUST-OWNERSHIP-001", depth: 1 }}>
              see it as a graph →
            </Link>
          }
        >
          <span>
            <strong>{chaptersComplete}</strong> of {chapters.length} chapters cleared
          </span>
          {current && (
            <span>
              you are on{" "}
              <strong>
                chapter {current.number} — {current.title}
              </strong>
            </span>
          )}
        </ContextStrip>
      )}
      {searching ? (
        <section className="curriculum-results" aria-label="Curriculum search results">
          <p className="eyebrow">
            {curriculum.isPending
              ? "Searching released records…"
              : `${matchCount} matching ${matchCount === 1 ? "record" : "records"}`}
          </p>
          {curriculum.isError && <p role="alert">{curriculum.error.message}</p>}
          <ol>
            {filtered.flatMap((module) =>
              module.records.map((record) => (
                <li key={record.id}>
                  <Link to="/graph" search={{ id: record.id, depth: 1 }}>
                    <span className="curriculum-results__body">
                      <strong>{record.title}</strong>
                      <small>
                        {module.title} · {statusLabel(record.kind)}
                      </small>
                    </span>
                    <span aria-hidden="true">→</span>
                  </Link>
                </li>
              )),
            )}
          </ol>
          {curriculum.data && matchCount === 0 && <p>No released record matches these filters.</p>}
          <Link to="/curriculum" search={{ q: "", track: "" }}>
            ← Back to the full path
          </Link>
        </section>
      ) : (
        <>
          <nav className="track-switcher" aria-label="Learning tracks">
            <Link
              to="/curriculum"
              search={{ q: "", track: "" }}
              aria-current={bookTrack ? undefined : "page"}
            >
              <strong>Guided Rust Tutor</strong>
              <small>{chapters.length} authored chapters · one ordered route</small>
            </Link>
            <Link
              to="/curriculum"
              search={{ q: "", track: "book" }}
              aria-current={bookTrack ? "page" : undefined}
            >
              <strong>Complete Rust Book</strong>
              <small>109 pinned pages · Introduction through Appendix G</small>
            </Link>
          </nav>
          {bookTrack ? <BookTrackOutline /> : <CoursePath />}
        </>
      )}
    </>
  );
}

export function CurriculumModulePage({ moduleId }: { moduleId: string }) {
  const curriculum = useQuery({ queryKey: ["curriculum"], queryFn: getCurriculum });
  const module = curriculum.data?.modules.find((candidate) => candidate.id === moduleId);
  return (
    <>
      <PageHero
        eyebrow={`Curriculum module${module ? ` · ${statusLabel(module.status)}` : ""}`}
        title={module?.title ?? "Loading released module…"}
        lede={
          module
            ? `${module.records.length} reviewed ${module.records.length === 1 ? "record" : "records"} · reviewed ${module.review.reviewedAt}`
            : undefined
        }
      />
      {curriculum.isPending && <p role="status">Loading released module…</p>}
      {curriculum.isError && <p role="alert">{curriculum.error.message}</p>}
      {curriculum.data && !module && <p role="alert">No released module has this stable ID.</p>}
      {module && (
        <>
          <ol className="module-records">
            {module.records.map((record) => (
              <li key={record.id}>
                <article>
                  <p className="eyebrow">{statusLabel(record.kind)}</p>
                  <h2>{record.title}</h2>
                  <p>{record.summary}</p>
                  <Link to="/graph" search={{ id: record.id, depth: 1 }}>
                    Prerequisites and evidence links
                  </Link>
                </article>
              </li>
            ))}
          </ol>
          <nav className="graph-actions" aria-label="Module actions">
            <Link to="/practice">Continue with independent practice</Link>
            <Link to="/review">Review due evidence</Link>
            <Link to="/curriculum" search={{ q: "", track: "" }}>
              Back to curriculum
            </Link>
          </nav>
        </>
      )}
    </>
  );
}

export function ProjectsPage() {
  const catalog = useQuery({
    queryKey: ["catalog", "project"],
    queryFn: () => getCatalog("project", undefined, 100),
  });
  const coreProjectIds = ["PRJ-PULSE", "PRJ-QUAY", "PRJ-TESSERA"];
  const records = catalog.data?.records.slice().sort((left, right) => {
    const leftCore = coreProjectIds.indexOf(left.id);
    const rightCore = coreProjectIds.indexOf(right.id);
    if (leftCore >= 0 || rightCore >= 0)
      return (leftCore < 0 ? 99 : leftCore) - (rightCore < 0 ? 99 : rightCore);
    return left.title.localeCompare(right.title);
  });
  return (
    <>
      <PageHero
        eyebrow="Projects · programs you keep"
        title="Projects"
        lede="Each project grows with the curriculum — a stage unlocks when its chapters are cleared, and the code stays yours: exported with your data, runnable outside the tutor."
        numeral="★"
      />
      {catalog.isPending && <p role="status">Loading project release…</p>}
      {catalog.isError && <p role="alert">{catalog.error.message}</p>}
      {records?.length === 0 && (
        <section className="empty-surface">
          <h2>No reviewed projects are in this release.</h2>
          <p>The catalog remains empty rather than inventing an active project.</p>
        </section>
      )}
      {records && records.length > 0 && (
        <section className="project-catalog project-rows" aria-label="Reviewed project catalog">
          {records.map((project, index) => {
            const isCoreProject = coreProjectIds.includes(project.id);
            return (
              <article
                key={project.id}
                className={`project-row ${isCoreProject ? "project-row--core flagship" : ""}`}
              >
                <div className="project-row__index">
                  <span className="sr-only">Project </span>
                  {String(index + 1).padStart(2, "0")}
                </div>
                <div className="project-row__body">
                  <p className="eyebrow">
                    {isCoreProject ? "Cumulative project" : statusLabel(project.kind)}
                  </p>
                  <h2>{project.title}</h2>
                  <p>{project.summary}</p>
                </div>
                <Link
                  className="button"
                  to="/projects/$projectId"
                  params={{ projectId: project.id }}
                >
                  Open workspace →
                </Link>
              </article>
            );
          })}
        </section>
      )}
    </>
  );
}

export function ProjectPage({ projectId }: { projectId: string }) {
  const queryClient = useQueryClient();
  const bootstrap = useQuery({
    queryKey: ["bootstrap"],
    queryFn: ({ signal }) => getBootstrap(signal),
  });
  const project = useQuery({
    queryKey: ["project", projectId],
    queryFn: () => getProject(projectId),
  });
  const [activeStageId, setActiveStageId] = useState("");
  useEffect(() => {
    if (!activeStageId && project.data?.stages.length) {
      setActiveStageId(
        project.data.stages.find((entry) => entry.runnable)?.stage.id ??
          project.data.stages[0]?.stage.id ??
          "",
      );
    }
  }, [activeStageId, project.data]);
  const stageGuide = useQuery({
    queryKey: ["project-stage-v2", projectId, activeStageId],
    queryFn: () => getProjectStage(projectId, activeStageId),
    enabled: Boolean(activeStageId),
    retry: false,
  });
  const workspaceRevision = useQuery({
    queryKey: ["project-workspace-v2", projectId, activeStageId],
    queryFn: () => getProjectWorkspace(projectId, activeStageId),
    enabled: Boolean(activeStageId),
  });
  const [artifactStage, setArtifactStage] = useState("");
  const [artifactKind, setArtifactKind] = useState("design_decision");
  const [artifactText, setArtifactText] = useState("");
  const [stagePlan, setStagePlan] = useState("");
  const [stageSource, setStageSource] = useState(
    '#[derive(Debug)]\npub struct Slo {\n    pub availability_bps: u16,\n    pub max_query_cost_cents: u64,\n}\n\npub fn validate_slo(slo: &Slo) -> Result<(), &\'static str> {\n    // Validate availability first, then the positive cost budget.\n    todo!()\n}\n\nfn main() {\n    println!("{:?}", validate_slo(&Slo { availability_bps: 9_950, max_query_cost_cents: 250 }));\n}\n',
  );
  const [stageSourceVersion, setStageSourceVersion] = useState(1);
  const progress = useQuery({ queryKey: ["workbench-progress"], queryFn: getWorkbenchProgress });
  const checkpoints = useQuery({
    queryKey: ["project-checkpoints", projectId],
    queryFn: () => getProjectCheckpoints(projectId),
  });
  const stageStarterPath =
    stageGuide.data?.stage.starter.files.find((file) => file.path.endsWith(".rs"))?.path ??
    "src/main.rs";
  const currentWorkspaceFiles = () => ({
    [stageStarterPath]: stageSource,
    "STAGE_PLAN.md": stagePlan,
  });
  const workspaceSave = useMutation({
    mutationFn: () => saveProjectWorkspace(projectId, activeStageId, currentWorkspaceFiles()),
    onSuccess: (revision) => {
      queryClient.setQueryData(["project-workspace-v2", projectId, activeStageId], revision);
    },
  });
  const stageAcceptance = useMutation({
    mutationFn: async (runId: string) => {
      const accepted = await acceptWorkbenchItem(activeStageId, runId);
      const revision = await checkpointProjectWorkspace(
        projectId,
        activeStageId,
        currentWorkspaceFiles(),
      );
      return { accepted, revision };
    },
    onSuccess: ({ revision }) => {
      queryClient.setQueryData(["project-workspace-v2", projectId, activeStageId], revision);
      void queryClient.invalidateQueries({ queryKey: ["workbench-progress"] });
      void queryClient.invalidateQueries({ queryKey: ["project-checkpoints", projectId] });
    },
  });
  const stageEvaluation = useMutation({
    mutationFn: async (action: "check" | "run" | "test") => {
      const contentHash = bootstrap.data?.content.checksum;
      if (!contentHash) throw new Error("The reviewed content checksum is not ready.");
      const files = currentWorkspaceFiles();
      const revision = await saveProjectWorkspace(projectId, activeStageId, files);
      queryClient.setQueryData(["project-workspace-v2", projectId, activeStageId], revision);
      return evaluateRustStreaming(
        {
          runId: `RUN-${crypto.randomUUID()}`,
          exerciseId: activeStageId,
          action,
          source: stageSource,
          files: { [stageStarterPath]: stageSource },
          workspaceRevision: revision.revision,
          contentHash,
        },
        () => undefined,
      );
    },
    onSuccess: (result, action) => {
      if (action === "test" && result.status === "ACCEPTED") {
        stageAcceptance.mutate(result.runId);
      }
    },
  });
  useEffect(() => {
    if (!workspaceRevision.isFetched) return;
    const starter = stageGuide.data?.stage.starter.files.find((file) => file.path.endsWith(".rs"));
    if (!starter) return;
    setStageSource(workspaceRevision.data?.files[starter.path] ?? starter.content);
    setStageSourceVersion((value) => value + 1);
    setStagePlan(workspaceRevision.data?.files["STAGE_PLAN.md"] ?? "");
  }, [stageGuide.data, workspaceRevision.data, workspaceRevision.isFetched]);
  // The server derives the evidence checksum from the submitted text.
  const artifact = useMutation({
    mutationFn: () =>
      registerProjectArtifact({
        projectId,
        stageId: artifactStage,
        kind: artifactKind,
        pastedText: artifactText,
      }),
  });
  const checkpoint = useMutation({
    mutationFn: async () => {
      const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(artifactText));
      const workspaceChecksum = Array.from(new Uint8Array(digest), (byte) =>
        byte.toString(16).padStart(2, "0"),
      ).join("");
      const prior = checkpoints.data?.checkpoints.at(-1);
      return createProjectCheckpoint(projectId, {
        stageId: artifactStage,
        parentCheckpointId: prior?.checkpointId ?? null,
        workspaceChecksum,
        status: "saved",
        evaluatorRunId: null,
        regressions: [],
      });
    },
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["project-checkpoints", projectId] }),
  });
  return (
    <>
      <PageHero
        eyebrow={`Project · ${projectId}`}
        title={project.data?.project.title ?? "Loading cumulative project…"}
        lede={
          project.data?.project.summary ??
          "The same learner-owned workspace advances only through evidence-gated stages."
        }
        numeral="★"
      />
      {project.isError && <p role="alert">{project.error.message}</p>}
      {project.data && (
        <>
          <details className="project-entry">
            <summary>Entry evidence</summary>
            <ul>
              {[
                ...new Map(project.data.entryPrerequisites.map((item) => [item.id, item])).values(),
              ].map((prerequisite) => (
                <li key={prerequisite.id}>
                  <Link to="/graph" search={{ id: prerequisite.id, depth: 1 }}>
                    {prerequisite.title}
                  </Link>
                </li>
              ))}
            </ul>
          </details>
          {["PRJ-PULSE", "PRJ-QUAY", "PRJ-TESSERA"].includes(projectId) && activeStageId && (
            <section className="algorithm-editor" aria-labelledby="pulse-stage-workbench-title">
              <p className="eyebrow">Executable project stage · {activeStageId}</p>
              <h2 id="pulse-stage-workbench-title">
                {stageGuide.data?.stage.title ?? "Loading stage guide…"}
              </h2>
              <p>
                {stageGuide.data?.stage.brief ??
                  "The same cumulative workspace advances through visible, hidden, and regression evidence."}
              </p>
              {stageGuide.data && (
                <div className="project-stage-guide">
                  <section>
                    <h3>Architecture boundaries</h3>
                    <ul>
                      {stageGuide.data.stage.boundaries.map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ul>
                  </section>
                  <section>
                    <h3>Definition of done</h3>
                    <ul>
                      {stageGuide.data.stage.definitionOfDone.map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ul>
                  </section>
                  <details>
                    <summary>Non-goals and readiness</summary>
                    <h4>Not in this stage</h4>
                    <ul>
                      {stageGuide.data.stage.nonGoals.map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ul>
                    <h4>Entry readiness</h4>
                    <ul>
                      {stageGuide.data.stage.entryReadiness.map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ul>
                  </details>
                  <details>
                    <summary>Rubric and required artifacts</summary>
                    <ul>
                      {stageGuide.data.stage.rubric.map((item) => (
                        <li key={item.criterion}>
                          <strong>{item.criterion}</strong> · {item.evidence} · {item.weight}%
                        </li>
                      ))}
                    </ul>
                    {stageGuide.data.stage.artifacts.map((item) => (
                      <article key={item.id}>
                        <h4>
                          {item.title}
                          {item.required ? " · required" : ""}
                        </h4>
                        <pre>{item.template}</pre>
                      </article>
                    ))}
                  </details>
                </div>
              )}
              <label htmlFor="pulse-stage-plan">Plan and invariant</label>
              <textarea
                id="pulse-stage-plan"
                rows={4}
                value={stagePlan}
                onChange={(event) => setStagePlan(event.target.value)}
              />
              <p className="eyebrow">Learner-owned Rust source · {stageStarterPath}</p>
              <Suspense
                fallback={
                  <p role="status" className="practice-console__loading">
                    Loading code editor…
                  </p>
                }
              >
                <MonacoSourceEditor
                  exerciseId={activeStageId}
                  filePath={stageStarterPath}
                  source={stageSource}
                  sourceVersion={stageSourceVersion}
                  autocompleteEnabled={bootstrap.data?.toolchain.rust_analyzer ?? false}
                  diagnostics={stageEvaluation.data?.diagnostics ?? []}
                  onChange={(value) => {
                    setStageSource(value);
                    setStageSourceVersion((version) => version + 1);
                  }}
                />
              </Suspense>
              <div className="workbench-toolbar">
                <button
                  type="button"
                  disabled={!stagePlan || workspaceSave.isPending}
                  onClick={() => workspaceSave.mutate()}
                >
                  {workspaceSave.isPending ? "Saving revision…" : "Save workspace revision"}
                </button>
                {(["check", "run", "test"] as const).map((action) => (
                  <button
                    type="button"
                    className={action === "test" ? "button" : undefined}
                    disabled={
                      !stagePlan || !bootstrap.data?.content.checksum || stageEvaluation.isPending
                    }
                    onClick={() => stageEvaluation.mutate(action)}
                    key={action}
                  >
                    {action === "test" ? "Submit current + regression" : action}
                  </button>
                ))}
              </div>
              {workspaceSave.error && <p role="alert">{workspaceSave.error.message}</p>}
              {workspaceSave.data && (
                <p role="status">
                  Revision {workspaceSave.data.revision} saved · checksum{" "}
                  {workspaceSave.data.workspaceChecksum.slice(0, 12)}…
                </p>
              )}
              {stageEvaluation.error && <p role="alert">{stageEvaluation.error.message}</p>}
              {stageEvaluation.data && (
                <section className="evaluation-result" aria-live="polite">
                  <h3>{statusLabel(stageEvaluation.data.status)}</h3>
                  <pre>{stageEvaluation.data.stdout || stageEvaluation.data.stderr}</pre>
                </section>
              )}
              {stageAcceptance.error && <p role="alert">{stageAcceptance.error.message}</p>}
              {stageAcceptance.data && (
                <p role="status">
                  Regression accepted. Immutable checkpoint revision{" "}
                  {stageAcceptance.data.revision.revision} was created; the next authored stage is
                  now eligible.
                </p>
              )}
              {progress.data?.completions.some((item) => item.itemId === activeStageId) && (
                <p className="success-callout">
                  Restart-safe completion: this stage is backed by persisted evaluator evidence.
                </p>
              )}
            </section>
          )}
          <ol className="project-stages">
            {project.data.stages.map(({ stage, relations, runnable }, index) => (
              <li key={stage.id}>
                <article>
                  <p className="eyebrow">
                    Stage {String(index).padStart(2, "0")} ·{" "}
                    {progress.data?.completions.some((completion) => completion.itemId === stage.id)
                      ? "cleared"
                      : runnable ||
                          progress.data?.completions.some(
                            (completion) => completion.unlockedItemId === stage.id,
                          )
                        ? "open"
                        : "locked"}
                  </p>
                  <h2>{stage.title}</h2>
                  <p>{stage.summary}</p>
                  <details>
                    <summary>Contract, tests, artifacts, and unlock evidence</summary>
                    <ul>
                      {relations.map((relation) => (
                        <li key={relation.edgeId}>
                          <strong>{statusLabel(relation.kind)}</strong>: {relation.sourceId} →{" "}
                          {relation.targetId}. {relation.rationale}
                        </li>
                      ))}
                    </ul>
                    <p>
                      From scratch: commit a plan, consult scoped official docs, then implement
                      learner-owned logic. Hints never prefill the solution.
                    </p>
                  </details>
                  <Link to="/graph" search={{ id: stage.id, depth: 1 }}>
                    Inspect stage graph
                  </Link>
                  {runnable && (
                    <button
                      type="button"
                      onClick={() => setActiveStageId(stage.id)}
                      aria-pressed={activeStageId === stage.id}
                    >
                      {activeStageId === stage.id
                        ? "Stage open in workbench"
                        : "Open stage workbench"}
                    </button>
                  )}
                </article>
              </li>
            ))}
          </ol>
          <details className="portfolio-checklist">
            <summary>Portfolio evidence &amp; artifacts</summary>
            <ul>
              {project.data.portfolioChecklist.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
            <button type="button" onClick={() => void downloadProjectPortfolio(projectId)}>
              Download privacy-safe evidence bundle
            </button>
            <p>
              Bundle includes checkpoint and artifact metadata/checksums; learner source, pasted
              bodies, machine paths, tokens, and environment are excluded.
            </p>
            <details>
              <summary>Engineering artifact templates</summary>
              <pre>{JSON.stringify(project.data.templates, null, 2)}</pre>
            </details>
            <form
              className="artifact-form"
              onSubmit={(event) => {
                event.preventDefault();
                artifact.mutate();
              }}
            >
              <h3>Register learner-owned evidence</h3>
              <p>
                Pasted evidence is checksummed and recorded. Registration never runs code or opens a
                local path.
              </p>
              <label htmlFor="artifact-stage">Stage</label>
              <select
                id="artifact-stage"
                required
                value={artifactStage}
                onChange={(event) => setArtifactStage(event.target.value)}
              >
                <option value="">Choose a stage</option>
                {project.data.stages.map(({ stage }) => (
                  <option key={stage.id} value={stage.id}>
                    {stage.title}
                  </option>
                ))}
              </select>
              <label htmlFor="artifact-kind">Evidence type</label>
              <select
                id="artifact-kind"
                value={artifactKind}
                onChange={(event) => setArtifactKind(event.target.value)}
              >
                <option value="design_decision">Design decision</option>
                <option value="test_plan">Test plan</option>
                <option value="benchmark">Benchmark</option>
                <option value="postmortem">Postmortem</option>
                <option value="release_proof">Release proof</option>
              </select>
              <label htmlFor="artifact-text">Evidence text</label>
              <textarea
                id="artifact-text"
                required
                rows={7}
                value={artifactText}
                onChange={(event) => setArtifactText(event.target.value)}
              />
              <button type="submit" disabled={artifact.isPending || !artifactStage}>
                Register checksum
              </button>
              {artifact.data && (
                <p role="status">Registered {artifact.data.registrationId}; executed: no.</p>
              )}
              {artifact.error && <p role="alert">{artifact.error.message}</p>}
              <button
                type="button"
                disabled={checkpoint.isPending || !artifactStage || !artifactText}
                onClick={() => checkpoint.mutate()}
              >
                Save workspace evidence checkpoint
              </button>
              {checkpoint.data && (
                <p role="status">
                  Saved {checkpoint.data.checkpointId} after{" "}
                  {checkpoint.data.parentCheckpointId ?? "starter"}.
                </p>
              )}
              {checkpoint.error && <p role="alert">{checkpoint.error.message}</p>}
            </form>
            <details>
              <summary>Checkpoint lineage ({checkpoints.data?.checkpoints.length ?? 0})</summary>
              <ol>
                {checkpoints.data?.checkpoints.map((item) => (
                  <li key={item.checkpointId}>
                    {item.stageId} · {item.status} · {item.workspaceChecksum.slice(0, 12)}…
                  </li>
                ))}
              </ol>
            </details>
          </details>
        </>
      )}
    </>
  );
}
