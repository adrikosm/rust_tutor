/**
 * Dependency-free force-directed layout for the knowledge map.
 *
 * The graph ships thousands of nodes, so naive O(n^2) repulsion is not an
 * option. Repulsion is approximated with a uniform spatial hash: each node only
 * repels peers inside neighbouring cells, which is the interaction range that
 * actually matters once the layout has spread out. Attraction runs over edges,
 * and a weak gravity keeps disconnected components from drifting away.
 *
 * The simulation is deterministic: initial positions come from a seeded PRNG so
 * reloading the page reproduces the same map and learners keep their spatial
 * memory of where concepts live.
 */

export type LayoutNode = {
  id: string;
  kind: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  /** Fixed in place while the learner drags it. */
  pinned: boolean;
};

export type LayoutEdge = { source: number; target: number; kind: string };

export type LayoutInput = {
  nodes: Array<{ id: string; kind: string; degree: number }>;
  edges: Array<{ source: string; target: string; kind: string }>;
};

/** Edge kinds that describe curriculum order get a shorter, stiffer spring. */
const STRUCTURAL_EDGES = new Set([
  "requires",
  "prerequisite_of",
  "builds_on",
  "unlocks",
  "part_of",
  "teaches",
  "practices",
]);

function mulberry32(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function nodeRadius(degree: number): number {
  return 3.2 + Math.min(9, Math.sqrt(degree) * 1.55);
}

export class ForceLayout {
  readonly nodes: LayoutNode[] = [];
  readonly edges: LayoutEdge[] = [];
  readonly indexById = new Map<string, number>();
  /** Cooling factor: drops toward zero as the layout settles. */
  alpha = 1;

  private readonly cellSize: number;
  private readonly grid = new Map<number, number[]>();
  private readonly adjacency: number[][] = [];

  constructor(input: LayoutInput) {
    const random = mulberry32(0x52555354); // "RUST"
    const count = Math.max(1, input.nodes.length);
    const spread = Math.sqrt(count) * 34;

    input.nodes.forEach((node, index) => {
      this.indexById.set(node.id, index);
      // Seeded golden-angle spiral: an even, deterministic starting spread that
      // converges far faster than uniform random placement.
      const angle = index * 2.399963229728653;
      const distance = spread * Math.sqrt((index + random() * 0.5) / count);
      this.nodes.push({
        id: node.id,
        kind: node.kind,
        x: Math.cos(angle) * distance,
        y: Math.sin(angle) * distance,
        vx: 0,
        vy: 0,
        radius: nodeRadius(node.degree),
        pinned: false,
      });
      this.adjacency.push([]);
    });

    for (const edge of input.edges) {
      const source = this.indexById.get(edge.source);
      const target = this.indexById.get(edge.target);
      if (source === undefined || target === undefined || source === target) continue;
      this.edges.push({ source, target, kind: edge.kind });
      this.adjacency[source]?.push(target);
      this.adjacency[target]?.push(source);
    }

    this.cellSize = 48;
  }

  neighbors(index: number): number[] {
    return this.adjacency[index] ?? [];
  }

  private rebuildGrid() {
    this.grid.clear();
    for (const [index, node] of this.nodes.entries()) {
      const key = this.cellKey(node.x, node.y);
      const bucket = this.grid.get(key);
      if (bucket) bucket.push(index);
      else this.grid.set(key, [index]);
    }
  }

  private cellKey(x: number, y: number): number {
    const column = Math.floor(x / this.cellSize);
    const row = Math.floor(y / this.cellSize);
    // Pack two signed 16-bit coordinates into one integer key.
    return ((column & 0xffff) << 16) | (row & 0xffff);
  }

  /** Advance the simulation one frame. Returns the current alpha. */
  tick(): number {
    if (this.alpha < 0.005) return this.alpha;
    this.rebuildGrid();

    const repulsion = 340 * this.alpha;
    for (const bucket of this.grid.values()) {
      for (const index of bucket) {
        const node = this.nodes[index];
        if (!node) continue;
        const column = Math.floor(node.x / this.cellSize);
        const row = Math.floor(node.y / this.cellSize);
        for (let dc = -1; dc <= 1; dc += 1) {
          for (let dr = -1; dr <= 1; dr += 1) {
            const peers = this.grid.get((((column + dc) & 0xffff) << 16) | ((row + dr) & 0xffff));
            if (!peers) continue;
            for (const peerIndex of peers) {
              if (peerIndex <= index) continue;
              const peer = this.nodes[peerIndex];
              if (!peer) continue;
              let dx = node.x - peer.x;
              let dy = node.y - peer.y;
              let distanceSquared = dx * dx + dy * dy;
              if (distanceSquared === 0) {
                dx = (index % 7) - 3 || 1;
                dy = (peerIndex % 5) - 2 || 1;
                distanceSquared = dx * dx + dy * dy;
              }
              if (distanceSquared > this.cellSize * this.cellSize * 4) continue;
              const force = repulsion / distanceSquared;
              const distance = Math.sqrt(distanceSquared);
              const fx = (dx / distance) * force;
              const fy = (dy / distance) * force;
              node.vx += fx;
              node.vy += fy;
              peer.vx -= fx;
              peer.vy -= fy;
            }
          }
        }
      }
    }

    for (const edge of this.edges) {
      const source = this.nodes[edge.source];
      const target = this.nodes[edge.target];
      if (!source || !target) continue;
      const dx = target.x - source.x;
      const dy = target.y - source.y;
      const distance = Math.sqrt(dx * dx + dy * dy) || 0.01;
      const rest = STRUCTURAL_EDGES.has(edge.kind) ? 46 : 78;
      const stiffness = (STRUCTURAL_EDGES.has(edge.kind) ? 0.055 : 0.028) * this.alpha;
      const force = (distance - rest) * stiffness;
      const fx = (dx / distance) * force;
      const fy = (dy / distance) * force;
      source.vx += fx;
      source.vy += fy;
      target.vx -= fx;
      target.vy -= fy;
    }

    const gravity = 0.014 * this.alpha;
    for (const node of this.nodes) {
      if (node.pinned) {
        node.vx = 0;
        node.vy = 0;
        continue;
      }
      node.vx -= node.x * gravity;
      node.vy -= node.y * gravity;
      node.vx *= 0.82;
      node.vy *= 0.82;
      // Clamp per-frame travel so an early high-energy frame cannot fling
      // nodes off-screen before the layout cools.
      node.x += Math.max(-24, Math.min(24, node.vx));
      node.y += Math.max(-24, Math.min(24, node.vy));
    }

    this.alpha *= 0.984;
    return this.alpha;
  }

  /** Reheat after an interaction that invalidates the settled layout. */
  reheat(to = 0.45) {
    this.alpha = Math.max(this.alpha, to);
  }

  bounds() {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const node of this.nodes) {
      if (node.x < minX) minX = node.x;
      if (node.y < minY) minY = node.y;
      if (node.x > maxX) maxX = node.x;
      if (node.y > maxY) maxY = node.y;
    }
    if (!Number.isFinite(minX)) return { minX: -1, minY: -1, maxX: 1, maxY: 1 };
    return { minX, minY, maxX, maxY };
  }

  /** Nearest node to a world-space point, within `tolerance` world units. */
  pick(x: number, y: number, tolerance = 14): number | null {
    let best: number | null = null;
    let bestDistance = Infinity;
    for (const [index, node] of this.nodes.entries()) {
      const dx = node.x - x;
      const dy = node.y - y;
      const distance = dx * dx + dy * dy;
      const reach = Math.max(tolerance, node.radius + 4) ** 2;
      if (distance <= reach && distance < bestDistance) {
        bestDistance = distance;
        best = index;
      }
    }
    return best;
  }
}
