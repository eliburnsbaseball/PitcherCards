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

  // From savant pitch-type CSVs
  spin_rate?: number | null;
  whiffs_per_pitch?: number | null;
  swing_miss_percent?: number | null;
  arm_angle?: number | null;
  barrels_per_pa_percent?: number | null;
  hardhit_percent?: number | null;

  // From active-spin.csv (0..100)
  active_spin_percent?: number | null;

  // Helpful raw totals
  whiffs?: number | null;
  swings?: number | null;
  pitches?: number | null;
};

type PitcherOut = {
  pitcher_id: string; // dataset primary key (usually MLBAM, but not assumed)
  pitcher_name: string;
  mlbam_id?: string | null; // used for headshot/team lookups
  arm_angle_source?: "dataset" | "2025"; // when 2026st borrows arm angle
  pitches: PitchOut[];
};

function readCsvFile<T = any>(filePath: string): T[] {
  const csvText = fs.readFileSync(filePath, "utf8");
  const parsed = Papa.parse<T>(csvText, {
    header: true,
    dynamicTyping: false,
    skipEmptyLines: true,
  });

  const errs = (parsed as any).errors;
  if (errs?.length) {
    console.warn(`CSV parse warnings for ${filePath}:`, errs.slice(0, 3));
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

function normalizeKey(s: string) {
  return (s ?? "")
    .toString()
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_")
    .replace(/[^a-z0-9_]/g, "");
}

function normalizeName(name: string) {
  return (name ?? "")
    .toLowerCase()
    .replace(/\./g, "")
    .replace(/'/g, "")
    .replace(/-/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function guessSavantFileForCode(rawDir: string, code: PitchCode): string | null {
  const files = fs.readdirSync(rawDir);
  // supports savant_2026st_FF.csv, savant_data_slider_SL.csv, etc
  const match = files.find((f) =>
    f.toLowerCase().endsWith(`_${code.toLowerCase()}.csv`)
  );
  return match ? path.join(rawDir, match) : null;
}

/**
 * Build enrichment map:
 *  pitcher_id -> pitch_code -> metrics
 *
 * Also builds name->player_id mapping from whatever name column exists
 * in these savant exports (player_name/name/pitcher_name).
 */
function buildEnrichmentMap(rawDir: string) {
  const enrich = new Map<string, Map<PitchCode, Partial<PitchOut>>>();
  const nameToId = new Map<string, string>();

  for (const code of ALL_PITCH_CODES) {
    const file = guessSavantFileForCode(rawDir, code);
    if (!file) {
      console.warn(
        `⚠️ Missing savant CSV for ${code}. Expected a file ending with _${code}.csv in ${rawDir}`
      );
      continue;
    }

    // Empty file guard (your FO/SC/CS sometimes)
    const stat = fs.statSync(file);
    if (stat.size < 10) {
      console.warn(`⚠️ Savant CSV for ${code} is empty (${path.basename(file)}). Skipping.`);
      continue;
    }

    const rows = readCsvFile<SavantRow>(file);
    if (!rows.length) continue;

    // detect columns
    const keys = Object.keys(rows[0]);
    const nk = keys.map(normalizeKey);

    const idKey =
      keys[nk.findIndex((k) =>
        ["player_id", "pitcher_id", "mlbam_id", "id", "entity_id"].includes(k)
      )] ?? "player_id";

    const nameKey =
      keys[nk.findIndex((k) =>
        ["player_name", "pitcher_name", "name", "player"].includes(k)
      )] ?? null;

    for (const r of rows) {
      const pitcherId = String((r as any)[idKey] ?? "").trim();
      if (!pitcherId) continue;

      if (nameKey) {
        const nm = String((r as any)[nameKey] ?? "").trim();
        if (nm) nameToId.set(normalizeName(nm), pitcherId);
      }

      const pitches = numOrNull((r as any)["pitches"]);
      const whiffs = numOrNull((r as any)["whiffs"]);
      const swings = numOrNull((r as any)["swings"]);

      const whiffsPerPitch =
        pitches && pitches > 0 && whiffs !== null ? whiffs / pitches : null;

      const entry: Partial<PitchOut> = {
        pitches,
        whiffs,
        swings,
        spin_rate: numOrNull((r as any)["spin_rate"]),
        swing_miss_percent: numOrNull((r as any)["swing_miss_percent"]),
        arm_angle: numOrNull((r as any)["arm_angle"]),
        barrels_per_pa_percent: numOrNull((r as any)["barrels_per_pa_percent"]),
        hardhit_percent: numOrNull((r as any)["hardhit_percent"]),
        whiffs_per_pitch: whiffsPerPitch,
      };

      if (!enrich.has(pitcherId)) enrich.set(pitcherId, new Map());
      enrich.get(pitcherId)!.set(code, entry);
    }
  }

  return { enrich, nameToId };
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
  const sums = new Map<string, Map<PitchCode, { sum: number; n: number }>>();
  const file = path.join(rawDir, "active-spin.csv");

  if (!fs.existsSync(file)) {
    console.warn(`⚠️ No active-spin.csv found at ${file}. Active Spin% will be blank (—).`);
    return new Map<string, Map<PitchCode, number>>();
  }

  const rows = readCsvFile<AnyRow>(file);
  if (!rows.length) {
    console.warn(`⚠️ active-spin.csv had 0 rows.`);
    return new Map<string, Map<PitchCode, number>>();
  }

  const keys = Object.keys(rows[0]);
  const nk = keys.map(normalizeKey);

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
    if (acceptableIdKeys.has(nk[i])) {
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

  const activeCols = keys.filter((k) => normalizeKey(k).startsWith("active_spin_"));
  if (!activeCols.length) {
    console.warn(
      `⚠️ active-spin.csv: No columns starting with "active_spin_". Found columns: ${keys
        .slice(0, 25)
        .join(", ")} ...`
    );
    return new Map<string, Map<PitchCode, number>>();
  }

  for (const r of rows) {
    const pitcherId = String((r as any)[idKey] ?? "").trim();
    if (!pitcherId) continue;

    for (const col of activeCols) {
      const norm = normalizeKey(col);
      const pitchName = norm.replace(/^active_spin_/, "");
      const code = ACTIVE_SPIN_PITCHNAME_TO_CODE[pitchName];
      if (!code) continue;

      const val = numOrNull((r as any)[col]);
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

  console.log(`🌀 active-spin: idKey="${idKey}", activeCols=${activeCols.length}, mappedPitchers=${out.size}`);
  return out;
}

/**
 * Build pitcher_id -> avg arm_angle from data/raw/2025 savant files.
 * Used as fallback for 2026st when those exports don't include arm_angle.
 */
function buildArmAngle2025FallbackMap(raw2025Dir: string): Map<string, number> {
  const sums = new Map<string, { sum: number; n: number }>();

  if (!fs.existsSync(raw2025Dir)) {
    console.warn(`⚠️ No 2025 raw dir at ${raw2025Dir}; cannot fallback arm angles.`);
    return new Map();
  }

  for (const code of ALL_PITCH_CODES) {
    const file = guessSavantFileForCode(raw2025Dir, code);
    if (!file) continue;

    const stat = fs.statSync(file);
    if (stat.size < 10) continue;

    const rows = readCsvFile<SavantRow>(file);
    if (!rows.length) continue;

    const keys = Object.keys(rows[0]);
    const nk = keys.map(normalizeKey);
    const idKey =
      keys[nk.findIndex((k) =>
        ["player_id", "pitcher_id", "mlbam_id", "id", "entity_id"].includes(k)
      )] ?? "player_id";

    for (const r of rows) {
      const pid = String((r as any)[idKey] ?? "").trim();
      if (!pid) continue;

      const a = numOrNull((r as any)["arm_angle"]);
      if (a == null) continue;

      const cur = sums.get(pid) ?? { sum: 0, n: 0 };
      cur.sum += a;
      cur.n += 1;
      sums.set(pid, cur);
    }
  }

  const out = new Map<string, number>();
  for (const [pid, agg] of sums.entries()) {
    if (agg.n > 0) out.set(pid, agg.sum / agg.n);
  }
  console.log(`🧭 arm-angle-2025 fallback map: ${out.size} pitchers`);
  return out;
}

function datasetKeyFromArg(arg: string | undefined): "2025" | "2026st" | "2025aaa" | "2025a" {
  if (!arg) return "2025";
  const a = arg.toLowerCase();
  if (a === "2025") return "2025";
  if (a === "2026" || a === "2026st" || a === "st" || a === "spring") return "2026st";
  if (a === "2025aaa" || a === "aaa") return "2025aaa";
  if (a === "2025a" || a === "a") return "2025a";
  return "2025";
}

function main() {
  const dataset = datasetKeyFromArg(process.argv[2]);
  const repoRoot = process.cwd();

  const rawDir = path.join(repoRoot, "data", "raw", dataset);

  if (!fs.existsSync(rawDir)) {
    console.log(`ℹ️ No data/raw/${dataset} folder yet — skipping ${dataset} build.`);
    return;
  }

  const combinedPath = path.join(rawDir, "pitchmovementdata.csv");
  if (!fs.existsSync(combinedPath)) {
    console.warn(`⚠️ [${dataset}] Missing combined CSV at: ${combinedPath}. Skipping dataset.`);
    return;
  }

  const combinedRows = readCsvFile<CombinedRow>(combinedPath);

  const { enrich: enrichMap, nameToId } = buildEnrichmentMap(rawDir);
  const activeSpinMap = buildActiveSpinMap(rawDir);

  const armAngle2025 =
    dataset === "2026st"
      ? buildArmAngle2025FallbackMap(path.join(repoRoot, "data", "raw", "2025"))
      : new Map<string, number>();

  const pitchers = new Map<string, PitcherOut>();

  for (const r of combinedRows) {
    const pitcherId = String(r.pitcher_id ?? "").trim();
    const pitcherName = String(r.pitcher_name ?? "").trim();
    const code = safePitchCode(String(r.pitch_type ?? ""));

    if (!pitcherId || !pitcherName || !code) continue;

    // Determine mlbam_id:
    // - For 2025: pitcherId is already MLBAM id in your existing pipeline
    // - For 2026st: try name-based mapping from Savant exports; fallback to pitcherId
    const mlbamId =
      dataset === "2026st"
        ? (nameToId.get(normalizeName(pitcherName)) ?? pitcherId)
        : pitcherId;

    if (!pitchers.has(pitcherId)) {
      pitchers.set(pitcherId, {
        pitcher_id: pitcherId,
        pitcher_name: pitcherName,
        mlbam_id: mlbamId,
        arm_angle_source: "dataset",
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

    // Merge enrichment:
    // Try dataset pitcherId first, then mlbamId (helps if combined id differs)
    const tryIds = [pitcherId, mlbamId].filter(Boolean) as string[];
    for (const pid of tryIds) {
      const enrichForPitcher = enrichMap.get(pid);
      const enrich = enrichForPitcher?.get(code);
      if (enrich) {
        Object.assign(base, enrich);
        break;
      }
    }

    // Active Spin%
    let aSpin: number | null = null;
    for (const pid of tryIds) {
      const spinForPitcher = activeSpinMap.get(pid);
      const v = spinForPitcher?.get(code);
      if (v != null) {
        aSpin = v;
        break;
      }
    }
    base.active_spin_percent = aSpin;

    pitchers.get(pitcherId)!.pitches.push(base);
  }

  // 2026st arm angle fallback:
  // If a pitcher has no arm_angle values at all, borrow their 2025 avg and stamp it
  if (dataset === "2026st") {
    for (const p of pitchers.values()) {
      const hasAnyArm = p.pitches.some((x) => x.arm_angle != null);
      if (hasAnyArm) continue;

      const mlbam = p.mlbam_id ? String(p.mlbam_id) : null;
      const fallback = mlbam ? armAngle2025.get(mlbam) : undefined;
      if (fallback == null) continue;

      for (const pitch of p.pitches) {
        pitch.arm_angle = fallback;
      }
      p.arm_angle_source = "2025";
    }
  }

  // Sort each pitch list by usage desc
  for (const p of pitchers.values()) {
    p.pitches.sort((a, b) => (b.pitch_percent ?? 0) - (a.pitch_percent ?? 0));
  }

  // Output locations:
  const outDir = path.join(repoRoot, "public", "data", dataset);
  const outPitchersDir = path.join(outDir, "pitchers");
  ensureDir(outPitchersDir);

  // Dropdown index (keep only what UI needs)
  const index = Array.from(pitchers.values())
    .map((p) => ({
      pitcher_id: p.pitcher_id,
      pitcher_name: p.pitcher_name,
    }))
    .sort((a, b) => a.pitcher_name.localeCompare(b.pitcher_name));

  fs.writeFileSync(
    path.join(outDir, "pitchers_index.json"),
    JSON.stringify(index, null, 2),
    "utf8"
  );

  // One JSON per pitcher
  for (const p of pitchers.values()) {
    fs.writeFileSync(
      path.join(outPitchersDir, `${p.pitcher_id}.json`),
      JSON.stringify(p, null, 2),
      "utf8"
    );
  }

  // Reporting
  const totalPitchers = index.length;
  const totalPitchRows = combinedRows.length;

  const pitchersWithAnyEnrich = Array.from(pitchers.values()).filter((p) =>
    p.pitches.some((x) => x.spin_rate !== undefined || x.whiffs_per_pitch !== undefined)
  ).length;

  const pitchersWithAnyActiveSpin = Array.from(pitchers.values()).filter((p) =>
    p.pitches.some((x) => x.active_spin_percent != null)
  ).length;

  console.log(`✅ [${dataset}] Built JSON for ${totalPitchers} pitchers from ${totalPitchRows} combined rows.`);
  console.log(`ℹ️ [${dataset}] Pitchers with some enrichment: ${pitchersWithAnyEnrich}/${totalPitchers}`);
  console.log(`🌀 [${dataset}] Pitchers with some Active Spin%: ${pitchersWithAnyActiveSpin}/${totalPitchers}`);
  console.log(`📄 [${dataset}] Wrote: public/data/${dataset}/pitchers_index.json`);
  console.log(`📁 [${dataset}] Wrote: public/data/${dataset}/pitchers/{pitcher_id}.json`);
}

main();