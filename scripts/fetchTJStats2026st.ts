// scripts/fetchTJStats2026st.ts
import fs from "fs";
import path from "path";

const BASE = "https://nesticot-mlb-pitching-app.hf.space";

function ensureDir(p: string) {
  fs.mkdirSync(p, { recursive: true });
}

async function fetchText(url: string) {
  const res = await fetch(url, {
    // Helps avoid cached HTML
    headers: {
      "user-agent": "Mozilla/5.0",
      "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    },
    redirect: "follow",
  });
  if (!res.ok) throw new Error(`GET ${url} -> ${res.status}`);
  return await res.text();
}

async function fetchBuffer(url: string) {
  const res = await fetch(url, {
    headers: {
      "user-agent": "Mozilla/5.0",
      "accept": "text/csv,text/plain,application/octet-stream,*/*",
      "referer": BASE + "/",
    },
    redirect: "follow",
  });
  if (!res.ok) throw new Error(`GET ${url} -> ${res.status}`);
  const ab = await res.arrayBuffer();
  return Buffer.from(ab);
}

function extractSessionId(html: string): string | null {
  // Look for /session/<hex>/ anywhere in the HTML
  // Your session id looked like a long hex string.
  const m = html.match(/\/session\/([0-9a-f]{20,})\//i);
  return m?.[1] ?? null;
}

async function main() {
  console.log("Loading app shell…");
  const html = await fetchText(BASE + "/");

  const sessionId = extractSessionId(html);
  if (!sessionId) {
    // If this fails, it usually means the session id is created after JS runs,
    // in which case use Option 2 (Playwright).
    throw new Error(
      `Could not find session id in initial HTML. This app likely creates the session via JS/websocket after load.`
    );
  }

  console.log("Session:", sessionId);

  const downloadUrl = `${BASE}/session/${sessionId}/download/download_all?w=`;
  console.log("Downloading:", downloadUrl);

  const csv = await fetchBuffer(downloadUrl);

  const outDir = path.join(process.cwd(), "data", "raw", "2026st");
  ensureDir(outDir);

  // This is the file your buildPitcherData.ts expects for 2026st
  const outPath = path.join(outDir, "pitchmovementdata.csv");
  fs.writeFileSync(outPath, csv);

  console.log(`✅ Saved ${csv.length} bytes -> ${outPath}`);
}

main().catch((e) => {
  console.error("❌ fetchTJStats2026st failed:", e);
  process.exit(1);
});