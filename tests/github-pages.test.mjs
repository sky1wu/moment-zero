import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";
import {
  createDailyChallenge,
  deriveDailySeed,
} from "../scripts/generate-daily-challenge.mjs";

test("builds a standalone GitHub Pages application", async () => {
  const html = await readFile(
    new URL("../github-pages-dist/index.html", import.meta.url),
    "utf8",
  );
  const assets = await readdir(
    new URL("../github-pages-dist/assets", import.meta.url),
  );

  assert.match(html, /<html lang="zh-CN">/);
  assert.match(html, /零矩协议｜浮空回收平衡挑战/);
  assert.match(html, /moment-zero-daily-endpoint/);
  assert.match(html, /\.\/daily\.json/);
  assert.ok(assets.some((file) => file.endsWith(".js")));
  assert.ok(assets.some((file) => file.endsWith(".css")));
});

test("derives opaque deterministic daily seeds from a secret", () => {
  const secret = "test-only-secret-that-is-long-enough-for-hmac";
  const date = new Date("2026-07-28T12:00:00Z");
  const challenge = createDailyChallenge(secret, date);

  assert.deepEqual(challenge, {
    date: "2026-07-28",
    seed: deriveDailySeed(secret, "2026-07-28"),
    difficulty: "normal",
  });
  assert.match(challenge.seed, /^MZ-[A-Z0-9]{8}$/);
  assert.notEqual(
    challenge.seed,
    deriveDailySeed(secret, "2026-07-29"),
  );
});
