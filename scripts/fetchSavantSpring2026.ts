// scripts/fetchSavantSpring2026.ts
import fs from "fs";
import path from "path";

const PITCHES = ["FF","SI","FC","CH","FS","FO","SC","CU","KC","CS","SL","ST","SV"] as const;

const TEMPLATE_URL =
  "https://baseballsavant.mlb.com/statcast_search?hfPT=FF%7C&hfAB=&hfGT=S%7C&hfPR=&hfZ=&hfStadium=&hfBBL=&hfNewZones=&hfPull=&hfC=&hfSea=2026%7C&hfSit=&player_type=pitcher&hfOuts=&home_road=&pitcher_throws=&batter_stands=&hfSA=&hfEventOuts=&hfEventRuns=&game_date_gt=&game_date_lt=&hfMo=&hfTeam=&hfOpponent=&hfRO=&position=&hfInfield=&hfOutfield=&hfInn=&hfBBT=&hfFlag=is%5C.%5C.bunt%5C.%5C.not%7C&metric_1=&group_by=name&min_pitches=0&min_results=0&min_pas=0&sort_col=pitches&player_event_sort=api_p_release_speed&sort_order=desc&chk_stats_pa=on&chk_stats_abs=on&chk_stats_hits=on&chk_stats_k_percent=on&chk_stats_bb_percent=on&chk_stats_whiffs=on&chk_stats_swings=on&chk_stats_ba=on&chk_stats_xba=on&chk_stats_obp=on&chk_stats_xobp=on&chk_stats_slg=on&chk_stats_xslg=on&chk_stats_woba=on&chk_stats_xwoba=on&chk_stats_barrels_total=on&chk_stats_babip=on&chk_stats_iso=on&chk_stats_swing_miss_percent=on&chk_stats_velocity=on&chk_stats_spin_rate=on&chk_stats_release_pos_z=on&chk_stats_release_pos_x=on&chk_stats_release_extension=on&chk_stats_plate_x=on&chk_stats_plate_z=on&chk_stats_arm_angle=on&chk_stats_launch_speed=on&chk_stats_hardhit_percent=on&chk_stats_barrels_per_bbe_percent=on&chk_stats_barrels_per_pa_percent=on";

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  const outDir = path.join(process.cwd(), "data", "raw", "2026st");
  fs.mkdirSync(outDir, { recursive: true });

  const template = new URL(TEMPLATE_URL);

  for (const code of PITCHES) {
    const u = new URL(template.toString());

    // Swap pitch filter
    u.searchParams.set("hfPT", `${code}|`);

    // Force 2026 + Spring Training (you already have hfSea=2026| and hfGT=S|)
    u.searchParams.set("hfSea", "2026|");
    u.searchParams.set("hfGT", "S|");

    // Convert to CSV endpoint
    const csvUrl = `https://baseballsavant.mlb.com/statcast_search/csv?${u.searchParams.toString()}`;

    console.log(`Downloading ${code}...`);
    const res = await fetch(csvUrl, {
      headers: { "user-agent": "Mozilla/5.0" },
    });
    if (!res.ok) throw new Error(`Fetch failed ${code}: ${res.status}`);

    const text = await res.text();
    fs.writeFileSync(path.join(outDir, `savant_2026st_${code}.csv`), text, "utf8");

    // be nice to Savant
    await sleep(800);
  }

  console.log("✅ Done: data/raw/2026st/*.csv");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});