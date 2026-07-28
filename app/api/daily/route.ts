const SEED_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";

function utcDateKey(date: Date) {
  const year = String(date.getUTCFullYear()).padStart(4, "0");
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

async function deriveDailySeed(secret: string, dateKey: string) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = new Uint8Array(
    await crypto.subtle.sign("HMAC", key, encoder.encode(`moment-zero:${dateKey}`)),
  );
  const token = Array.from(
    signature.slice(0, 8),
    (byte) => SEED_ALPHABET[byte % SEED_ALPHABET.length],
  ).join("");
  return `MZ-${token}`;
}

export async function GET() {
  const secret = process.env.DAILY_SEED_SECRET;
  if (!secret || secret.length < 32) {
    return Response.json(
      { error: "每日题暂时不可用" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }

  const now = new Date();
  const date = utcDateKey(now);
  const seed = await deriveDailySeed(secret, date);
  const nextUtcDay = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate() + 1,
  );
  const secondsUntilNextDay = Math.max(
    1,
    Math.floor((nextUtcDay - now.getTime()) / 1000),
  );

  return Response.json(
    { date, seed, difficulty: "normal" },
    {
      headers: {
        "Cache-Control": `public, max-age=60, s-maxage=${secondsUntilNextDay}, stale-while-revalidate=30`,
      },
    },
  );
}
