// lib/pitchMeta.ts
export type PitchCode =
  | "FF" | "SI" | "FC" | "CH" | "FS" | "FO" | "SC"
  | "CU" | "KC" | "CS" | "SL" | "ST" | "SV";

export const PITCH_META: Record<PitchCode, { title: string; color: string }> = {
  FF: { title: "four-seam fastball", color: "#D22D49" },
  SI: { title: "sinker",            color: "#FE9E00" },
  FC: { title: "cutter",            color: "#933F2C" },
  CH: { title: "changeup",          color: "#1DBF3A" },
  FS: { title: "splitter",          color: "#3BACAC" },
  FO: { title: "forkball",          color: "#55CCAB" },
  SC: { title: "screwball",         color: "#60dc33" },
  CU: { title: "curveball",         color: "#00D2ED" },
  KC: { title: "knuckle curve",     color: "#6236CD" },
  CS: { title: "slow curve",        color: "#0068FF" },
  SL: { title: "slider",            color: "#EEE716" },
  ST: { title: "sweeper",           color: "#DDB43A" },
  SV: { title: "slurve",            color: "#93AFD4" },
};

export const ALL_PITCH_CODES = Object.keys(PITCH_META) as PitchCode[];