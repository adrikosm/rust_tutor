import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";

import { useTheme } from "../../app/theme";
import { ForceLayout } from "../../lib/graph-layout";
import { type GraphMapNode, getGraphMap } from "../../lib/service-client";

/**
 * Interactive canvas map of the whole knowledge graph.
 *
 * Canvas rather than SVG because the release ships thousands of nodes and edges:
 * DOM-per-node collapses well before that. The map is a *navigation* surface —
 * the authored relationship lists next to it stay the accessible source of
 * truth, so this component is presented to assistive tech as a summary image
 * with keyboard-reachable controls rather than a maze of focusable dots.
 */

const KIND_COLORS: Record<string, string> = {
  concept: "#f97316",
  lesson: "#38bdf8",
  exercise: "#a3e635",
  project: "#c084fc",
  project_stage: "#8b5cf6",
  misconception: "#fb7185",
  outcome: "#facc15",
  check: "#2dd4bf",
  source: "#94a3b8",
};

function colorFor(kind: string): string {
  return KIND_COLORS[kind] ?? "#64748b";
}

export function GraphMap({
  selectedId,
  masteredIds,
  onSelect,
}: {
  selectedId: string;
  masteredIds?: ReadonlySet<string>;
  onSelect: (id: string) => void;
}) {
  const map = useQuery({
    queryKey: ["graph-map"],
    queryFn: getGraphMap,
    staleTime: Infinity,
    gcTime: Infinity,
  });

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const layoutRef = useRef<ForceLayout | null>(null);
  const viewRef = useRef({ scale: 1, offsetX: 0, offsetY: 0 });
  const pointerRef = useRef<{ dragging: boolean; x: number; y: number; moved: boolean }>({
    dragging: false,
    x: 0,
    y: 0,
    moved: false,
  });
  const [hovered, setHovered] = useState<GraphMapNode | null>(null);
  const [inactiveKinds, setInactiveKinds] = useState<string[]>([]);
  const [settling, setSettling] = useState(true);
  const settlingRef = useRef(true);
  // The canvas only repaints when something changed: the simulation is still
  // moving, the view moved, or React handed the effect new inputs. Without this
  // the map would redraw 6,000 edges every frame forever after it settled.
  const dirtyRef = useRef(true);
  // Fitting is per-release, not per-selection, so clicking a node keeps the pan
  // and zoom the learner set.
  const fittedRef = useRef(false);
  const fitViewRef = useRef<() => void>(() => {});
  const { resolvedTheme } = useTheme();
  const nodesById = useMemo(
    () => new Map((map.data?.nodes ?? []).map((node) => [node.id, node])),
    [map.data],
  );

  // Rebuild the simulation only when the release changes, never on selection —
  // re-running layout on every click would destroy the learner's spatial memory.
  useEffect(() => {
    if (!map.data) return;
    layoutRef.current = new ForceLayout({ nodes: map.data.nodes, edges: map.data.edges });
    fittedRef.current = false;
    settlingRef.current = true;
    setSettling(true);
  }, [map.data]);

  const kindFilter = useMemo(() => new Set(inactiveKinds), [inactiveKinds]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const layout = layoutRef.current;
    if (!canvas || !layout || !map.data) return;
    const context = canvas.getContext("2d");
    if (!context) return;

    let frame = 0;
    dirtyRef.current = true;

    // Canvas cannot inherit CSS, so the ink is read back from the same tokens the
    // stylesheet uses. Without this the map draws near-white on the default light
    // theme and the labels disappear.
    const tokens = getComputedStyle(canvas);
    const dark = resolvedTheme === "dark";
    const readToken = (name: string, fallback: string) =>
      tokens.getPropertyValue(name).trim() || fallback;
    const inkText = readToken("--text", dark ? "#f2ede1" : "#27231c");
    const inkHairline = readToken(
      "--hairline",
      dark ? "rgb(242 237 225 / 14%)" : "rgb(39 35 28 / 12%)",
    );
    const inkFocus = readToken("--focus", dark ? "#f3b34c" : "#0b6481");

    // Reduced motion: the layout still runs, it just is not shown converging.
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const resize = () => {
      const ratio = window.devicePixelRatio || 1;
      const rect = canvas.getBoundingClientRect();
      canvas.width = Math.max(1, Math.floor(rect.width * ratio));
      canvas.height = Math.max(1, Math.floor(rect.height * ratio));
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      dirtyRef.current = true;
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);

    const onWheel = (event: WheelEvent) => {
      // Registered natively: React routes onWheel through a passive listener, so
      // preventDefault there is ignored and the page scrolls while zooming.
      event.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const view = viewRef.current;
      const factor = Math.exp(-event.deltaY * 0.0016);
      const next = Math.max(0.04, Math.min(6, view.scale * factor));
      const px = event.clientX - rect.left;
      const py = event.clientY - rect.top;
      // Keep the point under the cursor anchored while zooming.
      view.offsetX = px - ((px - view.offsetX) / view.scale) * next;
      view.offsetY = py - ((py - view.offsetY) / view.scale) * next;
      view.scale = next;
      dirtyRef.current = true;
    };
    canvas.addEventListener("wheel", onWheel, { passive: false });

    const fitToView = () => {
      const rect = canvas.getBoundingClientRect();
      const { minX, minY, maxX, maxY } = layout.bounds();
      const width = Math.max(1, maxX - minX);
      const height = Math.max(1, maxY - minY);
      const scale = Math.min(rect.width / (width * 1.1), rect.height / (height * 1.1));
      viewRef.current.scale = Math.max(0.05, Math.min(2.5, scale));
      viewRef.current.offsetX = rect.width / 2 - ((minX + maxX) / 2) * viewRef.current.scale;
      viewRef.current.offsetY = rect.height / 2 - ((minY + maxY) / 2) * viewRef.current.scale;
    };
    fitViewRef.current = fitToView;

    const selectedIndex = () => layout.indexById.get(selectedId) ?? null;

    const render = () => {
      frame = requestAnimationFrame(render);
      let alpha = layout.tick();
      // Drain to the point tick() stops moving nodes, so the map appears in its
      // final position instead of drifting there. Costs nothing once settled,
      // because tick() early-outs below alpha 0.005.
      if (reduceMotion) for (let i = 0; i < 500 && alpha >= 0.005; i += 1) alpha = layout.tick();
      if (alpha < 0.05 && !fittedRef.current) {
        fitToView();
        fittedRef.current = true;
      }
      const isSettling = alpha >= 0.05;
      if (isSettling !== settlingRef.current) {
        settlingRef.current = isSettling;
        setSettling(isSettling);
      }
      // tick() stops moving nodes below 0.005, so past that only interaction
      // dirties the canvas.
      if (alpha >= 0.005) dirtyRef.current = true;
      if (!dirtyRef.current) return;
      dirtyRef.current = false;

      const rect = canvas.getBoundingClientRect();
      const { scale, offsetX, offsetY } = viewRef.current;
      context.clearRect(0, 0, rect.width, rect.height);

      const focus = selectedIndex();
      const focusNeighbors = focus === null ? null : new Set(layout.neighbors(focus));

      // Edges first so nodes always sit on top of their connections. Two paths,
      // one per stroke style: 6,000 stroke() calls a frame is what makes the
      // settling animation stutter, and there are only ever two styles.
      context.lineWidth = Math.max(0.4, 0.7 * scale);
      const plainEdges = new Path2D();
      const focusEdges = new Path2D();
      for (const edge of layout.edges) {
        if (kindFilter.has(edge.kind)) continue;
        const source = layout.nodes[edge.source];
        const target = layout.nodes[edge.target];
        if (!source || !target) continue;
        const path =
          focus !== null && (edge.source === focus || edge.target === focus)
            ? focusEdges
            : plainEdges;
        path.moveTo(source.x * scale + offsetX, source.y * scale + offsetY);
        path.lineTo(target.x * scale + offsetX, target.y * scale + offsetY);
      }
      context.strokeStyle = inkHairline;
      context.stroke(plainEdges);
      context.strokeStyle = inkText;
      context.stroke(focusEdges);

      for (const [index, node] of layout.nodes.entries()) {
        const dimmed = focus !== null && index !== focus && !(focusNeighbors?.has(index) ?? false);
        const radius = Math.max(1.2, node.radius * Math.max(0.35, Math.min(1.4, scale)));
        context.beginPath();
        context.arc(node.x * scale + offsetX, node.y * scale + offsetY, radius, 0, Math.PI * 2);
        context.globalAlpha = dimmed ? 0.22 : 1;
        context.fillStyle = masteredIds?.has(node.id) ? "#22c55e" : colorFor(node.kind);
        context.fill();
        if (index === focus) {
          context.globalAlpha = 1;
          context.lineWidth = 2;
          context.strokeStyle = inkFocus;
          context.stroke();
        }
        context.globalAlpha = 1;
      }

      // Labels only once zoomed in, and only for well-connected nodes, so the
      // map reads as a shape from far away and as a diagram up close.
      if (scale > 0.55) {
        context.font = "600 11px system-ui, sans-serif";
        context.fillStyle = inkText;
        for (const [index, node] of layout.nodes.entries()) {
          if (node.radius < (scale > 1.1 ? 4.5 : 7) && index !== focus) continue;
          const meta = nodesById.get(node.id);
          if (!meta) continue;
          const x = node.x * scale + offsetX;
          const y = node.y * scale + offsetY;
          if (x < -80 || y < -20 || x > rect.width + 80 || y > rect.height + 20) continue;
          context.fillText(meta.title.slice(0, 34), x + node.radius + 4, y + 3.5);
        }
      }
    };

    frame = requestAnimationFrame(render);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      canvas.removeEventListener("wheel", onWheel);
    };
  }, [map.data, selectedId, kindFilter, masteredIds, nodesById, resolvedTheme]);

  function toWorld(event: { clientX: number; clientY: number }) {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    const { scale, offsetX, offsetY } = viewRef.current;
    return {
      x: (event.clientX - rect.left - offsetX) / scale,
      y: (event.clientY - rect.top - offsetY) / scale,
    };
  }

  return (
    <section className="graph-map" aria-labelledby="graph-map-title">
      <header className="graph-map__header">
        <div>
          <h2 id="graph-map-title">Concept map</h2>
          <p>
            {map.data
              ? `${map.data.nodes.length} nodes · ${map.data.edges.length} relationships · release ${map.data.releaseId}`
              : "Loading the reviewed release…"}
            {settling && map.data ? " · settling layout" : ""}
          </p>
        </div>
        <div className="graph-map__actions">
          <button
            type="button"
            className="button"
            onClick={() => {
              fitViewRef.current();
              dirtyRef.current = true;
            }}
          >
            Fit to view
          </button>
          <button
            type="button"
            className="button"
            onClick={() => {
              layoutRef.current?.reheat();
              dirtyRef.current = true;
            }}
          >
            Re-lay out
          </button>
        </div>
      </header>

      <div className="graph-map__canvas-wrap">
        <canvas
          ref={canvasRef}
          className="graph-map__canvas"
          role="img"
          aria-label={
            map.data
              ? `Concept map of ${map.data.nodes.length} nodes. Use graph search and the relationship inspector for keyboard-accessible navigation.`
              : "Concept map loading"
          }
          onPointerDown={(event) => {
            event.currentTarget.setPointerCapture(event.pointerId);
            pointerRef.current = {
              dragging: true,
              x: event.clientX,
              y: event.clientY,
              moved: false,
            };
          }}
          onPointerMove={(event) => {
            const pointer = pointerRef.current;
            if (pointer.dragging) {
              const dx = event.clientX - pointer.x;
              const dy = event.clientY - pointer.y;
              if (Math.abs(dx) + Math.abs(dy) > 3) pointer.moved = true;
              viewRef.current.offsetX += dx;
              viewRef.current.offsetY += dy;
              pointer.x = event.clientX;
              pointer.y = event.clientY;
              dirtyRef.current = true;
              return;
            }
            const layout = layoutRef.current;
            if (!layout) return;
            const world = toWorld(event);
            const index = layout.pick(world.x, world.y, 16 / viewRef.current.scale);
            const layoutNode = index === null ? undefined : layout.nodes[index];
            const node = layoutNode ? (nodesById.get(layoutNode.id) ?? null) : null;
            setHovered(node);
          }}
          onPointerUp={(event) => {
            const pointer = pointerRef.current;
            pointer.dragging = false;
            const layout = layoutRef.current;
            if (!layout || pointer.moved) return;
            const world = toWorld(event);
            const index = layout.pick(world.x, world.y, 16 / viewRef.current.scale);
            const node = index === null ? undefined : layout.nodes[index];
            if (node) onSelect(node.id);
          }}
          onPointerCancel={() => {
            pointerRef.current.dragging = false;
          }}
        />
        {hovered && (
          <div className="graph-map__tooltip" role="status">
            <strong>{hovered.title}</strong>
            <span>{hovered.kind.replace(/_/g, " ")}</span>
          </div>
        )}
        {map.isError && <p role="alert">{(map.error as Error).message}</p>}
      </div>

      {map.data && (
        <ul className="graph-map__legend">
          {Object.entries(map.data.nodeKinds).map(([kind, count]) => (
            <li key={kind}>
              <span
                className="graph-map__swatch"
                style={{ background: colorFor(kind) }}
                aria-hidden="true"
              />
              {kind.replace(/_/g, " ")} ({count})
            </li>
          ))}
        </ul>
      )}

      {map.data && (
        <details className="graph-map__filter-panel">
          <summary>
            Map relationship layers · {Object.keys(map.data.legend).length - kindFilter.size} shown
          </summary>
          <fieldset className="graph-map__filters">
            <legend className="visually-hidden">Show relationship kinds on the map</legend>
            {Object.keys(map.data.legend).map((kind) => (
              <label key={kind}>
                <input
                  type="checkbox"
                  checked={!kindFilter.has(kind)}
                  onChange={(event) =>
                    setInactiveKinds((current) =>
                      event.target.checked
                        ? current.filter((entry) => entry !== kind)
                        : [...new Set([...current, kind])],
                    )
                  }
                />
                {kind.replace(/_/g, " ")}
              </label>
            ))}
          </fieldset>
        </details>
      )}
    </section>
  );
}
