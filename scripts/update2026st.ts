// scripts/update2026st.ts
import { execSync } from "child_process";

function run(cmd: string) {
  execSync(cmd, { stdio: "inherit" });
}

run("tsx scripts/fetchSavantSpring2026.ts");  // your existing fetch script
run("tsx scripts/buildPitcherData.ts 2026st");