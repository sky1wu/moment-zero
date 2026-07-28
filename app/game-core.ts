export const LEVELS = [1, 2, 3, 4] as const;
export type BalloonLevel = (typeof LEVELS)[number];
export type SlotLevel = 0 | BalloonLevel;
export type Difficulty = "easy" | "normal" | "hard";

export const LIFT_BY_LEVEL: Record<BalloonLevel, number> = {
  1: 1,
  2: 2,
  3: 3,
  4: 6,
};

export const DIFFICULTY_LABELS: Record<Difficulty, string> = {
  easy: "入门",
  normal: "标准",
  hard: "专家",
};

export const BALLOON_COUNT_RANGES: Record<Difficulty, readonly [number, number]> = {
  easy: [3, 5],
  normal: [4, 6],
  hard: [6, 7],
};

export interface MountPoint {
  id: string;
  row: number;
  column: number;
  multiplier: 1 | 2 | 3;
}

export interface Puzzle {
  seed: string;
  difficulty: Difficulty;
  size: number;
  mounts: MountPoint[];
  counts: Record<BalloonLevel, number>;
  solution: Record<string, SlotLevel>;
  diagnostics: {
    searchStates: number;
    attempts: number;
    obviousPairs: number;
  };
}

interface Combo {
  level: BalloonLevel;
  multiplier: 1 | 2 | 3;
}

type PatternMode = "central" | "axis" | "freeform";
type SymmetryAxis = "vertical" | "horizontal";

interface DraftMount extends MountPoint {
  solutionLevel: SlotLevel;
}

interface SolveResult {
  count: number;
  first: Record<string, SlotLevel> | null;
  states: number;
}

const COMBOS_BY_EFFECTIVE: Record<number, Combo[]> = {
  1: [{ level: 1, multiplier: 1 }],
  2: [
    { level: 1, multiplier: 2 },
    { level: 2, multiplier: 1 },
  ],
  3: [
    { level: 1, multiplier: 3 },
    { level: 3, multiplier: 1 },
  ],
  4: [{ level: 2, multiplier: 2 }],
  6: [
    { level: 2, multiplier: 3 },
    { level: 3, multiplier: 2 },
    { level: 4, multiplier: 1 },
  ],
};

function hashSeed(input: string) {
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function makeRng(seed: string) {
  let state = hashSeed(seed) || 0x9e3779b9;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function integer(rng: () => number, min: number, max: number) {
  return Math.floor(rng() * (max - min + 1)) + min;
}

function pick<T>(rng: () => number, values: readonly T[]): T {
  return values[Math.floor(rng() * values.length)];
}

function shuffle<T>(rng: () => number, values: readonly T[]) {
  const result = [...values];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const target = Math.floor(rng() * (index + 1));
    [result[index], result[target]] = [result[target], result[index]];
  }
  return result;
}

function positionKey(x: number, y: number) {
  return `${x}:${y}`;
}

function toGrid(size: number, x: number, y: number) {
  const center = (size - 1) / 2;
  return {
    row: center - y,
    column: center + x,
  };
}

function countLevels(mounts: DraftMount[]) {
  const counts: Record<BalloonLevel, number> = { 1: 0, 2: 0, 3: 0, 4: 0 };
  for (const mount of mounts) {
    if (mount.solutionLevel !== 0) counts[mount.solutionLevel] += 1;
  }
  return counts;
}

function compareSolutions(
  left: Record<string, SlotLevel>,
  right: Record<string, SlotLevel>,
) {
  const ids = Object.keys(left);
  return ids.every((id) => left[id] === right[id]);
}

export function coordinates(size: number, point: MountPoint) {
  const center = (size - 1) / 2;
  return {
    x: (point.column - center) * point.multiplier,
    y: (center - point.row) * point.multiplier,
  };
}

export function calculateMoment(
  puzzle: Pick<Puzzle, "size" | "mounts">,
  assignments: Record<string, SlotLevel>,
) {
  let x = 0;
  let y = 0;
  let placed = 0;
  for (const point of puzzle.mounts) {
    const level = assignments[point.id] ?? 0;
    if (level === 0) continue;
    const lift = LIFT_BY_LEVEL[level];
    const coordinate = coordinates(puzzle.size, point);
    x += lift * coordinate.x;
    y += lift * coordinate.y;
    placed += 1;
  }
  return { x, y, placed };
}

export function solvePuzzle(
  puzzle: Pick<Puzzle, "size" | "mounts" | "counts">,
  limit = 2,
): SolveResult {
  const ordered = [...puzzle.mounts].sort((left, right) => {
    const a = coordinates(puzzle.size, left);
    const b = coordinates(puzzle.size, right);
    return (
      Math.abs(b.x) +
      Math.abs(b.y) -
      Math.abs(a.x) -
      Math.abs(a.y) ||
      left.id.localeCompare(right.id)
    );
  });
  const totalBalloons = LEVELS.reduce(
    (sum, level) => sum + puzzle.counts[level],
    0,
  );
  const totals = [
    ordered.length - totalBalloons,
    puzzle.counts[1],
    puzzle.counts[2],
    puzzle.counts[3],
    puzzle.counts[4],
  ];
  if (totals.some((count) => count < 0)) {
    return { count: 0, first: null, states: 0 };
  }

  const split = Math.floor(ordered.length / 2);
  const leftPoints = ordered.slice(0, split);
  const rightPoints = ordered.slice(split);
  const leftMap = new Map<
    string,
    Array<{ levels: SlotLevel[]; counts: number[] }>
  >();
  let states = 0;

  const makeKey = (counts: number[], x: number, y: number) =>
    `${counts.join(",")}|${x}|${y}`;

  function enumerateLeft(
    index: number,
    used: number[],
    momentX: number,
    momentY: number,
    levels: SlotLevel[],
  ) {
    states += 1;
    if (index === leftPoints.length) {
      const key = makeKey(used, momentX, momentY);
      const bucket = leftMap.get(key) ?? [];
      if (bucket.length < limit) {
        bucket.push({ levels: [...levels], counts: [...used] });
        leftMap.set(key, bucket);
      }
      return;
    }
    const point = leftPoints[index];
    const coordinate = coordinates(puzzle.size, point);
    for (let level = 0; level <= 4; level += 1) {
      if (used[level] >= totals[level]) continue;
      used[level] += 1;
      levels.push(level as SlotLevel);
      const lift = level === 0 ? 0 : LIFT_BY_LEVEL[level as BalloonLevel];
      enumerateLeft(
        index + 1,
        used,
        momentX + lift * coordinate.x,
        momentY + lift * coordinate.y,
        levels,
      );
      levels.pop();
      used[level] -= 1;
    }
  }

  enumerateLeft(0, [0, 0, 0, 0, 0], 0, 0, []);

  let solutionCount = 0;
  let first: Record<string, SlotLevel> | null = null;

  function enumerateRight(
    index: number,
    used: number[],
    momentX: number,
    momentY: number,
    levels: SlotLevel[],
  ): boolean {
    states += 1;
    if (index === rightPoints.length) {
      const needed = totals.map((total, level) => total - used[level]);
      if (needed.some((count) => count < 0)) return false;
      const matches = leftMap.get(makeKey(needed, -momentX, -momentY));
      if (!matches) return false;
      for (const match of matches) {
        solutionCount += 1;
        if (!first) {
          first = {};
          leftPoints.forEach((point, pointIndex) => {
            first![point.id] = match.levels[pointIndex];
          });
          rightPoints.forEach((point, pointIndex) => {
            first![point.id] = levels[pointIndex];
          });
        }
        if (solutionCount >= limit) return true;
      }
      return false;
    }
    const point = rightPoints[index];
    const coordinate = coordinates(puzzle.size, point);
    for (let level = 0; level <= 4; level += 1) {
      if (used[level] >= totals[level]) continue;
      used[level] += 1;
      levels.push(level as SlotLevel);
      const lift = level === 0 ? 0 : LIFT_BY_LEVEL[level as BalloonLevel];
      if (
        enumerateRight(
          index + 1,
          used,
          momentX + lift * coordinate.x,
          momentY + lift * coordinate.y,
          levels,
        )
      ) {
        return true;
      }
      levels.pop();
      used[level] -= 1;
    }
    return false;
  }

  enumerateRight(0, [0, 0, 0, 0, 0], 0, 0, []);
  return { count: solutionCount, first, states };
}

function createCandidate(
  seed: string,
  difficulty: Difficulty,
  attempt: number,
) {
  const rng = makeRng(`${seed}:${difficulty}:${attempt}`);
  const size = 5;
  const radius = (size - 1) / 2;
  const used = new Set<string>();
  const mounts: DraftMount[] = [];

  function addPoint(
    x: number,
    y: number,
    combo: Combo | null,
    multiplier?: 1 | 2 | 3,
  ) {
    const grid = toGrid(size, x, y);
    const point: DraftMount = {
      id: `p${mounts.length + 1}`,
      row: grid.row,
      column: grid.column,
      multiplier: combo?.multiplier ?? multiplier ?? 1,
      solutionLevel: combo?.level ?? 0,
    };
    mounts.push(point);
    used.add(positionKey(x, y));
  }

  function randomUnusedPoint(requireOpposite = false) {
    for (let tries = 0; tries < 80; tries += 1) {
      const x = integer(rng, -radius, radius);
      const y = integer(rng, -radius, radius);
      if (requireOpposite && x === 0 && y === 0) continue;
      if (used.has(positionKey(x, y))) continue;
      if (requireOpposite && used.has(positionKey(-x, -y))) continue;
      return { x, y };
    }
    return null;
  }

  function addPair(effective: 2 | 3 | 6) {
    const point = randomUnusedPoint(true);
    if (!point) return false;
    const combos = shuffle(rng, COMBOS_BY_EFFECTIVE[effective]);
    const first = combos[0];
    const second = combos[1] ?? combos[0];
    addPoint(point.x, point.y, first);
    addPoint(-point.x, -point.y, second);
    return true;
  }

  function addAxisBalancedPair(axis: SymmetryAxis) {
    for (const distance of shuffle(rng, [1, 2] as const)) {
      const points =
        axis === "vertical"
          ? [
              { x: 0, y: distance },
              { x: 0, y: -distance },
            ]
          : [
              { x: distance, y: 0 },
              { x: -distance, y: 0 },
            ];
      if (points.some((point) => used.has(positionKey(point.x, point.y)))) {
        continue;
      }
      const effective = pick(rng, [2, 3, 6] as const);
      const combos = shuffle(rng, COMBOS_BY_EFFECTIVE[effective]);
      addPoint(points[0].x, points[0].y, combos[0]);
      addPoint(points[1].x, points[1].y, combos[1] ?? combos[0]);
      return true;
    }
    return false;
  }

  function addAxisRectangle() {
    for (let tries = 0; tries < 40; tries += 1) {
      const x = pick(rng, [1, 2] as const);
      const y = pick(rng, [1, 2] as const);
      const points = [
        { x, y },
        { x: -x, y },
        { x, y: -y },
        { x: -x, y: -y },
      ];
      if (points.some((point) => used.has(positionKey(point.x, point.y)))) {
        continue;
      }
      const effective = pick(rng, [2, 3, 6] as const);
      const combos = shuffle(rng, COMBOS_BY_EFFECTIVE[effective]);
      points.forEach((point, index) => {
        addPoint(point.x, point.y, combos[index % combos.length]);
      });
      return true;
    }
    return false;
  }

  function addAxisTriangle(axis: SymmetryAxis) {
    for (let tries = 0; tries < 40; tries += 1) {
      const spread = pick(rng, [1, 2] as const);
      const offset = pick(rng, [-1, 1] as const);
      const points =
        axis === "vertical"
          ? [
              { x: -spread, y: offset },
              { x: spread, y: offset },
              { x: 0, y: -2 * offset },
            ]
          : [
              { x: offset, y: -spread },
              { x: offset, y: spread },
              { x: -2 * offset, y: 0 },
            ];
      if (points.some((point) => used.has(positionKey(point.x, point.y)))) {
        continue;
      }
      const combos = shuffle(rng, COMBOS_BY_EFFECTIVE[6]);
      points.forEach((point, index) => addPoint(point.x, point.y, combos[index]));
      return true;
    }
    return false;
  }

  function addSymmetricDistractorPair(
    mode: Exclude<PatternMode, "freeform">,
    axis: SymmetryAxis,
  ) {
    for (let tries = 0; tries < 80; tries += 1) {
      const point = randomUnusedPoint(mode === "central");
      if (!point) return false;
      const mirror =
        mode === "central"
          ? { x: -point.x, y: -point.y }
          : axis === "vertical"
            ? { x: -point.x, y: point.y }
            : { x: point.x, y: -point.y };
      if (
        positionKey(point.x, point.y) === positionKey(mirror.x, mirror.y) ||
        used.has(positionKey(mirror.x, mirror.y))
      ) {
        continue;
      }
      const multiplier = pick(
        rng,
        difficulty === "hard" ? ([1, 2, 3] as const) : ([1, 2] as const),
      );
      addPoint(point.x, point.y, null, multiplier);
      addPoint(mirror.x, mirror.y, null, multiplier);
      return true;
    }
    return false;
  }

  function addTriangle() {
    for (let tries = 0; tries < 120; tries += 1) {
      const first = randomUnusedPoint();
      const second = randomUnusedPoint();
      if (!first || !second) continue;
      const third = {
        x: -first.x - second.x,
        y: -first.y - second.y,
      };
      const determinant = first.x * second.y - second.x * first.y;
      const keys = [first, second, third].map((point) =>
        positionKey(point.x, point.y),
      );
      const includesCenter = keys.includes(positionKey(0, 0));
      if (
        (determinant === 0 && !includesCenter) ||
        Math.abs(third.x) > radius ||
        Math.abs(third.y) > radius ||
        new Set(keys).size !== 3 ||
        keys.some((key) => used.has(key))
      ) {
        continue;
      }
      const combos = shuffle(rng, COMBOS_BY_EFFECTIVE[6]);
      addPoint(first.x, first.y, combos[0]);
      addPoint(second.x, second.y, combos[1]);
      addPoint(third.x, third.y, combos[2]);
      return true;
    }
    return false;
  }

  function addFreeformGroup(pointCount: number) {
    const effectiveValues = [1, 2, 3, 4, 6] as const;
    for (let tries = 0; tries < 900; tries += 1) {
      const draft: Array<{ x: number; y: number; combo: Combo; effective: number }> =
        [];
      const localUsed = new Set<string>();
      let sumX = 0;
      let sumY = 0;

      for (let index = 0; index < pointCount - 1; index += 1) {
        let point: { x: number; y: number } | null = null;
        for (let pointTry = 0; pointTry < 40; pointTry += 1) {
          const candidate = {
            x: integer(rng, -radius, radius),
            y: integer(rng, -radius, radius),
          };
          const key = positionKey(candidate.x, candidate.y);
          if (used.has(key) || localUsed.has(key)) {
            continue;
          }
          point = candidate;
          localUsed.add(key);
          break;
        }
        if (!point) break;
        const effective = pick(rng, effectiveValues);
        const combo = pick(rng, COMBOS_BY_EFFECTIVE[effective]);
        draft.push({ ...point, combo, effective });
        sumX += effective * point.x;
        sumY += effective * point.y;
      }

      if (draft.length !== pointCount - 1) continue;
      for (const effective of shuffle(rng, effectiveValues)) {
        if (sumX % effective !== 0 || sumY % effective !== 0) continue;
        const finalPoint = {
          x: -sumX / effective,
          y: -sumY / effective,
        };
        const finalKey = positionKey(finalPoint.x, finalPoint.y);
        if (
          Math.abs(finalPoint.x) > radius ||
          Math.abs(finalPoint.y) > radius ||
          used.has(finalKey) ||
          localUsed.has(finalKey)
        ) {
          continue;
        }
        const finalCombo = pick(rng, COMBOS_BY_EFFECTIVE[effective]);
        const complete = [...draft, { ...finalPoint, combo: finalCombo, effective }];
        const levelVariety = new Set(complete.map((item) => item.combo.level)).size;
        if (levelVariety < 3) continue;
        for (const item of complete) addPoint(item.x, item.y, item.combo);
        return true;
      }
    }
    return false;
  }

  const [minimumBalloons, maximumBalloons] = BALLOON_COUNT_RANGES[difficulty];
  const balloonCount = integer(rng, minimumBalloons, maximumBalloons);
  let patternMode: PatternMode = pick(
    rng,
    balloonCount % 2 === 0
      ? (["central", "central", "central", "axis", "axis", "freeform"] as const)
      : (["axis", "axis", "axis", "freeform", "freeform"] as const),
  );
  const symmetryAxis = pick(rng, ["vertical", "horizontal"] as const);
  let constructed = true;

  if (patternMode === "central") {
    for (let index = 0; index < balloonCount / 2; index += 1) {
      constructed = addPair(pick(rng, [2, 3, 6] as const)) && constructed;
    }
  } else if (patternMode === "axis") {
    let remaining = balloonCount;
    if (remaining % 2 === 1) {
      constructed = addAxisTriangle(symmetryAxis);
      remaining -= 3;
    } else {
      constructed = addAxisRectangle();
      remaining -= 4;
    }
    if (constructed && remaining === 4) {
      constructed = addAxisRectangle();
      remaining -= 4;
    }
    while (constructed && remaining >= 2) {
      constructed = addAxisBalancedPair(symmetryAxis);
      remaining -= 2;
    }
  } else {
    constructed = addFreeformGroup(balloonCount);
  }

  if (!constructed) {
    mounts.length = 0;
    used.clear();
    patternMode = "freeform";
    if (!addFreeformGroup(balloonCount)) {
      if (balloonCount % 2 === 1) addTriangle();
      for (
        let index = 0;
        index < Math.floor((balloonCount - (balloonCount % 2 === 1 ? 3 : 0)) / 2);
        index += 1
      ) {
        addPair(pick(rng, [2, 3, 6] as const));
      }
    }
  }

  if (patternMode === "freeform") {
    const distractors = difficulty === "hard" ? 3 : 1;
    for (let index = 0; index < distractors; index += 1) {
      const point = randomUnusedPoint();
      if (point) {
        addPoint(
          point.x,
          point.y,
          null,
          pick(rng, difficulty === "hard" ? ([1, 2, 3] as const) : ([1, 2] as const)),
        );
      }
    }
  } else {
    addSymmetricDistractorPair(patternMode, symmetryAxis);
  }

  const shuffledMounts = shuffle(rng, mounts).map((mount, index) => ({
    ...mount,
    id: `p${index + 1}`,
  }));
  const counts = countLevels(shuffledMounts);
  const intended = Object.fromEntries(
    shuffledMounts.map((mount) => [mount.id, mount.solutionLevel]),
  ) as Record<string, SlotLevel>;

  return { size, mounts: shuffledMounts, counts, intended };
}

function countObviousPairs(size: number, mounts: MountPoint[]) {
  let pairs = 0;
  for (let first = 0; first < mounts.length; first += 1) {
    const a = coordinates(size, { ...mounts[first], multiplier: 1 });
    for (let second = first + 1; second < mounts.length; second += 1) {
      const b = coordinates(size, { ...mounts[second], multiplier: 1 });
      if (a.x === -b.x && a.y === -b.y) pairs += 1;
    }
  }
  return pairs;
}

export function generatePuzzle(seed: string, difficulty: Difficulty): Puzzle {
  const maximumAttempts = difficulty === "hard" ? 320 : 180;

  for (let attempt = 1; attempt <= maximumAttempts; attempt += 1) {
    const candidate = createCandidate(seed, difficulty, attempt);
    if (candidate.mounts.length < 2) continue;
    const bare = {
      size: candidate.size,
      mounts: candidate.mounts.map(({ id, row, column, multiplier }) => ({
        id,
        row,
        column,
        multiplier,
      })),
      counts: candidate.counts,
    };
    const solved = solvePuzzle(bare, 2);
    if (!solved.first) continue;

    const puzzle: Puzzle = {
      seed,
      difficulty,
      ...bare,
      solution: solved.first,
      diagnostics: {
        searchStates: solved.states,
        attempts: attempt,
        obviousPairs: countObviousPairs(candidate.size, bare.mounts),
      },
    };
    if (solved.count === 1 && compareSolutions(solved.first, candidate.intended)) {
      return puzzle;
    }
  }

  throw new Error("暂时无法生成有效题目，请更换种子重试。");
}

export function totalBalloons(counts: Record<BalloonLevel, number>) {
  return LEVELS.reduce((sum, level) => sum + counts[level], 0);
}

export function formatSeed(raw: string) {
  const cleaned = raw.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8);
  return cleaned ? `MZ-${cleaned}` : "MZ-0000";
}

export function createRandomSeed() {
  const alphabet = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
  const bytes = new Uint32Array(6);
  if (typeof crypto !== "undefined" && crypto.getRandomValues) {
    crypto.getRandomValues(bytes);
  } else {
    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] = Math.floor(Math.random() * 0xffffffff);
    }
  }
  return `MZ-${Array.from(bytes, (value) => alphabet[value % alphabet.length]).join("")}`;
}
