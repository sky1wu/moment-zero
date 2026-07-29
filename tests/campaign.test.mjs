import assert from "node:assert/strict";
import test from "node:test";
import {
  CAMPAIGN_HINT_CAPACITY,
  CAMPAIGN_HINT_RECOVERY_AMOUNT,
  CAMPAIGN_HINT_RECOVERY_INTERVAL,
  CAMPAIGN_INITIAL_HINTS,
  CAMPAIGN_LEVELS,
  CAMPAIGN_TOTAL,
  CAMPAIGN_VERSION,
  getCampaignUnlockedThrough,
  parseCampaignProgress,
  recoverCampaignHints,
} from "../app/campaign.ts";
import { generatePuzzle } from "../app/game-core.ts";

function classifyPattern(puzzle) {
  const points = new Set(
    puzzle.mounts.map((mount) => `${mount.column - 2}:${2 - mount.row}`),
  );
  const everyPointHas = (mirror) =>
    puzzle.mounts.every((mount) =>
      points.has(mirror(mount.column - 2, 2 - mount.row)),
    );

  if (everyPointHas((x, y) => `${-x}:${-y}`)) return "central";
  if (
    everyPointHas((x, y) => `${-x}:${y}`) ||
    everyPointHas((x, y) => `${x}:${-y}`)
  ) {
    return "axis";
  }
  return "freeform";
}

test("defines one fixed, progressively tiered 100-level campaign", () => {
  assert.equal(CAMPAIGN_LEVELS.length, CAMPAIGN_TOTAL);
  assert.equal(new Set(CAMPAIGN_LEVELS.map((level) => level.seed)).size, 100);
  assert.deepEqual(
    CAMPAIGN_LEVELS.reduce(
      (counts, level) => ({
        ...counts,
        [level.difficulty]: counts[level.difficulty] + 1,
      }),
      { easy: 0, normal: 0, hard: 0 },
    ),
    { easy: 30, normal: 40, hard: 30 },
  );
  assert.deepEqual(
    CAMPAIGN_LEVELS.reduce(
      (counts, level) => ({
        ...counts,
        [level.pattern]: counts[level.pattern] + 1,
      }),
      { central: 0, axis: 0, freeform: 0 },
    ),
    { central: 50, axis: 40, freeform: 10 },
  );
});

test("all campaign seeds generate the promised unique puzzle geometry", () => {
  for (const level of CAMPAIGN_LEVELS) {
    const puzzle = generatePuzzle(level.seed, level.difficulty);
    assert.equal(
      classifyPattern(puzzle),
      level.pattern,
      `level ${level.number} geometry`,
    );
  }
});

test("campaign progress restores safely and never unlocks past the first gap", () => {
  assert.equal(getCampaignUnlockedThrough([1, 2, 3]), 4);
  assert.equal(getCampaignUnlockedThrough([1, 3, 4]), 2);

  const progress = parseCampaignProgress(
    JSON.stringify({
      version: CAMPAIGN_VERSION,
      currentLevel: 99,
      completed: [3, 1, 1, 2, 999],
      hintBalance: 2.8,
      inProgress: {
        level: 4,
        assignments: { p1: 2, p2: 8, invalid: 1 },
        moves: 12.8,
        hints: -5,
        elapsed: 42.9,
      },
    }),
  );

  assert.deepEqual(progress.completed, [1, 2, 3]);
  assert.equal(progress.currentLevel, 4);
  assert.equal(progress.hintBalance, 2);
  assert.deepEqual(progress.inProgress, {
    level: 4,
    assignments: { p1: 2 },
    moves: 12,
    hints: 0,
    elapsed: 42,
  });
  assert.deepEqual(parseCampaignProgress("{broken"), {
    version: CAMPAIGN_VERSION,
    currentLevel: 1,
    completed: [],
    hintBalance: CAMPAIGN_INITIAL_HINTS,
    inProgress: null,
  });
});

test("campaign hints are shared, capped, and recover only at milestones", () => {
  assert.equal(CAMPAIGN_INITIAL_HINTS, 5);
  assert.equal(CAMPAIGN_HINT_CAPACITY, 5);
  assert.equal(CAMPAIGN_HINT_RECOVERY_INTERVAL, 5);
  assert.equal(CAMPAIGN_HINT_RECOVERY_AMOUNT, 1);
  assert.equal(recoverCampaignHints(0, 4), 0);
  assert.equal(recoverCampaignHints(0, 5), 1);
  assert.equal(recoverCampaignHints(4, 10), 5);
  assert.equal(recoverCampaignHints(5, 15), 5);
  assert.equal(recoverCampaignHints(2, 16), 2);
  assert.equal(
    parseCampaignProgress(
      JSON.stringify({
        version: CAMPAIGN_VERSION,
        currentLevel: 3,
        completed: [1, 2],
        inProgress: null,
      }),
    ).hintBalance,
    CAMPAIGN_INITIAL_HINTS,
  );
});
