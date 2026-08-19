import { describe, expect, it } from "vitest";

import { ForceLayout, nodeRadius } from "./graph-layout";

const input = {
  nodes: [
    { id: "near", kind: "concept", degree: 1 },
    { id: "far", kind: "lesson", degree: 100 },
  ],
  edges: [
    { source: "near", target: "far", kind: "practices" },
    { source: "near", target: "missing", kind: "ignored" },
  ],
};

describe("ForceLayout", () => {
  it("is deterministic and ignores dangling edges", () => {
    const first = new ForceLayout(input);
    const second = new ForceLayout(input);

    expect(first.nodes.map(({ x, y }) => [x, y])).toEqual(second.nodes.map(({ x, y }) => [x, y]));
    expect(first.edges).toHaveLength(1);
    expect(first.neighbors(0)).toEqual([1]);
  });

  it("picks the nearest eligible node even when a farther node is larger", () => {
    const layout = new ForceLayout(input);
    const [near, far] = layout.nodes;
    if (!near || !far) throw new Error("fixture nodes missing");
    Object.assign(near, { x: 0, y: 0, radius: 3 });
    Object.assign(far, { x: 10, y: 0, radius: 20 });

    expect(layout.pick(0, 0)).toBe(0);
    expect(layout.pick(100, 100)).toBeNull();
  });

  it("bounds node radius growth", () => {
    expect(nodeRadius(0)).toBe(3.2);
    expect(nodeRadius(1_000_000)).toBe(12.2);
  });
});
