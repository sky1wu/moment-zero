import type { Difficulty, SlotLevel } from "./game-core";

export const CAMPAIGN_VERSION = 1;
export const CAMPAIGN_STORAGE_KEY = `moment-zero-campaign:v${CAMPAIGN_VERSION}`;
export const CAMPAIGN_TOTAL = 100;

export type CampaignPattern = "central" | "axis" | "freeform";

export type CampaignLevel = {
  number: number;
  seed: string;
  difficulty: Difficulty;
  pattern: CampaignPattern;
  chapter: number;
};

export type CampaignSnapshot = {
  level: number;
  assignments: Record<string, SlotLevel>;
  moves: number;
  hints: number;
  elapsed: number;
};

export type CampaignProgress = {
  version: typeof CAMPAIGN_VERSION;
  currentLevel: number;
  completed: number[];
  inProgress: CampaignSnapshot | null;
};

export const CAMPAIGN_CHAPTERS = [
  { number: 1, title: "初航校准", range: "01—10" },
  { number: 2, title: "静轴练习", range: "11—20" },
  { number: 3, title: "镜面回路", range: "21—30" },
  { number: 4, title: "重心迁移", range: "31—40" },
  { number: 5, title: "双轴交汇", range: "41—50" },
  { number: 6, title: "异形扰动", range: "51—60" },
  { number: 7, title: "高载平衡", range: "61—70" },
  { number: 8, title: "深空校核", range: "71—80" },
  { number: 9, title: "极限回收", range: "81—90" },
  { number: 10, title: "零矩终局", range: "91—100" },
] as const;

const CAMPAIGN_SEED_NUMBERS = [
  4, 6, 8, 11, 14, 17, 19, 21, 34, 35,
  38, 40, 41, 42, 47, 50, 52, 53, 59, 60,
  65, 66, 70, 71, 78, 80, 95, 99, 101, 102,
  104, 106, 108, 113, 114, 115, 127, 129, 134, 136,
  138, 141, 142, 144, 150, 151, 152, 157, 159, 163,
  172, 174, 175, 176, 179, 180, 181, 183, 184, 186,
  187, 190, 191, 193, 194, 196, 199, 203, 204, 205,
  206, 207, 208, 209, 211, 212, 215, 218, 220, 232,
  234, 235, 236, 237, 241, 242, 243, 245, 246, 247,
  253, 254, 256, 258, 260, 261, 263, 265, 268, 279,
] as const;

const CAMPAIGN_PATTERN_SEQUENCE: readonly CampaignPattern[] = [
  "central",
  "axis",
  "central",
  "axis",
  "central",
  "axis",
  "central",
  "axis",
  "central",
  "freeform",
];

export const CAMPAIGN_PATTERN_LABELS: Record<CampaignPattern, string> = {
  central: "中心",
  axis: "轴向",
  freeform: "异形",
};

export const CAMPAIGN_LEVELS: readonly CampaignLevel[] =
  CAMPAIGN_SEED_NUMBERS.map((seedNumber, index) => {
    const number = index + 1;
    return {
      number,
      seed: `MZ-C${String(seedNumber).padStart(7, "0")}`,
      difficulty: number <= 30 ? "easy" : number <= 70 ? "normal" : "hard",
      pattern: CAMPAIGN_PATTERN_SEQUENCE[index % CAMPAIGN_PATTERN_SEQUENCE.length],
      chapter: Math.floor(index / 10) + 1,
    };
  });

export function getCampaignLevel(levelNumber: number) {
  const normalized = Math.max(1, Math.min(CAMPAIGN_TOTAL, Math.floor(levelNumber)));
  return CAMPAIGN_LEVELS[normalized - 1];
}

export function getCampaignChapter(levelNumber: number) {
  return CAMPAIGN_CHAPTERS[Math.floor((getCampaignLevel(levelNumber).number - 1) / 10)];
}

export function getCampaignUnlockedThrough(completed: readonly number[]) {
  const completedSet = new Set(completed);
  let level = 1;
  while (level < CAMPAIGN_TOTAL && completedSet.has(level)) level += 1;
  return level;
}

export function createCampaignProgress(): CampaignProgress {
  return {
    version: CAMPAIGN_VERSION,
    currentLevel: 1,
    completed: [],
    inProgress: null,
  };
}

export function parseCampaignProgress(raw: string | null): CampaignProgress {
  if (!raw) return createCampaignProgress();
  try {
    const data = JSON.parse(raw) as Partial<CampaignProgress>;
    if (data.version !== CAMPAIGN_VERSION) return createCampaignProgress();

    const completed = Array.isArray(data.completed)
      ? Array.from(
          new Set(
            data.completed
              .filter(
                (level): level is number =>
                  Number.isInteger(level) && level >= 1 && level <= CAMPAIGN_TOTAL,
              )
              .sort((left, right) => left - right),
          ),
        )
      : [];
    const unlockedThrough = getCampaignUnlockedThrough(completed);
    const snapshot = parseCampaignSnapshot(data.inProgress, completed);
    const requestedLevel =
      snapshot?.level ??
      (Number.isInteger(data.currentLevel) ? Number(data.currentLevel) : unlockedThrough);

    return {
      version: CAMPAIGN_VERSION,
      currentLevel: Math.max(1, Math.min(unlockedThrough, requestedLevel)),
      completed,
      inProgress: snapshot,
    };
  } catch {
    return createCampaignProgress();
  }
}

function parseCampaignSnapshot(
  value: CampaignProgress["inProgress"] | undefined,
  completed: readonly number[],
): CampaignSnapshot | null {
  if (
    !value ||
    !Number.isInteger(value.level) ||
    value.level < 1 ||
    value.level > getCampaignUnlockedThrough(completed) ||
    completed.includes(value.level) ||
    typeof value.assignments !== "object" ||
    value.assignments === null
  ) {
    return null;
  }

  const assignments = Object.fromEntries(
    Object.entries(value.assignments).filter(
      ([mountId, level]) =>
        /^p\d+$/.test(mountId) &&
        Number.isInteger(level) &&
        Number(level) >= 0 &&
        Number(level) <= 4,
    ),
  ) as Record<string, SlotLevel>;

  return {
    level: value.level,
    assignments,
    moves: normalizeCounter(value.moves),
    hints: normalizeCounter(value.hints),
    elapsed: normalizeCounter(value.elapsed),
  };
}

function normalizeCounter(value: number) {
  return Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0;
}
