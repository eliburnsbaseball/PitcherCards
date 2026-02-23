import fs from "fs";
import path from "path";

const OUT_DIR = path.join(process.cwd(), "data", "raw", "2026st");
fs.mkdirSync(OUT_DIR, { recursive: true });

const PITCH_CODES = ["FF","SI","FC","CH","FS","FO","SC","CU","KC","CS","SL","ST","SV"] as const;

// Start from your working Savant link, but swap the host/path to /statcast_search/csv
// and just change hfPT=XX%7C (pitch type) per file.
function buildUrl(pitchCode: string) {
  // Your original link already has hfGT=S%7C and hfSea=2026%7C, plus all your checked stats.
  // We keep that “query shape” but use the CSV endpoint:
  const base =
    "https://baseballsavant.mlb.com/statcast_search/csv?all=true&type=details";

  // This is the query portion taken from your link (everything after ?), minus the #results.
  // IMPORTANT: keep hfGT=S%7C and hfSea=2026%7C for Spring Training 2026.
  const query =
    `hfPT=${encodeURIComponent(pitchCode + "|")}` +
    `&hfAB=&hfGT=${encodeURIComponent("S|")}` +
    `&hfPR=&hfZ=&hfStadium=&hfBBL=&hfNewZones=&hfPull=&hfC=` +
    `&hfSea=${encodeURIComponent("2026|")}` +
    `&hfSit=&player_type=pitcher&hfOuts=&home_road=&pitcher_throws=&batter_stands=` +
    `&hfSA=&hfEventOuts=&hfEventRuns=&game_date_gt=&game_date_lt=&hfMo=&hfTeam=&hfOpponent=` +
    `&hfRO=&position=&hfInfield=&hfOutfield=&hfInn=&hfBBT=` +
    `&hfFlag=${encodeURIComponent("is\\.\\.bunt\\.\\.not|")}` +
    `&metric_1=&group_by=name&min_pitches=0&min_results=0&min_pas=0` +
    `&sort_col=pitches&player_event_sort=api_p_release_speed&sort_order=desc` +
    `&chk_stats_pa=on&chk_stats_abs=on&chk_stats_hits=on&chk_stats_k_percent=on&chk_stats_bb_percent=on` +
    `&chk_stats_whiffs=on&chk_stats_swings=on&chk_stats_ba=on&chk_stats_xba=on&chk_stats_obp=on&chk_stats_xobp=on` +
    `&chk_stats_slg=on&chk_stats_xslg=on&chk_stats_woba=on&chk_stats_xwoba=on&chk_stats_barrels_total=on` +
    `&chk_stats_babip=on&chk_stats_iso=on&chk_stats_swing_miss_percent=on&chk_stats_velocity=on&chk_stats_spin_rate=on` +
    `&chk_stats_release_pos_z=on&chk_stats_release_pos_x=on&chk_stats_release_extension=on` +
    `&chk_stats_plate_x=on&chk_stats_plate_z=on&chk_stats_arm_angle=on&chk_stats_launch_speed=on` +
    `&chk_stats_hardhit_percent=on&chk_stats_barrels_per_bbe_percent=on&chk_stats_barrels_per_pa_percent=on`;

  return `${base}&${query}`;
}

async function downloadToFile(url: string, filePath: string) {
  const res = await fetch(url, {
    headers: {
      // Helps avoid some bot blocks
      "User-Agent": "Mozilla/5.0 (compatible; pitchercards-bot/1.0)",
      "Accept": "text/csv,*/*",
    },
  });

  if (!res.ok) {
    throw new Error(`HTTP ${res.status} for ${url}`);
  }
  const text = await res.text();
  fs.writeFileSync(filePath, text, "utf8");
}

async function main() {
  console.log(`📥 Fetching 2026 ST Savant CSVs → ${OUT_DIR}`);
  for (const code of PITCH_CODES) {
    const url = buildUrl(code);
    const out = path.join(OUT_DIR, `savant_2026st_${code}.csv`);
    console.log(`- ${code} …`);
    await downloadToFile(url, out);
    console.log(`  wrote ${path.basename(out)}`);
  }
  console.log("✅ Done.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});