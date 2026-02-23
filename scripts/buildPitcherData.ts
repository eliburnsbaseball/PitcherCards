// scripts/buildPitcherData.ts
import fs from "fs";
import path from "path";
import * as Papa from "papaparse";
import { ALL_PITCH_CODES, PITCH_META, PitchCode } from "../lib/pitchMeta";

type CombinedRow = {
  pitcher_id: string | number;
  pitcher_name: string;
  pitch_type: string;
  count: string | number;
  pitch_percent: string | number;
  rhh_percent: string | number;
  lhh_percent: string | number;
  start_speed: string | number;
  max_start_speed: string | number;
  ivb: string | number;
  hb: string | number;
  release_pos_z: string | number;
  release_pos_x: string | number;
  extension: string | number;
  tj_stuff_plus?: string | number;
};

type SavantRow = Record<string, string>;
type AnyRow = Record<string, any>;

type PitchOut = {
  code: PitchCode;
  title: string;
  color: string;

  // From combined CSV
  count: number;
  pitch_percent: number;
  rhh_percent: number;
  lhh_percent: number;
  start_speed: number;
  max_start_speed: number;
  ivb: number;
  hb: number;
  release_pos_z: number;
  release_pos_x: number;
  extension: number;

  // From original pitch-type CSVs
  spin_rate?: number | null;
  whiffs_per_pitch?: number | null;
  swing_miss_percent?: number | null;
  arm_angle?: number | null;
  barrels_per_pa_percent?: number | null;
  hardhit_percent?: number | null;

  // From active-spin.csv (spin efficiency, 0..100)
  active_spin_percent?: number | null;

  // Helpful raw totals
  whiffs?: number | null;
  swings?: number | null;
  pitches?: number | null;
};

type PitcherOut = {
  pitcher_id: string;
  pitcher_name: string;
  pitches: PitchOut[];
};

function readCsvFile<T = any>(filePath: string): T[] {
  const csvText = fs.readFileSync(filePath, "utf8");
  const parsed = Papa.parse<T>(csvText, {
    header: true,
    dynamicTyping: false,
    skipEmptyLines: true,
  });
  if ((parsed as any).errors?.length) {
    console.warn(
      `CSV parse warnings for ${filePath}:`,
      (parsed as any).errors.slice(0, 3)
    );
  }
  return (parsed.data as any[]).filter((r) => r && Object.keys(r).length > 0);
}

function toNum(v: unknown): number {
  if (v === null || v === undefined) return NaN;
  const s = String(v).trim();
  if (s === "" || s.toLowerCase() === "null" || s.toLowerCase() === "nan")
    return NaN;
  const n = Number(s);
  return Number.isFinite(n) ? n : NaN;
}

function numOrNull(v: unknown): number | null {
  const n = toNum(v);
  return Number.isFinite(n) ? n : null;
}

function safePitchCode(code: string): PitchCode | null {
  const c = (code || "").trim().toUpperCase();
  return (ALL_PITCH_CODES as string[]).includes(c) ? (c as PitchCode) : null;
}

function ensureDir(p: string) {
  fs.mkdirSync(p, { recursive: true });
}

function guessSavantFileForCode(rawDir: string, code: PitchCode): string | null {
  const files = fs.readdirSync(rawDir);
  const match = files.find((f) =>
    f.toLowerCase().endsWith(`_${code.toLowerCase()}.csv`)
  );
  return match ? path.join(rawDir, match) : null;
}

function buildEnrichmentMap(rawDir: string) {
  // Map: pitcher_id -> pitch_code -> enrichment metrics
  const enrich = new Map<string, Map<PitchCode, Partial<PitchOut>>>();

  for (const code of ALL_PITCH_CODES) {
    const file = guessSavantFileForCode(rawDir, code);
    if (!file) {
      console.warn(
        `⚠️ Missing savant CSV for ${code}. Expected a file ending with _${code}.csv in ${rawDir}`
      );
      continue;
    }

    const rows = readCsvFile<SavantRow>(file);

    for (const r of rows) {
      const pitcherId = (r["player_id"] ?? "").toString().trim();
      if (!pitcherId) continue;

      const pitches = numOrNull(r["pitches"]);
      const whiffs = numOrNull(r["whiffs"]);
      const swings = numOrNull(r["swings"]);

      const whiffsPerPitch =
        pitches && pitches > 0 && whiffs !== null ? whiffs / pitches : null;

      const entry: Partial<PitchOut> = {
        pitches,
        whiffs,
        swings,
        spin_rate: numOrNull(r["spin_rate"]),
        swing_miss_percent: numOrNull(r["swing_miss_percent"]),
        arm_angle: numOrNull(r["arm_angle"]),
        barrels_per_pa_percent: numOrNull(r["barrels_per_pa_percent"]),
        hardhit_percent: numOrNull(r["hardhit_percent"]),
        whiffs_per_pitch: whiffsPerPitch,
      };

      if (!enrich.has(pitcherId)) enrich.set(pitcherId, new Map());
      enrich.get(pitcherId)!.set(code, entry);
    }
  }

  return enrich;
}

function normalizeKey(s: string) {
  return (s ?? "")
    .toString()
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_")
    .replace(/[^a-z0-9_]/g, "");
}

/**
 * active-spin.csv uses columns like:
 *  entity_id, entity_name, pitch_hand,
 *  active_spin_fourseam, active_spin_sinker, ...
 */
const ACTIVE_SPIN_PITCHNAME_TO_CODE: Record<string, PitchCode> = {
  fourseam: "FF",
  four_seam: "FF",
  "4seam": "FF",
  ff: "FF",

  sinker: "SI",
  si: "SI",

  cutter: "FC",
  fc: "FC",

  changeup: "CH",
  ch: "CH",

  splitter: "FS",
  fs: "FS",

  forkball: "FO",
  fo: "FO",

  screwball: "SC",
  sc: "SC",

  curve: "CU",
  curveball: "CU",
  cu: "CU",

  knucklecurve: "KC",
  knuckle_curve: "KC",
  kc: "KC",

  slowcurve: "CS",
  slow_curve: "CS",
  cs: "CS",

  slider: "SL",
  sl: "SL",

  sweeper: "ST",
  st: "ST",

  slurve: "SV",
  sv: "SV",
};

function buildActiveSpinMap(rawDir: string) {
  // Map: pitcher_id -> pitch_code -> active spin %
  // If multiple rows per pitcher exist, we average by pitch.
  const sums = new Map<string, Map<PitchCode, { sum: number; n: number }>>();

  const file = path.join(rawDir, "active-spin.csv");
  if (!fs.existsSync(file)) {
    console.warn(
      `⚠️ No active-spin.csv found at ${file}. Active Spin% will be blank (—).`
    );
    return new Map<string, Map<PitchCode, number>>();
  }

  const rows = readCsvFile<AnyRow>(file);
  if (!rows.length) {
    console.warn(`⚠️ active-spin.csv had 0 rows.`);
    return new Map<string, Map<PitchCode, number>>();
  }

  const sample = rows[0];
  const keys = Object.keys(sample);
  const normKeys = keys.map((k) => normalizeKey(k));

  // ✅ include entity_id (your file)
  const acceptableIdKeys = new Set([
    "player_id",
    "pitcher_id",
    "mlbam_id",
    "mlb_id",
    "id",
    "entity_id",
    "entityid",
  ]);

  let idKey: string | null = null;
  for (let i = 0; i < keys.length; i++) {
    if (acceptableIdKeys.has(normKeys[i])) {
      idKey = keys[i];
      break;
    }
  }

  if (!idKey) {
    console.warn(
      `⚠️ active-spin.csv: Could not find a pitcher id column. Found columns: ${keys
        .slice(0, 25)
        .join(", ")} ...`
    );
    return new Map<string, Map<PitchCode, number>>();
  }

  const activeCols = keys.filter((k) =>
    normalizeKey(k).startsWith("active_spin_")
  );

  if (!activeCols.length) {
    console.warn(
      `⚠️ active-spin.csv: No columns starting with "active_spin_". Found columns: ${keys
        .slice(0, 25)
        .join(", ")} ...`
    );
    return new Map<string, Map<PitchCode, number>>();
  }

  for (const r of rows) {
    const pitcherId = String(r[idKey] ?? "").trim();
    if (!pitcherId) continue;

    for (const col of activeCols) {
      const norm = normalizeKey(col); // active_spin_fourseam
      const pitchName = norm.replace(/^active_spin_/, ""); // fourseam
      const code = ACTIVE_SPIN_PITCHNAME_TO_CODE[pitchName];
      if (!code) continue;

      const val = numOrNull(r[col]);
      if (val == null) continue;

      if (!sums.has(pitcherId)) sums.set(pitcherId, new Map());
      const m = sums.get(pitcherId)!;

      const cur = m.get(code) ?? { sum: 0, n: 0 };
      cur.sum += val;
      cur.n += 1;
      m.set(code, cur);
    }
  }

  const out = new Map<string, Map<PitchCode, number>>();
  for (const [pid, perPitch] of sums.entries()) {
    const m = new Map<PitchCode, number>();
    for (const [code, agg] of perPitch.entries()) {
      if (agg.n > 0) m.set(code, agg.sum / agg.n);
    }
    if (m.size) out.set(pid, m);
  }

  console.log(
    `🌀 active-spin: idKey="${idKey}", activeCols=${activeCols.length}, mappedPitchers=${out.size}`
  );

  return out;
}

function main() {
  const repoRoot = process.cwd();
  const rawDir = path.join(repoRoot, "data", "raw");

  const combinedPath = path.join(rawDir, "pitchmovementdata.csv");
  if (!fs.existsSync(combinedPath)) {
    throw new Error(`Missing combined CSV at: ${combinedPath}`);
  }

  const combinedRows = readCsvFile<CombinedRow>(combinedPath);

  const enrichMap = buildEnrichmentMap(rawDir);
  const activeSpinMap = buildActiveSpinMap(rawDir);

  const pitchers = new Map<string, PitcherOut>();

  for (const r of combinedRows) {
    const pitcherId = String(r.pitcher_id).trim();
    const pitcherName = (r.pitcher_name ?? "").toString().trim();
    const code = safePitchCode((r.pitch_type ?? "").toString());
    if (!pitcherId || !pitcherName || !code) continue;

    if (!pitchers.has(pitcherId)) {
      pitchers.set(pitcherId, {
        pitcher_id: pitcherId,
        pitcher_name: pitcherName,
        pitches: [],
      });
    }

    const base: PitchOut = {
      code,
      title: PITCH_META[code].title,
      color: PITCH_META[code].color,

      count: toNum(r.count),
      pitch_percent: toNum(r.pitch_percent),
      rhh_percent: toNum(r.rhh_percent),
      lhh_percent: toNum(r.lhh_percent),
      start_speed: toNum(r.start_speed),
      max_start_speed: toNum(r.max_start_speed),
      ivb: toNum(r.ivb),
      hb: toNum(r.hb),
      release_pos_z: toNum(r.release_pos_z),
      release_pos_x: toNum(r.release_pos_x),
      extension: toNum(r.extension),
    };

    const enrichForPitcher = enrichMap.get(pitcherId);
    const enrich = enrichForPitcher?.get(code);
    if (enrich) Object.assign(base, enrich);

    const spinForPitcher = activeSpinMap.get(pitcherId);
    base.active_spin_percent = spinForPitcher?.get(code) ?? null;

    pitchers.get(pitcherId)!.pitches.push(base);
  }

  for (const p of pitchers.values()) {
    p.pitches.sort((a, b) => (b.pitch_percent ?? 0) - (a.pitch_percent ?? 0));
  }

  const outDir = path.join(repoRoot, "public", "data");
  const outPitchersDir = path.join(outDir, "pitchers");
  ensureDir(outPitchersDir);

  const index = Array.from(pitchers.values())
    .map((p) => ({ pitcher_id: p.pitcher_id, pitcher_name: p.pitcher_name }))
    .sort((a, b) => a.pitcher_name.localeCompare(b.pitcher_name));

  fs.writeFileSync(
    path.join(outDir, "pitchers_index.json"),
    JSON.stringify(index, null, 2),
    "utf8"
  );

  for (const p of pitchers.values()) {
    fs.writeFileSync(
      path.join(outPitchersDir, `${p.pitcher_id}.json`),
      JSON.stringify(p, null, 2),
      "utf8"
    );
  }

  const totalPitchers = index.length;
  const totalPitchRows = combinedRows.length;

  const pitchersWithAnyEnrich = Array.from(pitchers.values()).filter((p) =>
    p.pitches.some((x) => x.spin_rate !== undefined || x.arm_angle !== undefined)
  ).length;

  const pitchersWithAnyActiveSpin = Array.from(pitchers.values()).filter((p) =>
    p.pitches.some((x) => x.active_spin_percent != null)
  ).length;

  console.log(
    `✅ Built JSON for ${totalPitchers} pitchers from ${totalPitchRows} combined rows.`
  );
  console.log(
    `ℹ️ Pitchers with at least some enrichment: ${pitchersWithAnyEnrich}/${totalPitchers}`
  );
  console.log(
    `🌀 Pitchers with at least some Active Spin%: ${pitchersWithAnyActiveSpin}/${totalPitchers}`
  );
  console.log(`📄 Wrote: public/data/pitchers_index.json`);
  console.log(`📁 Wrote: public/data/pitchers/{pitcher_id}.json`);
}

main();