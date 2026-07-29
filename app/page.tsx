"use client";

import {
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  DIFFICULTY_LABELS,
  LEVELS,
  LIFT_BY_LEVEL,
  calculateMoment,
  createRandomSeed,
  formatSeed,
  generatePuzzle,
  totalBalloons,
  type BalloonLevel,
  type Difficulty,
  type Puzzle,
  type SlotLevel,
} from "./game-core";
import {
  CAMPAIGN_CHAPTERS,
  CAMPAIGN_HINT_CAPACITY,
  CAMPAIGN_HINT_RECOVERY_AMOUNT,
  CAMPAIGN_HINT_RECOVERY_INTERVAL,
  CAMPAIGN_INITIAL_HINTS,
  CAMPAIGN_LEVELS,
  CAMPAIGN_PATTERN_LABELS,
  CAMPAIGN_STORAGE_KEY,
  CAMPAIGN_TOTAL,
  CAMPAIGN_VERSION,
  getCampaignChapter,
  getCampaignLevel,
  getCampaignUnlockedThrough,
  parseCampaignProgress,
  recoverCampaignHints,
  type CampaignProgress,
  type CampaignSnapshot,
} from "./campaign";

type AssignmentMap = Record<string, SlotLevel>;
type GameMode = "free" | "daily" | "campaign";
type PointerDrag = {
  level: BalloonLevel;
  sourceMountId: string | null;
  pointerId: number;
  x: number;
  y: number;
  startX: number;
  startY: number;
  hasMoved: boolean;
  tapMountId: string | null;
};

type DragPointerEvent = Pick<
  PointerEvent,
  "pointerId" | "clientX" | "clientY" | "preventDefault" | "stopPropagation"
>;

type GlobalDragListeners = {
  pointerId: number;
  remove: () => void;
};

type DailyChallenge = {
  date: string;
  seed: string;
  difficulty: "normal";
};

type PuzzleLoadOptions = {
  mode?: GameMode;
  campaignLevel?: number;
  snapshot?: CampaignSnapshot | null;
};

const POINTER_DRAG_THRESHOLD = 6;

function utcDateKey(date = new Date()) {
  const year = String(date.getUTCFullYear()).padStart(4, "0");
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

async function fetchDailyChallenge() {
  const configuredEndpoint =
    typeof document === "undefined"
      ? null
      : document
          .querySelector<HTMLMetaElement>(
            'meta[name="moment-zero-daily-endpoint"]',
          )
          ?.getAttribute("content");
  const dateKey = utcDateKey();
  const endpoint = new URL(
    configuredEndpoint || "/api/daily",
    window.location.href,
  );
  endpoint.searchParams.set("date", dateKey);
  const response = await fetch(endpoint, {
    cache: "no-store",
  });
  if (!response.ok) throw new Error("每日题暂时不可用");
  const data = (await response.json()) as Partial<DailyChallenge>;
  if (
    !data.date?.match(/^\d{4}-\d{2}-\d{2}$/) ||
    data.date !== dateKey ||
    !data.seed?.match(/^MZ-[A-Z0-9]{8}$/) ||
    data.difficulty !== "normal"
  ) {
    throw new Error("每日题尚未更新");
  }
  return data as DailyChallenge;
}

function formatTime(totalSeconds: number) {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function restoreCampaignAssignments(
  puzzle: Puzzle,
  snapshot: CampaignSnapshot | null | undefined,
) {
  if (!snapshot) return {};
  const mountIds = new Set(puzzle.mounts.map((mount) => mount.id));
  const used: Record<BalloonLevel, number> = { 1: 0, 2: 0, 3: 0, 4: 0 };
  const restored: AssignmentMap = {};

  for (const [mountId, level] of Object.entries(snapshot.assignments)) {
    if (!mountIds.has(mountId) || level === 0) continue;
    if (!LEVELS.includes(level) || used[level] >= puzzle.counts[level]) continue;
    restored[mountId] = level;
    used[level] += 1;
  }
  return restored;
}

function BalloonMark({
  level,
  compact = false,
}: {
  level: BalloonLevel;
  compact?: boolean;
}) {
  return (
    <span
      className={`balloon-mark balloon-mark--${level}${compact ? " balloon-mark--compact" : ""}`}
      aria-hidden="true"
    >
      <span>{LIFT_BY_LEVEL[level]}</span>
    </span>
  );
}

export default function Home() {
  const [gameMode, setGameMode] = useState<GameMode>("free");
  const [difficulty, setDifficulty] = useState<Difficulty>("normal");
  const [seedDraft, setSeedDraft] = useState("MZ-START");
  const [puzzle, setPuzzle] = useState<Puzzle | null>(null);
  const [assignments, setAssignments] = useState<AssignmentMap>({});
  const [history, setHistory] = useState<AssignmentMap[]>([]);
  const [selectedLevel, setSelectedLevel] = useState<BalloonLevel | null>(1);
  const [generating, setGenerating] = useState(true);
  const [error, setError] = useState("");
  const [elapsed, setElapsed] = useState(0);
  const [moves, setMoves] = useState(0);
  const [hints, setHints] = useState(0);
  const [hint, setHint] = useState<{ mountId: string; level: SlotLevel } | null>(
    null,
  );
  const [showRules, setShowRules] = useState(false);
  const [showSuccess, setShowSuccess] = useState(false);
  const [toast, setToast] = useState("");
  const [draggingMountId, setDraggingMountId] = useState<string | null>(null);
  const [dragOverMountId, setDragOverMountId] = useState<string | null>(null);
  const [pointerDrag, setPointerDrag] = useState<PointerDrag | null>(null);
  const [dailyChallenge, setDailyChallenge] = useState<DailyChallenge | null>(null);
  const [dailyLoading, setDailyLoading] = useState(false);
  const [streak, setStreak] = useState(0);
  const [bestTime, setBestTime] = useState<number | null>(null);
  const [campaignLevel, setCampaignLevel] = useState(1);
  const [campaignCompleted, setCampaignCompleted] = useState<number[]>([]);
  const [campaignHintBalance, setCampaignHintBalance] = useState(
    CAMPAIGN_INITIAL_HINTS,
  );
  const [campaignHintReward, setCampaignHintReward] = useState(0);
  const [showCampaign, setShowCampaign] = useState(false);
  const startedAt = useRef(Date.now());
  const completionHandled = useRef(false);
  const generationToken = useRef(0);
  const pointerDragRef = useRef<PointerDrag | null>(null);
  const pointerCaptureTargetRef = useRef<HTMLElement | null>(null);
  const globalDragListenersRef = useRef<GlobalDragListeners | null>(null);
  const suppressedMountClickRef = useRef<string | null>(null);

  useEffect(() => {
    // Chrome decides whether a touch becomes a scroll gesture on the compositor
    // thread, and it only consults the main thread when a non-passive touch
    // listener was already registered when the touch started. `touch-action`
    // alone is not enough for the balloons: they sit inside the rotated,
    // composited `.platform-tilt` subtree, where Android Chrome misses their
    // touch-action region and starts scrolling anyway — which fires
    // `pointercancel` and snaps the drag back on the first move. Registering
    // this listener up front keeps the decision on the main thread, and
    // preventing the default while a drag is active keeps the pointer stream
    // alive. It is a no-op for mouse input, so desktop dragging is untouched.
    const blockTouchScrollWhileDragging = (event: TouchEvent) => {
      if (pointerDragRef.current && event.cancelable) event.preventDefault();
    };
    document.addEventListener("touchmove", blockTouchScrollWhileDragging, {
      passive: false,
    });
    return () => {
      document.removeEventListener("touchmove", blockTouchScrollWhileDragging);
      globalDragListenersRef.current?.remove();
    };
  }, []);

  const loadPuzzle = useCallback(
    (
      nextSeed: string,
      nextDifficulty: Difficulty,
      options: PuzzleLoadOptions = {},
    ) => {
      const token = generationToken.current + 1;
      generationToken.current = token;
      setGenerating(true);
      setError("");
      setShowSuccess(false);
      setCampaignHintReward(0);
      setHint(null);
      completionHandled.current = false;

      window.setTimeout(() => {
        try {
          const normalizedSeed = formatSeed(nextSeed.replace(/^MZ-/i, ""));
          const nextPuzzle = generatePuzzle(normalizedSeed, nextDifficulty);
          if (generationToken.current !== token) return;
          const snapshot =
            options.mode === "campaign" ? options.snapshot : null;
          const restoredAssignments = restoreCampaignAssignments(
            nextPuzzle,
            snapshot,
          );
          setSeedDraft(normalizedSeed);
          setDifficulty(nextDifficulty);
          setPuzzle(nextPuzzle);
          setGameMode(options.mode ?? "free");
          if (options.mode === "campaign" && options.campaignLevel) {
            setCampaignLevel(options.campaignLevel);
          }
          setAssignments(restoredAssignments);
          setHistory([]);
          setMoves(snapshot?.moves ?? 0);
          setHints(snapshot?.hints ?? 0);
          setElapsed(snapshot?.elapsed ?? 0);
          setSelectedLevel(LEVELS.find((level) => nextPuzzle.counts[level] > 0) ?? 1);
          startedAt.current = Date.now() - (snapshot?.elapsed ?? 0) * 1000;
          const params =
            options.mode === "campaign" && options.campaignLevel
              ? new URLSearchParams({
                  mode: "campaign",
                  level: String(options.campaignLevel),
                })
              : new URLSearchParams({
                  seed: normalizedSeed,
                  difficulty: nextDifficulty,
                  ...(options.mode === "daily" ? { mode: "daily" } : {}),
                });
          window.history.replaceState(null, "", `?${params.toString()}`);
          const storedBest = window.localStorage.getItem(
            `moment-zero-best:${nextDifficulty}`,
          );
          setBestTime(storedBest ? Number(storedBest) : null);
        } catch (generationError) {
          if (generationToken.current !== token) return;
          setError(
            generationError instanceof Error
              ? generationError.message
              : "题目生成失败，请重试。",
          );
        } finally {
          if (generationToken.current === token) setGenerating(false);
        }
      }, 40);
    },
    [],
  );

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const requestedMode = params.get("mode");
    const requestedDifficulty = params.get("difficulty");
    const initialDifficulty: Difficulty =
      requestedDifficulty === "easy" ||
      requestedDifficulty === "normal" ||
      requestedDifficulty === "hard"
        ? requestedDifficulty
        : "normal";
    const campaignProgress = parseCampaignProgress(
      window.localStorage.getItem(CAMPAIGN_STORAGE_KEY),
    );
    const requestedCampaignLevel = Number(params.get("level"));
    const unlockedThrough = getCampaignUnlockedThrough(
      campaignProgress.completed,
    );
    const initialCampaignLevel =
      Number.isInteger(requestedCampaignLevel) &&
      requestedCampaignLevel >= 1 &&
      requestedCampaignLevel <= unlockedThrough
        ? requestedCampaignLevel
        : campaignProgress.currentLevel;
    const storedStreak = Number(
      window.localStorage.getItem("moment-zero-streak") || 0,
    );
    window.queueMicrotask(() => {
      setStreak(storedStreak);
      setCampaignCompleted(campaignProgress.completed);
      setCampaignLevel(campaignProgress.currentLevel);
      setCampaignHintBalance(campaignProgress.hintBalance);
      if (requestedMode === "campaign") {
        const level = getCampaignLevel(initialCampaignLevel);
        loadPuzzle(level.seed, level.difficulty, {
          mode: "campaign",
          campaignLevel: level.number,
          snapshot:
            campaignProgress.inProgress?.level === level.number
              ? campaignProgress.inProgress
              : null,
        });
        return;
      }
      const initialSeed = params.get("seed") || createRandomSeed();
      loadPuzzle(initialSeed, initialDifficulty, {
        mode: requestedMode === "daily" ? "daily" : "free",
      });
    });
  }, [loadPuzzle]);

  const total = puzzle ? totalBalloons(puzzle.counts) : 0;
  const isDailyChallenge = Boolean(
    gameMode !== "campaign" &&
      puzzle &&
      dailyChallenge &&
      puzzle.seed === dailyChallenge.seed &&
      puzzle.difficulty === "normal",
  );
  const activeCampaignLevel = getCampaignLevel(campaignLevel);
  const activeCampaignChapter = getCampaignChapter(campaignLevel);
  const campaignUnlockedThrough =
    getCampaignUnlockedThrough(campaignCompleted);
  const campaignCompletionPercent = Math.round(
    (campaignCompleted.length / CAMPAIGN_TOTAL) * 100,
  );
  const hasCenterMount = Boolean(
    puzzle?.mounts.some((mount) => {
      const center = (puzzle.size - 1) / 2;
      return mount.row === center && mount.column === center;
    }),
  );
  const placedCounts = useMemo(() => {
    const counts: Record<BalloonLevel, number> = { 1: 0, 2: 0, 3: 0, 4: 0 };
    for (const level of Object.values(assignments)) {
      if (level !== 0) counts[level] += 1;
    }
    return counts;
  }, [assignments]);
  const remaining = useMemo(() => {
    const counts: Record<BalloonLevel, number> = { 1: 0, 2: 0, 3: 0, 4: 0 };
    if (!puzzle) return counts;
    for (const level of LEVELS) {
      counts[level] = puzzle.counts[level] - placedCounts[level];
    }
    return counts;
  }, [placedCounts, puzzle]);
  const moment = useMemo(
    () =>
      puzzle
        ? calculateMoment(puzzle, assignments)
        : { x: 0, y: 0, placed: 0 },
    [assignments, puzzle],
  );
  const solved =
    Boolean(puzzle) &&
    moment.placed === total &&
    moment.x === 0 &&
    moment.y === 0;

  useEffect(() => {
    let active = true;
    fetchDailyChallenge()
      .then((challenge) => {
        if (active) setDailyChallenge(challenge);
      })
      .catch(() => {
        // The entry remains available and retries when the user selects it.
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!puzzle || solved || generating) return;
    const timer = window.setInterval(() => {
      setElapsed(Math.floor((Date.now() - startedAt.current) / 1000));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [generating, puzzle, solved]);

  useEffect(() => {
    if (!solved || !puzzle || completionHandled.current) return;
    completionHandled.current = true;
    const completedKey = `${puzzle.difficulty}:${puzzle.seed}`;
    const completed = JSON.parse(
      window.localStorage.getItem("moment-zero-completed") || "[]",
    ) as string[];
    let nextStreak = streak;
    let shouldUpdateStreak = false;
    if (!completed.includes(completedKey)) {
      nextStreak += 1;
      shouldUpdateStreak = true;
      window.localStorage.setItem("moment-zero-streak", String(nextStreak));
      window.localStorage.setItem(
        "moment-zero-completed",
        JSON.stringify([...completed.slice(-49), completedKey]),
      );
    }
    const bestKey = `moment-zero-best:${puzzle.difficulty}`;
    const previousBest = Number(window.localStorage.getItem(bestKey) || 0);
    const shouldUpdateBest = !previousBest || elapsed < previousBest;
    if (shouldUpdateBest) {
      window.localStorage.setItem(bestKey, String(elapsed));
    }
    let nextCampaignCompleted = campaignCompleted;
    let nextCampaignHintBalance = campaignHintBalance;
    let nextCampaignHintReward = 0;
    if (gameMode === "campaign") {
      const firstCompletion = !campaignCompleted.includes(campaignLevel);
      nextCampaignCompleted = Array.from(
        new Set([...campaignCompleted, campaignLevel]),
      ).sort((left, right) => left - right);
      if (firstCompletion) {
        nextCampaignHintBalance = recoverCampaignHints(
          campaignHintBalance,
          nextCampaignCompleted.length,
        );
        nextCampaignHintReward =
          nextCampaignHintBalance - campaignHintBalance;
      }
      const nextLevel = Math.min(CAMPAIGN_TOTAL, campaignLevel + 1);
      window.localStorage.setItem(
        CAMPAIGN_STORAGE_KEY,
        JSON.stringify({
          version: CAMPAIGN_VERSION,
          currentLevel: nextLevel,
          completed: nextCampaignCompleted,
          hintBalance: nextCampaignHintBalance,
          inProgress: null,
        } satisfies CampaignProgress),
      );
    }
    const successTimer = window.setTimeout(() => {
      if (shouldUpdateStreak) setStreak(nextStreak);
      if (shouldUpdateBest) setBestTime(elapsed);
      if (gameMode === "campaign") {
        setCampaignCompleted(nextCampaignCompleted);
        setCampaignHintBalance(nextCampaignHintBalance);
        setCampaignHintReward(nextCampaignHintReward);
      }
      setShowSuccess(true);
    }, 520);
    return () => window.clearTimeout(successTimer);
  }, [
    campaignCompleted,
    campaignHintBalance,
    campaignLevel,
    elapsed,
    gameMode,
    puzzle,
    solved,
    streak,
  ]);

  useEffect(() => {
    if (
      gameMode !== "campaign" ||
      generating ||
      solved ||
      !puzzle ||
      puzzle.seed !== activeCampaignLevel.seed ||
      puzzle.difficulty !== activeCampaignLevel.difficulty
    ) {
      return;
    }
    window.localStorage.setItem(
      CAMPAIGN_STORAGE_KEY,
      JSON.stringify({
        version: CAMPAIGN_VERSION,
        currentLevel: campaignLevel,
        completed: campaignCompleted,
        hintBalance: campaignHintBalance,
        inProgress: {
          level: campaignLevel,
          assignments,
          moves,
          hints,
          elapsed,
        },
      } satisfies CampaignProgress),
    );
  }, [
    activeCampaignLevel.difficulty,
    activeCampaignLevel.seed,
    assignments,
    campaignCompleted,
    campaignHintBalance,
    campaignLevel,
    elapsed,
    gameMode,
    generating,
    hints,
    moves,
    puzzle,
    solved,
  ]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(""), 2200);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    function handleKeydown(event: KeyboardEvent) {
      if (event.key === "Escape" && showCampaign) {
        setShowCampaign(false);
        return;
      }
      if (event.key === "Escape" && showSuccess) {
        setShowSuccess(false);
        return;
      }
      if (
        event.target instanceof HTMLInputElement ||
        event.target instanceof HTMLTextAreaElement
      ) {
        return;
      }
      if (event.key.toLowerCase() === "h") revealHint();
      if (event.key.toLowerCase() === "r") resetPuzzle();
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
        event.preventDefault();
        undo();
      }
      const number = Number(event.key);
      if (LEVELS.includes(number as BalloonLevel)) {
        setSelectedLevel(number as BalloonLevel);
      }
    }
    window.addEventListener("keydown", handleKeydown);
    return () => window.removeEventListener("keydown", handleKeydown);
  });

  function flash(message: string) {
    setToast(message);
  }

  function suppressNextMountClick(mountId: string) {
    suppressedMountClickRef.current = mountId;
    window.setTimeout(() => {
      if (suppressedMountClickRef.current === mountId) {
        suppressedMountClickRef.current = null;
      }
    }, 0);
  }

  function loadCampaignLevel(
    requestedLevel: number,
    providedProgress?: CampaignProgress,
  ) {
    const storedProgress =
      providedProgress ??
      parseCampaignProgress(
        window.localStorage.getItem(CAMPAIGN_STORAGE_KEY),
      );
    const completed = providedProgress
      ? providedProgress.completed
      : campaignCompleted;
    const unlockedThrough = getCampaignUnlockedThrough(completed);
    if (
      !Number.isInteger(requestedLevel) ||
      requestedLevel < 1 ||
      requestedLevel > unlockedThrough
    ) {
      flash(`完成第 ${String(unlockedThrough).padStart(2, "0")} 关后解锁`);
      return;
    }

    const level = getCampaignLevel(requestedLevel);
    const snapshot =
      storedProgress.inProgress?.level === level.number
        ? storedProgress.inProgress
        : null;
    setCampaignCompleted(completed);
    setShowCampaign(false);
    window.localStorage.setItem(
      CAMPAIGN_STORAGE_KEY,
      JSON.stringify({
        version: CAMPAIGN_VERSION,
        currentLevel: level.number,
        completed,
        hintBalance: storedProgress.hintBalance,
        inProgress: snapshot,
      } satisfies CampaignProgress),
    );
    setCampaignHintBalance(storedProgress.hintBalance);
    loadPuzzle(level.seed, level.difficulty, {
      mode: "campaign",
      campaignLevel: level.number,
      snapshot,
    });
  }

  function enterCampaign() {
    const progress = parseCampaignProgress(
      window.localStorage.getItem(CAMPAIGN_STORAGE_KEY),
    );
    loadCampaignLevel(progress.currentLevel, progress);
  }

  async function loadDailyPuzzle() {
    if (dailyLoading) return;
    setDailyLoading(true);
    try {
      const challenge = await fetchDailyChallenge();
      setDailyChallenge(challenge);
      loadPuzzle(challenge.seed, challenge.difficulty, { mode: "daily" });
    } catch {
      flash("每日题暂时不可用，请稍后重试");
    } finally {
      setDailyLoading(false);
    }
  }

  function placeBalloon(mountId: string, requestedLevel: BalloonLevel | null) {
    if (!puzzle || solved) return;
    const currentLevel = assignments[mountId] ?? 0;
    const nextLevel: SlotLevel =
      requestedLevel === currentLevel ? 0 : (requestedLevel ?? 0);
    if (nextLevel !== 0 && nextLevel !== currentLevel && remaining[nextLevel] <= 0) {
      flash(`${nextLevel}级气球已全部使用`);
      return;
    }
    if (nextLevel === currentLevel) return;
    const nextRemaining = { ...remaining };
    if (currentLevel !== 0) nextRemaining[currentLevel] += 1;
    if (nextLevel !== 0) nextRemaining[nextLevel] -= 1;
    const nextSelectedLevel =
      selectedLevel !== null && nextRemaining[selectedLevel] > 0
        ? selectedLevel
        : (LEVELS.find((level) => nextRemaining[level] > 0) ?? null);
    setHistory((items) => [...items.slice(-39), assignments]);
    setAssignments((current) => ({ ...current, [mountId]: nextLevel }));
    if (nextSelectedLevel !== selectedLevel) {
      setSelectedLevel(nextSelectedLevel);
    }
    setMoves((value) => value + 1);
    if (hint?.mountId === mountId) setHint(null);
  }

  function undo() {
    if (history.length === 0 || solved) return;
    const previous = history[history.length - 1];
    setAssignments(previous);
    setHistory((items) => items.slice(0, -1));
    setMoves((value) => value + 1);
    setHint(null);
  }

  function resetPuzzle() {
    if (!puzzle || Object.keys(assignments).length === 0 || solved) return;
    setHistory((items) => [...items.slice(-39), assignments]);
    setAssignments({});
    setMoves((value) => value + 1);
    setHint(null);
  }

  function revealHint() {
    if (!puzzle || solved) return;
    if (gameMode === "campaign" && campaignHintBalance <= 0) {
      flash(
        `提示已用完；每通过 ${CAMPAIGN_HINT_RECOVERY_INTERVAL} 关恢复 ${CAMPAIGN_HINT_RECOVERY_AMOUNT} 次`,
      );
      return;
    }
    const target = puzzle.mounts.find(
      (mount) => (assignments[mount.id] ?? 0) !== puzzle.solution[mount.id],
    );
    if (!target) return;
    const level = puzzle.solution[target.id];
    setHint({ mountId: target.id, level });
    setHints((value) => value + 1);
    if (gameMode === "campaign") {
      setCampaignHintBalance((value) => Math.max(0, value - 1));
    }
    flash(level === 0 ? "标记位置应保持为空" : `标记位置应使用 ${level} 级气球`);
  }

  function dropBalloonOnMount(
    mountId: string,
    level: BalloonLevel,
    sourceMountId: string | null,
  ) {
    if (!puzzle || solved || sourceMountId === mountId) return;

    if (sourceMountId && assignments[sourceMountId]) {
      const sourceLevel = assignments[sourceMountId];
      const targetLevel = assignments[mountId] ?? 0;
      setHistory((items) => [...items.slice(-39), assignments]);
      setAssignments((current) => ({
        ...current,
        [sourceMountId]: targetLevel,
        [mountId]: sourceLevel,
      }));
      setMoves((value) => value + 1);
      if (
        hint?.mountId === sourceMountId ||
        hint?.mountId === mountId
      ) {
        setHint(null);
      }
      return;
    }
    placeBalloon(mountId, level);
  }

  function returnBalloonToInventory(sourceMountId: string) {
    if (!assignments[sourceMountId] || solved) return;
    setHistory((items) => [...items.slice(-39), assignments]);
    setAssignments((current) => ({ ...current, [sourceMountId]: 0 }));
    setMoves((value) => value + 1);
    if (hint?.mountId === sourceMountId) setHint(null);
  }

  function platformHitAtPoint(x: number, y: number) {
    const elements = document.elementsFromPoint(x, y);
    for (const element of elements) {
      const target = element.closest<HTMLElement>("[data-mount-id]");
      if (target?.dataset.mountId) {
        return { mountId: target.dataset.mountId, overPlatform: true };
      }
    }
    return {
      mountId: null,
      overPlatform: elements.some((element) =>
        Boolean(element.closest(".board-frame")),
      ),
    };
  }

  function crossedDragThreshold(
    drag: PointerDrag,
    x: number,
    y: number,
  ) {
    return (
      drag.hasMoved ||
      Math.hypot(x - drag.startX, y - drag.startY) >= POINTER_DRAG_THRESHOLD
    );
  }

  function beginPointerDrag(
    event: ReactPointerEvent<HTMLElement>,
    level: BalloonLevel,
    sourceMountId: string | null,
    tapMountId: string | null = null,
  ) {
    if (
      solved ||
      (event.pointerType === "mouse" && event.button !== 0) ||
      (sourceMountId === null && remaining[level] <= 0)
    ) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    if (event.pointerType !== "mouse") {
      try {
        event.currentTarget.setPointerCapture(event.pointerId);
        pointerCaptureTargetRef.current = event.currentTarget;
      } catch {
        pointerCaptureTargetRef.current = null;
      }
    }
    const nextDrag: PointerDrag = {
      level,
      sourceMountId,
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      startX: event.clientX,
      startY: event.clientY,
      hasMoved: false,
      tapMountId,
    };
    pointerDragRef.current = nextDrag;
    globalDragListenersRef.current?.remove();
    // Track on window while this drag is active. Android can drop element
    // pointer capture after the pressed element is restyled, but the uncaptured
    // events still reach window.
    const handlePointerMove = (nativeEvent: PointerEvent) =>
      movePointerDrag(nativeEvent);
    const handlePointerUp = (nativeEvent: PointerEvent) =>
      finishPointerDrag(nativeEvent);
    const handlePointerCancel = (nativeEvent: PointerEvent) =>
      cancelPointerDrag(nativeEvent);
    const remove = () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("pointercancel", handlePointerCancel);
      if (globalDragListenersRef.current?.pointerId === event.pointerId) {
        globalDragListenersRef.current = null;
      }
    };
    window.addEventListener("pointermove", handlePointerMove, { passive: false });
    window.addEventListener("pointerup", handlePointerUp, { passive: false });
    window.addEventListener("pointercancel", handlePointerCancel);
    globalDragListenersRef.current = { pointerId: event.pointerId, remove };
    if (tapMountId === null) setPointerDrag(nextDrag);
    setDraggingMountId(sourceMountId);
    setDragOverMountId(null);
    if (sourceMountId === null) setSelectedLevel(level);
  }

  function beginBoardPointerDrag(
    event: ReactPointerEvent<HTMLDivElement>,
  ) {
    const sourceMountId = document
      .elementsFromPoint(event.clientX, event.clientY)
      .map(
        (element) =>
          element.closest<HTMLElement>("[data-mount-id]")?.dataset.mountId,
      )
      .find(Boolean);
    const level = sourceMountId ? assignments[sourceMountId] : 0;
    if (!sourceMountId) return;
    if (level) {
      beginPointerDrag(event, level, sourceMountId);
    } else if (selectedLevel !== null) {
      beginPointerDrag(event, selectedLevel, null, sourceMountId);
    }
  }

  function releasePointerCapture(pointerId: number) {
    const target = pointerCaptureTargetRef.current;
    if (target?.hasPointerCapture(pointerId)) {
      target.releasePointerCapture(pointerId);
    }
    pointerCaptureTargetRef.current = null;
    if (globalDragListenersRef.current?.pointerId === pointerId) {
      globalDragListenersRef.current.remove();
    }
  }

  function movePointerDrag(event: DragPointerEvent) {
    const active = pointerDragRef.current;
    if (!active || active.pointerId !== event.pointerId) return;
    event.preventDefault();
    const { mountId: targetMountId } = platformHitAtPoint(
      event.clientX,
      event.clientY,
    );
    const nextDrag = {
      ...active,
      x: event.clientX,
      y: event.clientY,
      hasMoved: crossedDragThreshold(active, event.clientX, event.clientY),
    };
    pointerDragRef.current = nextDrag;
    if (nextDrag.hasMoved || nextDrag.tapMountId === null) {
      setPointerDrag(nextDrag);
    }
    setDragOverMountId(
      nextDrag.hasMoved && targetMountId !== active.sourceMountId
        ? targetMountId
        : null,
    );
  }

  function finishPointerDrag(event: DragPointerEvent) {
    const active = pointerDragRef.current;
    if (!active || active.pointerId !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    const { mountId: targetMountId, overPlatform } = platformHitAtPoint(
      event.clientX,
      event.clientY,
    );
    const hasMoved = crossedDragThreshold(
      active,
      event.clientX,
      event.clientY,
    );
    if (
      active.tapMountId &&
      targetMountId === active.tapMountId &&
      !hasMoved
    ) {
      suppressNextMountClick(targetMountId);
      placeBalloon(targetMountId, active.level);
    } else if (
      active.sourceMountId &&
      targetMountId === active.sourceMountId &&
      !hasMoved
    ) {
      suppressNextMountClick(targetMountId);
      placeBalloon(targetMountId, selectedLevel);
    } else if (targetMountId) {
      dropBalloonOnMount(
        targetMountId,
        active.level,
        active.sourceMountId,
      );
    } else if (active.sourceMountId && !overPlatform) {
      returnBalloonToInventory(active.sourceMountId);
    }
    releasePointerCapture(event.pointerId);
    pointerDragRef.current = null;
    setPointerDrag(null);
    setDraggingMountId(null);
    setDragOverMountId(null);
  }

  function cancelPointerDrag(event: DragPointerEvent) {
    if (pointerDragRef.current?.pointerId !== event.pointerId) return;
    releasePointerCapture(event.pointerId);
    pointerDragRef.current = null;
    setPointerDrag(null);
    setDraggingMountId(null);
    setDragOverMountId(null);
  }

  async function sharePuzzle() {
    const url = new URL(window.location.href);
    if (gameMode === "campaign" && puzzle) {
      url.search = new URLSearchParams({
        seed: puzzle.seed,
        difficulty: puzzle.difficulty,
      }).toString();
    }
    try {
      await navigator.clipboard.writeText(url.toString());
      flash("题目链接已复制");
    } catch {
      flash("复制失败，请从地址栏复制链接");
    }
  }

  async function copySeed() {
    const seed = seedDraft.trim().toUpperCase();
    if (!seed) return;
    try {
      await navigator.clipboard.writeText(seed);
      flash("种子已复制");
    } catch {
      flash("复制失败，请手动复制种子");
    }
  }

  const mountByCell = useMemo(() => {
    const map = new Map<string, Puzzle["mounts"][number]>();
    puzzle?.mounts.forEach((mount) => {
      map.set(`${mount.row}:${mount.column}`, mount);
    });
    return map;
  }, [puzzle]);

  const maximumMoment = useMemo(() => {
    if (!puzzle) return 1;
    return Math.max(
      1,
      puzzle.mounts.reduce((sum, mount) => {
        const center = (puzzle.size - 1) / 2;
        const distance =
          Math.abs(mount.column - center) + Math.abs(center - mount.row);
        return sum + 6 * mount.multiplier * distance;
      }, 0) / 2,
    );
  }, [puzzle]);

  const tiltRange = Math.max(8, Math.min(24, maximumMoment * 0.18));
  const normalizeTilt = (value: number) => {
    if (value === 0) return 0;
    const strength = Math.min(1, Math.abs(value) / tiltRange);
    return Math.sign(value) * (2.2 + strength * 6.3);
  };
  const tiltX = normalizeTilt(moment.x);
  const tiltY = normalizeTilt(moment.y);
  const tiltMagnitude = Math.min(1, (Math.abs(tiltX) + Math.abs(tiltY)) / 12);
  const platformTiltStyle = {
    "--tilt-x": `${-tiltY}deg`,
    "--tilt-y": `${-tiltX}deg`,
    "--shift-x": `${-tiltX * 0.9}px`,
    "--shift-y": `${tiltY * 0.9}px`,
    "--shadow-x": `${tiltX * 1.7}px`,
    "--shadow-y": `${12 - tiltY * 1.2}px`,
    "--shadow-blur": `${26 + tiltMagnitude * 20}px`,
    "--edge-depth": `${5 + tiltMagnitude * 7}px`,
  } as CSSProperties;
  const boardCells = puzzle
    ? Array.from({ length: puzzle.size * puzzle.size }, (_, index) => {
        const row = Math.floor(index / puzzle.size);
        const column = index % puzzle.size;
        return { row, column, mount: mountByCell.get(`${row}:${column}`) };
      })
    : [];

  return (
    <main
      className="app-shell"
      onPointerMove={movePointerDrag}
      onPointerUp={finishPointerDrag}
      onPointerCancel={cancelPointerDrag}
    >
      <header className="topbar">
        <div className="brand">
          <span className="brand__sigil" aria-hidden="true">
            <i />
          </span>
          <div>
            <strong>零矩协议</strong>
            <span>MOMENT ZERO</span>
          </div>
        </div>
        <div className="topbar__mission">
          <span>
            {gameMode === "campaign"
              ? "百关回收协议"
              : isDailyChallenge
                ? "全球每日挑战"
                : "浮空回收训练"}
          </span>
          <strong>
            {gameMode === "campaign"
              ? `第 ${String(campaignLevel).padStart(2, "0")} 关`
              : isDailyChallenge
                ? "每日一题"
                : DIFFICULTY_LABELS[difficulty]}
          </strong>
        </div>
        <div className="topbar__actions">
          <button className="button button--quiet" type="button" onClick={sharePuzzle}>
            分享题目
          </button>
          <button
            className="button button--campaign"
            type="button"
            disabled={generating}
            onClick={() =>
              gameMode === "campaign"
                ? loadPuzzle(createRandomSeed(), difficulty, { mode: "free" })
                : enterCampaign()
            }
          >
            {gameMode === "campaign" ? "随机模式" : "闯关模式"}
          </button>
          <button
            className={`button button--daily${isDailyChallenge ? " is-active" : ""}`}
            type="button"
            title="全球统一题目，每日 UTC 00:00 更新"
            aria-pressed={isDailyChallenge}
            disabled={generating || dailyLoading}
            onClick={loadDailyPuzzle}
          >
            {dailyLoading ? "正在获取…" : "每日一题"}
          </button>
          {gameMode !== "campaign" && (
            <button
              className="button button--primary button--new-task"
              type="button"
              onClick={() =>
                loadPuzzle(createRandomSeed(), difficulty, { mode: "free" })
              }
            >
              新任务
              <span aria-hidden="true">↗</span>
            </button>
          )}
        </div>
      </header>

      <div className="workspace">
        <aside className="mission-rail" aria-label="任务信息">
          <div className="rail-heading">
            <span className="eyebrow">
              {gameMode === "campaign"
                ? `百关协议 · ${activeCampaignChapter.range}`
                : isDailyChallenge
                  ? "每日一题"
                  : "当前任务"}
            </span>
            <h1>
              {gameMode === "campaign"
                ? activeCampaignChapter.title
                : "平衡全部气球"}
            </h1>
          </div>

          {gameMode === "campaign" ? (
            <div className="mission-setting mission-setting--campaign">
              <div className="campaign-status__identity">
                <span>
                  LEVEL {String(campaignLevel).padStart(3, "0")} / {CAMPAIGN_TOTAL}
                </span>
                <strong>
                  {CAMPAIGN_PATTERN_LABELS[activeCampaignLevel.pattern]}构型 ·{" "}
                  {DIFFICULTY_LABELS[activeCampaignLevel.difficulty]}
                </strong>
              </div>
              <div className="campaign-status__progress">
                <div>
                  <span>总进度</span>
                  <strong>{campaignCompletionPercent}%</strong>
                </div>
                <i aria-hidden="true">
                  <span style={{ width: `${campaignCompletionPercent}%` }} />
                </i>
              </div>
              <button
                className="campaign-map-button"
                type="button"
                onClick={() => setShowCampaign(true)}
              >
                查看航线 <span aria-hidden="true">→</span>
              </button>
            </div>
          ) : (
            <div className="mission-setting">
              <form
                className="seed-block"
                onSubmit={(event) => {
                  event.preventDefault();
                  loadPuzzle(seedDraft, difficulty, { mode: "free" });
                }}
              >
                <label htmlFor="puzzle-seed">种子</label>
                <div>
                  <input
                    id="puzzle-seed"
                    name="seed"
                    type="text"
                    value={seedDraft}
                    maxLength={11}
                    autoComplete="off"
                    spellCheck={false}
                    aria-label="输入题目种子"
                    onChange={(event) => setSeedDraft(event.target.value)}
                  />
                  <button
                    type="button"
                    className="seed-block__copy"
                    aria-label="复制题目种子"
                    disabled={!seedDraft.trim()}
                    onClick={copySeed}
                  >
                    复制
                  </button>
                  <button
                    type="submit"
                    className="seed-block__load"
                    disabled={generating}
                  >
                    载入
                  </button>
                </div>
              </form>

              <div className="difficulty-control" aria-label="难度">
                {(["easy", "normal", "hard"] as Difficulty[]).map((item) => (
                  <button
                    key={item}
                    type="button"
                    className={difficulty === item ? "is-active" : ""}
                    onClick={() =>
                      loadPuzzle(createRandomSeed(), item, { mode: "free" })
                    }
                    aria-pressed={difficulty === item}
                  >
                    {DIFFICULTY_LABELS[item]}
                  </button>
                ))}
              </div>
            </div>
          )}

          <dl className="mission-metrics">
            <div>
              <dt>用时</dt>
              <dd>{formatTime(elapsed)}</dd>
            </div>
            <div>
              <dt>操作</dt>
              <dd>{String(moves).padStart(2, "0")}</dd>
            </div>
            <div>
              <dt>{gameMode === "campaign" ? "进度" : "连胜"}</dt>
              <dd>
                {gameMode === "campaign"
                  ? `${String(campaignCompleted.length).padStart(2, "0")}/100`
                  : String(streak).padStart(2, "0")}
              </dd>
            </div>
            <div>
              <dt>{gameMode === "campaign" ? "提示" : "最佳"}</dt>
              <dd>
                {gameMode === "campaign"
                  ? `${campaignHintBalance}/${CAMPAIGN_HINT_CAPACITY}`
                  : bestTime === null
                    ? "--:--"
                    : formatTime(bestTime)}
              </dd>
            </div>
          </dl>

          <button
            className="text-button"
            type="button"
            onClick={() => setShowRules(true)}
          >
            玩法说明 <span aria-hidden="true">?</span>
          </button>
        </aside>

        <section className="board-stage" aria-labelledby="board-title">
          <div className="stage-heading">
            <div>
              <span className="eyebrow">平台</span>
              <h2 id="board-title">
                回收平台
                {gameMode === "campaign" &&
                  ` · ${String(campaignLevel).padStart(3, "0")}`}
              </h2>
            </div>
          </div>

          <div className="board-assembly">
            <div
              className={`moment-axis moment-axis--vertical ${moment.y === 0 ? "is-zero" : moment.y > 0 ? "is-positive" : "is-negative"}`}
              aria-label={`纵向力矩 ${moment.y}`}
            >
              <span className="moment-axis__arrow" aria-hidden="true">
                <i />
              </span>
              <strong>{Math.abs(moment.y)}</strong>
              <small>Y</small>
            </div>

            <div className="platform-tilt" style={platformTiltStyle}>
              <div className={`board-frame${solved ? " is-solved" : ""}`}>
                <div
                  className="board-grid"
                  role="grid"
                  aria-label={`${puzzle?.size ?? 0}乘${puzzle?.size ?? 0}回收平台`}
                  onPointerDown={beginBoardPointerDrag}
                  style={
                    {
                      "--board-size": puzzle?.size ?? 5,
                    } as CSSProperties
                  }
                >
                  {boardCells.map(({ row, column, mount }, index) => {
                    if (!mount) {
                      return (
                        <span
                          className="board-cell board-cell--tile"
                          key={`${row}:${column}`}
                          aria-hidden="true"
                          style={
                            {
                              "--cell-delay": `${index * 8}ms`,
                            } as CSSProperties
                          }
                        />
                      );
                    }
                    const level = assignments[mount.id] ?? 0;
                    const isHinted = hint?.mountId === mount.id;
                    return (
                      <button
                        type="button"
                        key={mount.id}
                        className={`board-cell board-cell--mount${level ? " has-balloon" : " is-empty"}${isHinted ? " is-hinted" : ""}${draggingMountId === mount.id ? " is-dragging" : ""}${dragOverMountId === mount.id && draggingMountId !== mount.id ? " is-drop-target" : ""}`}
                        role="gridcell"
                        tabIndex={0}
                        data-mount-id={mount.id}
                        data-multiplier={mount.multiplier}
                        aria-label={`第${row + 1}行第${column + 1}列，${mount.multiplier}倍挂载点，${level ? `已放置${level}级气球` : "空"}`}
                        onPointerUp={(event) => {
                          if (pointerDragRef.current) return;
                          event.preventDefault();
                          event.stopPropagation();
                          suppressNextMountClick(mount.id);
                          placeBalloon(mount.id, selectedLevel);
                        }}
                        onClick={() => {
                          if (suppressedMountClickRef.current === mount.id) {
                            suppressedMountClickRef.current = null;
                            return;
                          }
                          placeBalloon(mount.id, selectedLevel);
                        }}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            placeBalloon(mount.id, selectedLevel);
                          }
                        }}
                        style={
                          {
                            "--cell-delay": `${index * 8}ms`,
                          } as CSSProperties
                        }
                      >
                        <span className="mount-crosshair" aria-hidden="true" />
                        {mount.multiplier > 1 && (
                          <span className="mount-multiplier">
                            ×{mount.multiplier}
                          </span>
                        )}
                        {level !== 0 && (
                          <span
                            className="mounted-balloon-drag-source"
                            aria-hidden="true"
                            title="拖动气球到其他挂载点"
                            onPointerDown={(event) => {
                              if (event.pointerType !== "mouse") {
                                beginPointerDrag(event, level, mount.id);
                              }
                            }}
                          >
                            <BalloonMark level={level} compact />
                          </span>
                        )}
                        {isHinted && (
                          <span className="hint-label">
                            {hint.level === 0 ? "留空" : `${hint.level}级`}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
                {!hasCenterMount && <div className="center-mark" aria-hidden="true" />}
              </div>
            </div>

            <div
              className={`moment-axis moment-axis--horizontal ${moment.x === 0 ? "is-zero" : moment.x > 0 ? "is-positive" : "is-negative"}`}
              aria-label={`横向力矩 ${moment.x}`}
            >
              <small>X</small>
              <span className="moment-axis__arrow" aria-hidden="true">
                <i />
              </span>
              <strong>{Math.abs(moment.x)}</strong>
            </div>
          </div>
        </section>

        <aside className="inventory-rail" aria-label="气球库存">
          <div className="inventory-heading">
            <div>
              <span className="eyebrow">库存</span>
              <h2>回收气球</h2>
              <p>需使用全部气球</p>
            </div>
            <strong>
              {total - moment.placed}
              <span> 剩余</span>
            </strong>
          </div>

          <div className="inventory-list">
            {LEVELS.map((level) => {
              const isSelected = selectedLevel === level;
              const unavailable = remaining[level] <= 0;
              return (
                <button
                  type="button"
                  className={`inventory-item${isSelected ? " is-selected" : ""}${hint?.level === level ? " is-hinted" : ""}`}
                  key={level}
                  data-balloon-level={level}
                  disabled={unavailable}
                  aria-label={`${level}级气球，升力系数${LIFT_BY_LEVEL[level]}，剩余${remaining[level]}`}
                  aria-pressed={isSelected}
                  onClick={() => setSelectedLevel(level)}
                  onPointerDown={(event) =>
                    beginPointerDrag(event, level, null)
                  }
                >
                  <span
                    className="inventory-drag-source"
                    aria-hidden="true"
                  >
                    <BalloonMark level={level} />
                  </span>
                  <span className="inventory-item__name">
                    <strong>{level}级气球</strong>
                    <small>升力系数 {LIFT_BY_LEVEL[level]}</small>
                  </span>
                  <span className="inventory-item__count">
                    {remaining[level]}
                    <small> / {puzzle?.counts[level] ?? 0}</small>
                  </span>
                </button>
              );
            })}
          </div>

          <div className="inventory-actions">
            <button type="button" onClick={undo} disabled={history.length === 0 || solved}>
              撤销
              <kbd>⌘Z</kbd>
            </button>
            <button
              type="button"
              onClick={resetPuzzle}
              disabled={Object.keys(assignments).length === 0 || solved}
            >
              重置
              <kbd>R</kbd>
            </button>
            <button
              type="button"
              onClick={revealHint}
              disabled={
                solved ||
                (gameMode === "campaign" && campaignHintBalance <= 0)
              }
            >
              {gameMode === "campaign"
                ? `提示 ${campaignHintBalance}/${CAMPAIGN_HINT_CAPACITY}`
                : "提示"}
              <kbd>H</kbd>
            </button>
          </div>

          <div className="selection-note">
            <span className="selection-note__dot" />
            拖动整行标签至挂载点 · 平台气球拖出边界可回库存
          </div>
        </aside>
      </div>

      {pointerDrag && (
        <div
          className="drag-preview drag-preview--card"
          aria-hidden="true"
          style={{
            left: pointerDrag.x,
            top: pointerDrag.y,
          }}
        >
          <BalloonMark level={pointerDrag.level} />
          <span className="drag-preview__copy">
            <strong>{pointerDrag.level}级气球</strong>
            <small>升力系数 {LIFT_BY_LEVEL[pointerDrag.level]}</small>
          </span>
        </div>
      )}

      {generating && (
        <div className="generation-screen" role="status" aria-live="polite">
          <span className="generation-spinner" />
          <strong>正在构造唯一解任务</strong>
          <small>平衡求解器正在校验所有可行摆法</small>
        </div>
      )}

      {error && (
        <div className="error-banner" role="alert">
          <span>{error}</span>
          <button
            type="button"
            onClick={() =>
              gameMode === "campaign"
                ? loadCampaignLevel(campaignLevel)
                : loadPuzzle(createRandomSeed(), difficulty, { mode: "free" })
            }
          >
            重新生成
          </button>
        </div>
      )}

      {showRules && (
        <div className="modal-backdrop" role="presentation">
          <section
            className="rules-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="rules-title"
          >
            <button
              className="modal-close"
              type="button"
              onClick={() => setShowRules(false)}
              aria-label="关闭"
            >
              ×
            </button>
            <span className="eyebrow">操作手册</span>
            <h2 id="rules-title">把两条力矩都归零</h2>
            <p>
              选择气球后点击挂载点，或拖动整行标签到棋盘。把平台上的气球拖出边界即可回库存。
            </p>
            <div className="formula">
              <span>平衡条件</span>
              <strong>Σ(L × M × X) = 0</strong>
              <strong>Σ(L × M × Y) = 0</strong>
            </div>
            <ol>
              <li>
                <span>01</span>
                中心对称的两个点，只要“升力 × 挂载倍率”相同，就会相互抵消。
              </li>
              <li>
                <span>02</span>
                4级气球升力为6；高升力应靠近中心，或用更远的低升力抵消。
              </li>
              <li>
                <span>03</span>
                必须用完库存中的全部气球，空挂载点可以作为干扰项。
              </li>
              {gameMode === "campaign" && (
                <li>
                  <span>04</span>
                  闯关提示全程共用，初始 {CAMPAIGN_INITIAL_HINTS} 次；每首次通过{" "}
                  {CAMPAIGN_HINT_RECOVERY_INTERVAL} 关恢复{" "}
                  {CAMPAIGN_HINT_RECOVERY_AMOUNT} 次，上限{" "}
                  {CAMPAIGN_HINT_CAPACITY} 次。
                </li>
              )}
            </ol>
            <button
              className="button button--primary button--wide"
              type="button"
              onClick={() => setShowRules(false)}
            >
              开始操作
            </button>
          </section>
        </div>
      )}

      {showCampaign && (
        <div
          className="modal-backdrop campaign-backdrop"
          role="presentation"
          onClick={(event) => {
            if (event.target === event.currentTarget) setShowCampaign(false);
          }}
        >
          <section
            className="campaign-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="campaign-title"
          >
            <button
              className="modal-close"
              type="button"
              onClick={() => setShowCampaign(false)}
              aria-label="关闭"
            >
              ×
            </button>
            <header className="campaign-modal__header">
              <div>
                <span className="eyebrow">CAMPAIGN 01 / 百关回收协议</span>
                <h2 id="campaign-title">百关航线</h2>
              </div>
              <div className="campaign-modal__summary">
                <strong>
                  {String(campaignCompleted.length).padStart(3, "0")}
                  <span> / {CAMPAIGN_TOTAL}</span>
                </strong>
                <small>已稳定</small>
              </div>
            </header>

            <div className="campaign-modal__track" aria-label="闯关总进度">
              <span style={{ width: `${campaignCompletionPercent}%` }} />
            </div>

            <div className="campaign-chapters">
              {CAMPAIGN_CHAPTERS.map((chapter) => {
                const levels = CAMPAIGN_LEVELS.filter(
                  (level) => level.chapter === chapter.number,
                );
                return (
                  <section className="campaign-chapter" key={chapter.number}>
                    <header>
                      <span>
                        航段 {String(chapter.number).padStart(2, "0")}
                      </span>
                      <strong>{chapter.title}</strong>
                      <small>{chapter.range}</small>
                    </header>
                    <div className="campaign-levels">
                      {levels.map((level) => {
                        const completed = campaignCompleted.includes(
                          level.number,
                        );
                        const unlocked =
                          level.number <= campaignUnlockedThrough;
                        const active =
                          gameMode === "campaign" &&
                          campaignLevel === level.number;
                        return (
                          <button
                            className={`${completed ? "is-completed" : ""}${active ? " is-active" : ""}`}
                            type="button"
                            key={level.number}
                            disabled={!unlocked || generating}
                            aria-label={`第 ${level.number} 关，${CAMPAIGN_PATTERN_LABELS[level.pattern]}构型，${completed ? "已完成" : unlocked ? "已解锁" : "未解锁"}`}
                            aria-current={active ? "step" : undefined}
                            onClick={() => loadCampaignLevel(level.number)}
                          >
                            <span>{String(level.number).padStart(2, "0")}</span>
                            <small>
                              {completed
                                ? "完成"
                                : unlocked
                                  ? CAMPAIGN_PATTERN_LABELS[level.pattern]
                                  : "锁定"}
                            </small>
                          </button>
                        );
                      })}
                    </div>
                  </section>
                );
              })}
            </div>

            <footer className="campaign-modal__footer">
              <span>
                提示池 {campaignHintBalance}/{CAMPAIGN_HINT_CAPACITY}
                <i aria-hidden="true" />
                每通过 {CAMPAIGN_HINT_RECOVERY_INTERVAL} 关恢复{" "}
                {CAMPAIGN_HINT_RECOVERY_AMOUNT} 次
              </span>
              <button
                className="button button--primary"
                type="button"
                onClick={() =>
                  loadCampaignLevel(campaignUnlockedThrough)
                }
              >
                {campaignCompleted.length === CAMPAIGN_TOTAL
                  ? "重玩最终关"
                  : `继续第 ${String(campaignUnlockedThrough).padStart(2, "0")} 关`}
                <span aria-hidden="true">→</span>
              </button>
            </footer>
          </section>
        </div>
      )}

      {showSuccess && puzzle && (
        <div
          className="modal-backdrop modal-backdrop--success"
          role="presentation"
          onClick={(event) => {
            if (event.target === event.currentTarget) setShowSuccess(false);
          }}
        >
          <section
            className="success-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="success-title"
          >
            <div className="success-orbit" aria-hidden="true">
              <span />
              <i />
            </div>
            <span className="eyebrow">
              {gameMode === "campaign"
                ? `百关协议 · LEVEL ${String(campaignLevel).padStart(3, "0")}`
                : "回收轨迹稳定"}
            </span>
            <h2 id="success-title">
              {gameMode === "campaign" && campaignLevel === CAMPAIGN_TOTAL
                ? "百关完成"
                : gameMode === "campaign"
                  ? `第 ${String(campaignLevel).padStart(2, "0")} 关稳定`
                  : "平衡锁定"}
            </h2>
            <p>
              {gameMode === "campaign"
                ? campaignLevel === CAMPAIGN_TOTAL
                  ? "全部回收轨迹均已稳定。百关协议执行完毕。"
                  : "本关横向与纵向力矩均已归零，下一关现已解锁。"
                : "横向与纵向力矩均已归零。当前浮空配置可以执行回收。"}
              {gameMode === "campaign" && campaignHintReward > 0
                ? ` 提示补给恢复 ${campaignHintReward} 次，当前 ${campaignHintBalance}/${CAMPAIGN_HINT_CAPACITY}。`
                : ""}
            </p>
            <dl>
              <div>
                <dt>完成用时</dt>
                <dd>{formatTime(elapsed)}</dd>
              </div>
              <div>
                <dt>操作次数</dt>
                <dd>{moves}</dd>
              </div>
              <div>
                <dt>{gameMode === "campaign" ? "本关提示" : "提示次数"}</dt>
                <dd>{hints}</dd>
              </div>
              <div>
                <dt>{gameMode === "campaign" ? "闯关进度" : "连续完成"}</dt>
                <dd>
                  {gameMode === "campaign"
                    ? `${campaignCompleted.length}/100`
                    : streak}
                </dd>
              </div>
            </dl>
            <div className="success-actions">
              <button
                className="button button--quiet"
                type="button"
                onClick={() => setShowSuccess(false)}
              >
                查看完成结果
              </button>
              <button
                className="button button--quiet"
                type="button"
                onClick={() => {
                  setShowSuccess(false);
                  setAssignments({});
                  setHistory([]);
                  setMoves(0);
                  setHints(0);
                  setElapsed(0);
                  completionHandled.current = false;
                  startedAt.current = Date.now();
                }}
              >
                再玩一次
              </button>
              <button
                className="button button--primary"
                type="button"
                onClick={() => {
                  setShowSuccess(false);
                  if (gameMode === "campaign") {
                    if (campaignLevel === CAMPAIGN_TOTAL) {
                      setShowCampaign(true);
                    } else {
                      loadCampaignLevel(campaignLevel + 1);
                    }
                    return;
                  }
                  loadPuzzle(createRandomSeed(), difficulty, { mode: "free" });
                }}
              >
                {gameMode === "campaign"
                  ? campaignLevel === CAMPAIGN_TOTAL
                    ? "查看航线"
                    : "下一关"
                  : "下一任务"}{" "}
                <span aria-hidden="true">→</span>
              </button>
            </div>
          </section>
        </div>
      )}

      {toast && (
        <div className="toast" role="status">
          <i />
          {toast}
        </div>
      )}
    </main>
  );
}
