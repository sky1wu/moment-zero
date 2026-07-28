import { createHmac } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const SEED_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";

export function utcDateKey(date = new Date()) {
  const year = String(date.getUTCFullYear()).padStart(4, "0");
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function deriveDailySeed(secret, dateKey) {
  if (typeof secret !== "string" || secret.length < 32) {
    throw new Error("DAILY_SEED_SECRET 必须至少包含 32 个字符");
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) {
    throw new Error("每日题日期格式无效");
  }

  const signature = createHmac("sha256", secret)
    .update(`moment-zero:${dateKey}`)
    .digest();
  const token = Array.from(
    signature.subarray(0, 8),
    (byte) => SEED_ALPHABET[byte % SEED_ALPHABET.length],
  ).join("");
  return `MZ-${token}`;
}

export function createDailyChallenge(secret, date = new Date()) {
  const dateKey = utcDateKey(date);
  return {
    date: dateKey,
    seed: deriveDailySeed(secret, dateKey),
    difficulty: "normal",
  };
}

export async function writeDailyChallenge(outputPath, secret, date = new Date()) {
  const absolutePath = resolve(outputPath);
  await mkdir(dirname(absolutePath), { recursive: true });
  await writeFile(
    absolutePath,
    `${JSON.stringify(createDailyChallenge(secret, date))}\n`,
    "utf8",
  );
}

async function main() {
  const outputPath = process.argv[2];
  if (!outputPath) {
    throw new Error(
      "用法：node scripts/generate-daily-challenge.mjs <输出文件>",
    );
  }
  await writeDailyChallenge(outputPath, process.env.DAILY_SEED_SECRET);
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
