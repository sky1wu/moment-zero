import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";

async function render(path = "/", environment = {}) {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request(`http://localhost${path}`, {
      headers: { accept: "text/html" },
    }),
    {
      ...environment,
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );
}

test("server-renders the Moment Zero product shell", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<html lang="zh-CN">/i);
  assert.match(html, /<title>零矩协议｜浮空回收平衡挑战<\/title>/i);
  assert.match(html, /零矩协议/);
  assert.match(html, /平衡全部气球/);
  assert.match(html, /输入题目种子/);
  assert.match(html, /复制题目种子/);
  assert.match(html, /载入/);
  assert.match(html, /每日一题/);
  assert.doesNotMatch(html, /移除模式/);
  assert.match(html, /正在构造唯一解任务/);
  assert.doesNotMatch(html, /codex-preview|Your site is taking shape/);
});

test("serves an opaque deterministic daily challenge", async () => {
  const previousSecret = process.env.DAILY_SEED_SECRET;
  process.env.DAILY_SEED_SECRET =
    "test-only-secret-that-is-long-enough-for-hmac";
  try {
    const [firstResponse, secondResponse] = await Promise.all([
      render("/api/daily"),
      render("/api/daily"),
    ]);
    assert.equal(firstResponse.status, 200);
    assert.equal(secondResponse.status, 200);

    const first = await firstResponse.json();
    const second = await secondResponse.json();
    assert.deepEqual(first, second);
    assert.match(first.date, /^\d{4}-\d{2}-\d{2}$/);
    assert.match(first.seed, /^MZ-[A-Z0-9]{8}$/);
    assert.equal(first.difficulty, "normal");
    assert.doesNotMatch(first.seed, /\d{8}/);
  } finally {
    if (previousSecret === undefined) {
      delete process.env.DAILY_SEED_SECRET;
    } else {
      process.env.DAILY_SEED_SECRET = previousSecret;
    }
  }
});

test("ships the solver and removes starter-only assets", async () => {
  const [core, page, layout, styles, dailyRoute, packageJson] = await Promise.all([
    readFile(new URL("../app/game-core.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
    readFile(new URL("../app/api/daily/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
  ]);

  assert.match(core, /export function generatePuzzle/);
  assert.match(core, /export function solvePuzzle/);
  assert.match(core, /BALLOON_COUNT_RANGES/);
  assert.match(core, /const size = 5/);
  assert.match(core, /type PatternMode = "central" \| "axis" \| "freeform"/);
  assert.match(core, /addAxisRectangle/);
  assert.match(core, /addSymmetricDistractorPair/);
  assert.doesNotMatch(core, /createDailySeed/);
  assert.doesNotMatch(core, /addPoint\(0, 0, null, 1\)/);
  assert.match(core, /requireOpposite && x === 0 && y === 0/);
  assert.match(core, /solutionCount >= limit/);
  assert.match(page, /calculateMoment/);
  assert.match(page, /<span>\{LIFT_BY_LEVEL\[level\]\}<\/span>/);
  assert.match(page, /moment-zero-daily-endpoint/);
  assert.match(page, /configuredEndpoint \|\| "\/api\/daily"/);
  assert.match(page, /cache: "no-store"/);
  assert.match(page, /每日一题/);
  assert.match(page, /loadDailyPuzzle/);
  assert.match(
    page,
    /gameMode === "campaign" \? "随机模式" : "闯关模式"/,
  );
  assert.match(page, /className="campaign-map-button"/);
  assert.doesNotMatch(
    page,
    /gameMode === "campaign" \? "关卡地图" : "闯关模式"/,
  );
  assert.match(dailyRoute, /DAILY_SEED_SECRET/);
  assert.match(dailyRoute, /HMAC/);
  assert.doesNotMatch(dailyRoute, /searchParams/);
  assert.match(page, /navigator\.clipboard\.writeText/);
  assert.match(page, /async function copySeed\(\)/);
  assert.match(page, /flash\("种子已复制"\)/);
  assert.match(page, /aria-label="复制题目种子"/);
  assert.match(page, /moment-axis--vertical/);
  assert.match(page, /moment-axis--horizontal/);
  assert.match(page, /moment-axis__arrow/);
  assert.doesNotMatch(page, /const horizontalArrow|const verticalArrow/);
  assert.match(page, /platform-tilt/);
  assert.doesNotMatch(page, /status-chip|platform-summary|statusText/);
  assert.doesNotMatch(styles, /\.status-chip|\.platform-summary/);
  assert.match(page, /data-multiplier=\{mount\.multiplier\}/);
  assert.match(
    page,
    /<button\s+type="button"\s+key=\{mount\.id\}[\s\S]*?role="gridcell"/,
  );
  assert.match(page, /data-balloon-level=\{level\}/);
  assert.match(styles, /\.board-cell--mount\[data-multiplier="2"\]/);
  assert.match(styles, /\.board-cell--mount\[data-multiplier="3"\]/);
  assert.match(
    styles,
    /\.board-cell\s*\{[\s\S]*?opacity:\s*1;[\s\S]*?cell-enter[^;]*backwards;/,
  );
  assert.doesNotMatch(styles, /cell-enter[^;]*forwards/);
  assert.match(
    styles,
    /\.board-cell--mount\.has-balloon\s*\{[\s\S]*?\}\s*\.board-cell--mount:hover\s*\{/,
  );
  assert.doesNotMatch(
    styles,
    /\.board-cell--mount:hover\s*\{[^}]*transform:/,
  );
  assert.match(
    styles,
    /\.mount-crosshair\s*\{[\s\S]*?pointer-events:\s*none;/,
  );
  assert.match(
    styles,
    /\.mount-multiplier\s*\{[\s\S]*?pointer-events:\s*none;/,
  );
  assert.match(styles, /\.balloon-mark--2\s*\{[\s\S]*?--balloon-color:/);
  assert.match(styles, /\.balloon-mark--3\s*\{[\s\S]*?--balloon-color:/);
  assert.match(styles, /\.balloon-mark--4\s*\{[\s\S]*?--balloon-color:/);
  assert.match(
    styles,
    /\.inventory-item:disabled\s*\{[\s\S]*?pointer-events:\s*none;/,
  );
  assert.doesNotMatch(page, /<p>\s*X \{moment\.x/);
  assert.match(page, /inventory-drag-source/);
  assert.match(page, /mounted-balloon-drag-source/);
  assert.doesNotMatch(
    page,
    /<button[\s\S]{0,160}className="mounted-balloon-drag-source"/,
  );
  assert.match(page, /beginPointerDrag/);
  assert.match(page, /const POINTER_DRAG_THRESHOLD = 6/);
  assert.match(page, /function crossedDragThreshold/);
  assert.match(page, /pointerDragRef\.current = nextDrag/);
  assert.match(page, /function suppressNextMountClick/);
  assert.match(page, /tapMountId: string \| null/);
  assert.match(
    page,
    /beginPointerDrag\(event, selectedLevel, null, sourceMountId\)/,
  );
  assert.match(
    page,
    /if \(nextDrag\.hasMoved \|\| nextDrag\.tapMountId === null\)/,
  );
  assert.match(page, /const nextRemaining = \{ \.\.\.remaining \}/);
  assert.match(
    page,
    /LEVELS\.find\(\(level\) => nextRemaining\[level\] > 0\) \?\? null/,
  );
  assert.match(
    page,
    /sourceMountId === null && remaining\[level\] <= 0/,
  );
  assert.match(page, /function beginBoardPointerDrag/);
  assert.match(page, /onPointerDown=\{beginBoardPointerDrag\}/);
  assert.match(
    page,
    /closest<HTMLElement>\("\[data-mount-id\]"\)\?\.dataset\.mountId/,
  );
  assert.match(page, /if \(event\.pointerType !== "mouse"\)/);
  assert.match(page, /setPointerCapture\(event\.pointerId\)/);
  assert.match(
    page,
    /if \(event\.pointerType !== "mouse"\) \{\s*beginPointerDrag\(event, level, mount\.id\)/,
  );
  assert.match(page, /window\.addEventListener\("pointermove"/);
  assert.match(page, /window\.addEventListener\("pointerup"/);
  assert.match(page, /window\.addEventListener\("pointercancel"/);
  assert.match(page, /window\.removeEventListener\("pointermove"/);
  assert.match(page, /globalDragListenersRef\.current\.remove\(\)/);
  assert.match(page, /passive: false/);
  assert.match(
    page,
    /document\.addEventListener\("touchmove", blockTouchScrollWhileDragging/,
  );
  assert.match(
    page,
    /if \(pointerDragRef\.current && event\.cancelable\) event\.preventDefault\(\)/,
  );
  assert.match(page, /elementsFromPoint/);
  assert.match(
    page,
    /targetMountId === active\.sourceMountId &&\s*!hasMoved[\s\S]*?placeBalloon\(targetMountId, selectedLevel\)/,
  );
  assert.match(
    page,
    /targetMountId === active\.tapMountId &&\s*!hasMoved[\s\S]*?placeBalloon\(targetMountId, active\.level\)/,
  );
  assert.match(
    page,
    /onPointerUp=\{\(event\) => \{\s*if \(pointerDragRef\.current\) return;[\s\S]*?suppressNextMountClick\(mount\.id\);[\s\S]*?placeBalloon\(mount\.id, selectedLevel\)/,
  );
  assert.match(
    page,
    /onClick=\{\(\) => \{[\s\S]*?suppressedMountClickRef\.current === mount\.id[\s\S]*?placeBalloon\(mount\.id, selectedLevel\)/,
  );
  assert.match(page, /drag-preview/);
  assert.match(page, /returnBalloonToInventory/);
  assert.match(page, /overPlatform/);
  assert.match(page, /className="drag-preview drag-preview--card"/);
  assert.match(page, /className="drag-preview__copy"/);
  assert.doesNotMatch(page, /sourceMountId === null && \(/);
  assert.match(page, /!hasCenterMount && <div className="center-mark"/);
  assert.match(page, /查看完成结果/);
  assert.match(page, /event\.key === "Escape" && showSuccess/);
  assert.match(page, /event\.target === event\.currentTarget/);
  assert.doesNotMatch(page, /minWidth:\s*108/);
  assert.doesNotMatch(page, /maxHeight:\s*108/);
  assert.match(
    styles,
    /\.drag-preview--card\s*\{[\s\S]*?width:\s*108px !important;[\s\S]*?height:\s*108px !important;/,
  );
  assert.match(
    styles,
    /@media \(max-width:\s*820px\)[\s\S]*?\.drag-preview--card\s*\{[\s\S]*?width:\s*92px !important;[\s\S]*?height:\s*92px !important;/,
  );
  assert.match(
    styles,
    /\.mission-rail\s*\{[\s\S]*?align-items:\s*end;[\s\S]*?gap:\s*clamp\(/,
  );
  assert.match(
    styles,
    /\.mission-setting\s*\{[\s\S]*?align-items:\s*end;/,
  );
  assert.match(
    styles,
    /\.mission-setting\s*\{[\s\S]*?grid-template-columns:\s*minmax\(260px,\s*320px\) minmax\(150px,\s*1fr\);/,
  );
  assert.match(
    styles,
    /\.seed-block\s*>\s*div\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0,\s*1fr\) auto auto;/,
  );
  assert.match(
    styles,
    /@media \(max-width:\s*540px\)[\s\S]*?\.seed-block__copy\s*\{[\s\S]*?display:\s*none;/,
  );
  assert.match(styles, /\.mission-rail\s*>\s*\*,\s*\.mission-setting\s*>\s*\*/);
  assert.match(
    styles,
    /@media \(max-width:\s*960px\)[\s\S]*?\.topbar__mission,[\s\S]*?display:\s*none;/,
  );
  assert.match(
    styles,
    /@media \(max-width:\s*1040px\)[\s\S]*?grid-template-columns:\s*minmax\(440px,\s*1fr\) minmax\(220px,\s*0\.55fr\) max-content;/,
  );
  assert.match(
    styles,
    /@media \(max-width:\s*960px\)[\s\S]*?grid-template-areas:\s*"setting setting"\s*"metrics rules";/,
  );
  assert.match(
    styles,
    /@media \(max-width:\s*960px\)[\s\S]*?\.mission-metrics\s*\{[\s\S]*?display:\s*grid;[\s\S]*?grid-template-columns:\s*repeat\(4,\s*minmax\(0,\s*1fr\)\);/,
  );
  assert.match(
    styles,
    /\.board-assembly\s*\{[\s\S]*?grid-template-columns:\s*34px minmax\(0,\s*1fr\) 34px;[\s\S]*?column-gap:\s*16px;[\s\S]*?row-gap:\s*16px;/,
  );
  assert.match(styles, /\.moment-axis__arrow::before/);
  assert.match(
    styles,
    /\.moment-axis--vertical \.moment-axis__arrow\s*\{[\s\S]*?width:\s*27px;[\s\S]*?height:\s*27px;/,
  );
  assert.match(
    styles,
    /@media \(max-width:\s*820px\)[\s\S]*?\.inventory-rail\s*\{[\s\S]*?position:\s*fixed;[\s\S]*?bottom:\s*0;/,
  );
  assert.match(layout, /零矩协议/);
  assert.doesNotMatch(packageJson, /react-loading-skeleton/);
  const previewDirectory = new URL("../app/_sites-preview", import.meta.url);
  const previewFiles = await readdir(previewDirectory).catch(() => []);
  assert.deepEqual(previewFiles, []);
});
