// scripts/validatePitcherData.ts
import fs from "fs";
import path from "path";

function main() {
  const root = process.cwd();
  const idxPath = path.join(root, "public", "data", "pitchers_index.json");
  const dir = path.join(root, "public", "data", "pitchers");

  if (!fs.existsSync(idxPath)) throw new Error(`Missing: ${idxPath}`);
  if (!fs.existsSync(dir)) throw new Error(`Missing: ${dir}`);

  const index = JSON.parse(fs.readFileSync(idxPath, "utf8")) as Array<{ pitcher_id: string; pitcher_name: string }>;
  let missing = 0;
  let empty = 0;

  for (const p of index) {
    const file = path.join(dir, `${p.pitcher_id}.json`);
    if (!fs.existsSync(file)) {
      missing++;
      continue;
    }
    const data = JSON.parse(fs.readFileSync(file, "utf8")) as any;
    if (!data.pitches || data.pitches.length === 0) empty++;
  }

  console.log(`Index pitchers: ${index.length}`);
  console.log(`Missing pitcher json: ${missing}`);
  console.log(`Empty pitcher json: ${empty}`);
}

main();