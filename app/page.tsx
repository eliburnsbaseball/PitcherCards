// app/page.tsx
"use client";

import React, { useEffect, useMemo, useState } from "react";
import {
  ResponsiveContainer,
  ScatterChart,
  Scatter,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
  BarChart,
  Bar,
  Cell,
  PieChart,
  Pie,
  Legend,
  LabelList,
} from "recharts";

/**
 * Requires:
 * - public/data/pitchers_index.json
 * - public/data/pitchers/{pitcher_id}.json
 *
 * Also expects an API route:
 *   GET /api/mlb/player/[id]
 * returning (at least):
 *   {
 *     id: string,
 *     fullName: string|null,
 *     teamId: number|null,
 *     teamName: string|null,
 *     throws: "R"|"L"|"S"|null,
 *     age: number|null,
 *     height: string|null,  // e.g. 6' 2"
 *     weight: number|null   // lbs
 *   }
 */

type PitchRow = {
  code: string;
  title: string;
  color: string;

  count: number;
  pitch_percent: number; // fraction 0..1
  rhh_percent: number; // fraction 0..1
  lhh_percent: number; // fraction 0..1

  start_speed: number;
  max_start_speed: number;
  ivb: number;
  hb: number;
  release_pos_z: number;
  release_pos_x: number;
  extension: number;

  spin_rate?: number | null;

  // Enrichment fields
  whiffs_per_pitch?: number | null;
  swing_miss_percent?: number | null;
  arm_angle?: number | null;
  barrels_per_pa_percent?: number | null;
  hardhit_percent?: number | null;

  // NEW: Active spin% (spin efficiency) from active-spin.csv (0..100)
  active_spin_percent?: number | null;

  // Aggregation helpers
  whiffs?: number | null;
  swings?: number | null;
  pitches?: number | null;
};

type PitcherJson = {
  pitcher_id: string;
  pitcher_name: string;
  pitches: PitchRow[];
};

type PitcherIndexRow = { pitcher_id: string; pitcher_name: string };

type PlayerMeta = {
  id: string;
  fullName: string | null;
  teamId: number | null;
  teamName: string | null;
  throws: "R" | "L" | "S" | null;
  age: number | null;
  height: string | null;
  weight: number | null;
};

function n(v: any): number {
  const x = Number(v);
  return Number.isFinite(x) ? x : NaN;
}

function fmt(v: any, digits = 1) {
  const x = n(v);
  return Number.isFinite(x) ? x.toFixed(digits) : "—";
}

function pctFromFraction(frac: any, digits = 1) {
  const x = n(frac);
  return Number.isFinite(x) ? `${(x * 100).toFixed(digits)}%` : "—";
}

function pct(v: any, digits = 1) {
  const x = n(v);
  return Number.isFinite(x) ? `${x.toFixed(digits)}%` : "—";
}

function classNames(...xs: Array<string | false | null | undefined>) {
  return xs.filter(Boolean).join(" ");
}

function Card({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-700">
      <div className="border-b border-slate-200 px-4 py-3 dark:border-slate-700">
        <div className="text-[11px] font-extrabold tracking-widest text-slate-600 dark:text-slate-300">
          {title}
        </div>
        {subtitle ? (
          <div className="mt-1 text-xs font-semibold text-slate-500 dark:text-slate-400">
            {subtitle}
          </div>
        ) : null}
      </div>
      <div className="px-4 py-3">{children}</div>
    </div>
  );
}

function StatPill({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-full bg-white/10 px-2.5 py-1 text-xs font-semibold text-slate-100 ring-1 ring-white/10">
      {children}
    </span>
  );
}

function HaloDot(props: any) {
  const { cx, cy, payload } = props;
  if (!Number.isFinite(cx) || !Number.isFinite(cy)) return null;

  const color = payload?.color ?? "#3b82f6";
  const usage = Number.isFinite(Number(payload?.usagePct))
    ? Number(payload.usagePct)
    : 0;

  // Scale halo size by usage (clustering effect)
  const rOuter = 10 + usage * 0.45; // 10..~55
  const rMid = 6 + usage * 0.25; // 6..~31
  const rCore = 4.5;

  return (
    <g>
      <circle cx={cx} cy={cy} r={rOuter} fill={color} opacity={0.12} />
      <circle cx={cx} cy={cy} r={rMid} fill={color} opacity={0.22} />
      <circle
        cx={cx}
        cy={cy}
        r={rCore}
        fill={color}
        opacity={0.98}
        stroke="#0f172a"
        strokeOpacity={0.25}
      />
    </g>
  );
}

// Tooltip for movement chart (uses Active Spin% instead of proxy)
function MovementTooltip({ active, payload }: any) {
  if (!active || !payload?.length) return null;
  const d: any = payload[0].payload;

  return (
    <div className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs shadow-md dark:border-slate-700 dark:bg-slate-900">
      <div className="font-extrabold text-slate-800 dark:text-slate-100">
        {d.title}
      </div>

      <div className="mt-1 text-slate-600 dark:text-slate-300">
        HB: <span className="font-semibold">{fmt(d.hb, 1)}</span> | IVB:{" "}
        <span className="font-semibold">{fmt(d.ivb, 1)}</span>
      </div>

      <div className="text-slate-600 dark:text-slate-300">
        Velo:{" "}
        <span className="font-semibold">{fmt(d.velo, 1)} mph</span> | Usage:{" "}
        <span className="font-semibold">{pct(d.usagePct, 1)}</span>
      </div>

      <div className="mt-1 grid grid-cols-2 gap-x-3 gap-y-1 text-slate-600 dark:text-slate-300">
        <div>
          Spin:{" "}
          <span className="font-semibold">
            {d.spin ? `${fmt(d.spin, 0)} rpm` : "—"}
          </span>
        </div>
        <div>
          Active Spin%:{" "}
          <span className="font-semibold">
            {d.activeSpin != null && Number.isFinite(n(d.activeSpin))
              ? pct(d.activeSpin, 1)
              : "—"}
          </span>
        </div>
        <div>
          Ext:{" "}
          <span className="font-semibold">
            {Number.isFinite(n(d.ext)) ? `${fmt(d.ext, 2)} ft` : "—"}
          </span>
        </div>
        <div>
          Arm:{" "}
          <span className="font-semibold">
            d.arm != null && Number.isFinite(n(d.arm)) ? `${fmt(d.arm, 0)}°` : "—"
          </span>
        </div>
        <div>
          Whiff/P:{" "}
          <span className="font-semibold">
            d.whiffp != null && Number.isFinite(n(d.whiffp))
              ? fmt(d.whiffp, 3)
              : "—"
          </span>
        </div>
        <div>
          SwM%:{" "}
          <span className="font-semibold">
            d.swm != null && Number.isFinite(n(d.swm)) ? pct(d.swm, 1) : "—"
          </span>
        </div>
        <div>
          Bar/PA%:{" "}
          <span className="font-semibold">
            d.barpa != null && Number.isFinite(n(d.barpa))
              ? pct(d.barpa, 2)
              : "—"
          </span>
        </div>
        <div>
          HardHit%:{" "}
          <span className="font-semibold">
            d.hardhit != null && Number.isFinite(n(d.hardhit))
              ? pct(d.hardhit, 1)
              : "—"
          </span>
        </div>
      </div>
    </div>
  );
}

export default function Page() {
  const [index, setIndex] = useState<PitcherIndexRow[]>([]);
  const [selectedId, setSelectedId] = useState<string>("");
  const [pitcher, setPitcher] = useState<PitcherJson | null>(null);
  const [playerMeta, setPlayerMeta] = useState<PlayerMeta | null>(null);
  const [loading, setLoading] = useState(true);

  // Dark mode toggle
  const [dark, setDark] = useState(false);

  useEffect(() => {
    const saved =
      typeof window !== "undefined" ? localStorage.getItem("pc_dark") : null;
    if (saved === "1") setDark(true);
  }, []);

  useEffect(() => {
    if (typeof window !== "undefined")
      localStorage.setItem("pc_dark", dark ? "1" : "0");
  }, [dark]);

  // Load index for dropdown
  useEffect(() => {
    (async () => {
      const res = await fetch("/data/pitchers_index.json", {
        cache: "no-store",
      });
      const data = (await res.json()) as PitcherIndexRow[];
      setIndex(data);
      setSelectedId(data?.[0]?.pitcher_id ?? "");
    })().catch(console.error);
  }, []);

  // Load pitcher JSON
  useEffect(() => {
    if (!selectedId) return;
    setLoading(true);
    (async () => {
      const res = await fetch(`/data/pitchers/${selectedId}.json`, {
        cache: "no-store",
      });
      const data = (await res.json()) as PitcherJson;
      setPitcher(data);
      setLoading(false);
    })().catch((e) => {
      console.error(e);
      setLoading(false);
    });
  }, [selectedId]);

  // Load MLB meta
  useEffect(() => {
    if (!selectedId) return;

    (async () => {
      const res = await fetch(`/api/mlb/player/${selectedId}`, {
        cache: "no-store",
      });
      const meta = await res.json();

      if (meta?.error) setPlayerMeta(null);
      else setPlayerMeta(meta);
    })().catch(() => setPlayerMeta(null));
  }, [selectedId]);

  const pitches = pitcher?.pitches ?? [];

  const totalPitches = useMemo(
    () =>
      pitches.reduce(
        (s, p) => s + (Number.isFinite(n(p.count)) ? n(p.count) : 0),
        0
      ),
    [pitches]
  );

  const overallWhiffPct = useMemo(() => {
    const wh = pitches.reduce((s, p) => s + (p.whiffs ?? 0), 0);
    const pit = pitches.reduce((s, p) => s + (p.pitches ?? 0), 0);
    if (!pit) return NaN;
    return (wh / pit) * 100;
  }, [pitches]);

  const avgArmAngle = useMemo(() => {
    const vals = pitches
      .map((p) => p.arm_angle)
      .filter((x) => x != null) as number[];
    if (!vals.length) return NaN;
    return vals.reduce((a, b) => a + b, 0) / vals.length;
  }, [pitches]);

  const headshotUrl = selectedId
    ? `https://img.mlbstatic.com/mlb-photos/image/upload/w_213,q_100/v1/people/${selectedId}/headshot/67/current`
    : null;

  const teamLogoUrl =
    playerMeta?.teamId != null
      ? `https://www.mlbstatic.com/team-logos/team-cap-on-dark/${playerMeta.teamId}.svg`
      : null;

  const movementData = useMemo(
    () =>
      pitches.map((p) => ({
        code: p.code,
        title: p.title,
        color: p.color,
        hb: n(p.hb),
        ivb: n(p.ivb),
        velo: n(p.start_speed),
        usagePct: n(p.pitch_percent) * 100,
        spin: p.spin_rate ?? null,
        activeSpin: p.active_spin_percent ?? null,
        ext: n(p.extension),
        arm: p.arm_angle ?? null,
        whiffp: p.whiffs_per_pitch ?? null,
        swm: p.swing_miss_percent ?? null,
        barpa: p.barrels_per_pa_percent ?? null,
        hardhit: p.hardhit_percent ?? null,
      })),
    [pitches]
  );

  const armLine = useMemo(() => {
    const a = avgArmAngle;
    if (!Number.isFinite(a)) return null;

    const rad = (a * Math.PI) / 180;
    const x2 = 30 * Math.cos(rad);
    const y2 = 30 * Math.sin(rad);

    return {
      segment: [
        { x: 0, y: 0 },
        { x: x2, y: y2 },
      ],
    };
  }, [avgArmAngle]);

  const releaseData = useMemo(
    () =>
      pitches.map((p) => ({
        code: p.code,
        title: p.title,
        color: p.color,
        x: n(p.release_pos_x),
        z: n(p.release_pos_z),
        velo: n(p.start_speed),
        usagePct: n(p.pitch_percent) * 100,
      })),
    [pitches]
  );

const freqData = useMemo(() => {
  return pitches
    .slice()
    .sort((a, b) => n(b.pitch_percent) - n(a.pitch_percent))
    .map((p) => {
      const leftPct = n(p.lhh_percent) * 100;
      const rightPct = n(p.rhh_percent) * 100;

      return {
        code: p.code,
        title: p.title,
        color: p.color,
        count: n(p.count),

        // mirrored: negative for left side
        left: -leftPct,
        right: rightPct,

        leftAbs: leftPct,
        rightAbs: rightPct,
      };
    });
}, [pitches]);

  const handednessLabel = useMemo(() => {
    const t = playerMeta?.throws;
    if (t === "R") return "RHP";
    if (t === "L") return "LHP";
    if (t === "S") return "Switch";
    return null;
  }, [playerMeta]);

  return (
    <div className={classNames(dark && "dark")}>
      <div className="min-h-screen bg-slate-100 dark:bg-slate-950">
        <div className="mx-auto max-w-6xl px-4 py-6">
          {/* Dropdown */}
          <div className="mb-4 flex flex-wrap items-center gap-3">
            <div className="text-sm font-extrabold text-slate-700 dark:text-slate-200">
              Pitcher
            </div>
            <select
              className="w-full max-w-md rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm outline-none focus:border-slate-400 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
              value={selectedId}
              onChange={(e) => setSelectedId(e.target.value)}
            >
              {index.map((p) => (
                <option key={p.pitcher_id} value={p.pitcher_id}>
                  {p.pitcher_name}
                </option>
              ))}
            </select>

            <button
              onClick={() => setDark((v) => !v)}
              className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 shadow-sm hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
            >
              {dark ? "Light" : "Dark"}
            </button>

            <div className="ml-auto text-sm text-slate-500 dark:text-slate-400">
              {loading ? "Loading…" : ""}
            </div>
          </div>

          {/* HEADER CARD */}
          <div className="relative overflow-hidden rounded-2xl bg-gradient-to-r from-slate-900 via-slate-800 to-slate-900 shadow-lg">
            <div className="absolute inset-0 opacity-20">
              <div className="h-full w-full bg-[radial-gradient(circle_at_20%_20%,rgba(255,255,255,0.25),transparent_35%),radial-gradient(circle_at_80%_20%,rgba(255,255,255,0.18),transparent_35%),radial-gradient(circle_at_80%_80%,rgba(255,255,255,0.12),transparent_45%)]" />
            </div>

            <div className="relative flex flex-col gap-4 p-5 sm:flex-row sm:items-center">
              {/* Left */}
              <div className="flex items-center gap-4">
                <div className="h-16 w-16 overflow-hidden rounded-2xl bg-white/10 ring-1 ring-white/10">
                  {headshotUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={headshotUrl}
                      alt={pitcher?.pitcher_name ?? "Pitcher"}
                      className="h-full w-full object-cover"
                      onError={(e) =>
                        ((e.currentTarget as HTMLImageElement).style.display =
                          "none")
                      }
                    />
                  ) : null}
                </div>

                <div>
                  <div className="text-2xl font-extrabold tracking-wide text-white">
                    {pitcher?.pitcher_name?.toUpperCase() ?? "—"}
                  </div>

                  <div className="mt-1 text-sm text-slate-200/90">
                    {playerMeta?.teamName ? `${playerMeta.teamName} • ` : ""}
                    Pitch Movement / Arsenal Dashboard
                  </div>

                  <div className="mt-2 flex flex-wrap gap-2">
                    {handednessLabel && <StatPill>{handednessLabel}</StatPill>}
                    <StatPill>
                      {playerMeta?.age != null ? playerMeta.age : "—"}
                    </StatPill>
                    <StatPill>{playerMeta?.height ?? "—"}</StatPill>
                    <StatPill>
                      {playerMeta?.weight != null
                        ? `${playerMeta.weight} lbs`
                        : "—"}
                    </StatPill>

                    <span className="ml-1 hidden sm:inline-block text-xs text-slate-200/70">
                      • Total pitches:{" "}
                      <span className="font-semibold text-slate-100">
                        {totalPitches || "—"}
                      </span>
                    </span>
                  </div>
                </div>
              </div>

              {/* Right */}
              <div className="sm:ml-auto flex items-center gap-3">
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {[
                    { label: "PITCHES", value: totalPitches || "—" },
                    {
                      label: "WHIFF%",
                      value: Number.isFinite(overallWhiffPct)
                        ? `${overallWhiffPct.toFixed(1)}%`
                        : "—",
                    },
                    {
                      label: "ARM°",
                      value: Number.isFinite(avgArmAngle)
                        ? `${avgArmAngle.toFixed(0)}°`
                        : "—",
                    },
                    { label: "TYPES", value: pitches.length || "—" },
                  ].map((box) => (
                    <div
                      key={box.label}
                      className="flex h-14 w-24 flex-col items-center justify-center rounded-xl bg-white/10 text-white ring-1 ring-white/10"
                    >
                      <div className="text-lg font-extrabold leading-none">
                        {box.value as any}
                      </div>
                      <div className="mt-1 text-[10px] font-semibold uppercase tracking-wide text-slate-200/80">
                        {box.label}
                      </div>
                    </div>
                  ))}
                </div>

                {teamLogoUrl ? (
                  <div className="hidden sm:flex h-16 w-16 items-center justify-center rounded-2xl bg-white/10 ring-1 ring-white/10">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={teamLogoUrl}
                      alt={playerMeta?.teamName ?? "Team"}
                      className="h-12 w-12 object-contain"
                      onError={(e) =>
                        ((e.currentTarget as HTMLImageElement).style.display =
                          "none")
                      }
                    />
                  </div>
                ) : null}
              </div>
            </div>
          </div>

          {/* 3 PANELS */}
          <div className="mt-5 grid grid-cols-1 gap-4 lg:grid-cols-3">
            {/* RELEASE POINT */}
            <Card title="RELEASE POINT">
              <div className="h-72">
                <div className="relative h-full w-full overflow-hidden rounded-xl bg-slate-50 ring-1 ring-slate-200 dark:bg-slate-950 dark:ring-slate-800">
                  <div className="pointer-events-none absolute inset-0 opacity-10">
                    <svg viewBox="0 0 600 300" className="h-full w-full">
                      <path
                        d="M160 250c45-60 60-105 45-140 35 28 80 28 105-6 30 30 90 40 145 12 12 48-24 95-60 134H160z"
                        fill="#0f172a"
                      />
                      <circle cx="260" cy="95" r="28" fill="#0f172a" />
                      <rect
                        x="0"
                        y="265"
                        width="600"
                        height="18"
                        fill="#8b5a2b"
                        opacity="0.65"
                      />
                    </svg>
                  </div>

                  <div className="absolute inset-0 p-2">
                    <ResponsiveContainer width="100%" height="100%">
                      <ScatterChart
                        margin={{ top: 10, right: 10, bottom: 20, left: 20 }}
                      >
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis
                          type="number"
                          dataKey="x"
                          domain={[-4, 4]}
                          tick={{ fontSize: 11 }}
                          label={{
                            value: "release_pos_x",
                            position: "insideBottom",
                            offset: -8,
                            fontSize: 11,
                          }}
                        />
                        <YAxis
                          type="number"
                          dataKey="z"
                          domain={[4, 8]}
                          tick={{ fontSize: 11 }}
                          label={{
                            value: "release_pos_z",
                            angle: -90,
                            position: "insideLeft",
                            fontSize: 11,
                          }}
                        />
                        <Tooltip
                          content={({ active, payload }) => {
                            if (!active || !payload?.length) return null;
                            const d: any = payload[0].payload;
                            return (
                              <div className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs shadow-md dark:border-slate-700 dark:bg-slate-900">
                                <div className="font-extrabold text-slate-800 dark:text-slate-100">
                                  {d.title}
                                </div>
                                <div className="mt-1 text-slate-600 dark:text-slate-300">
                                  x:{" "}
                                  <span className="font-semibold">
                                    {fmt(d.x, 2)}
                                  </span>{" "}
                                  | z:{" "}
                                  <span className="font-semibold">
                                    {fmt(d.z, 2)}
                                  </span>
                                </div>
                                <div className="text-slate-600 dark:text-slate-300">
                                  Velo:{" "}
                                  <span className="font-semibold">
                                    {fmt(d.velo, 1)} mph
                                  </span>{" "}
                                  | Usage:{" "}
                                  <span className="font-semibold">
                                    {pct(d.usagePct, 1)}
                                  </span>
                                </div>
                              </div>
                            );
                          }}
                        />
                        <Scatter data={releaseData} shape={<HaloDot />}>
                          {releaseData.map((pt, i) => (
                            <Cell key={i} fill={pt.color} />
                          ))}
                        </Scatter>
                      </ScatterChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              </div>
            </Card>

            {/* MOVEMENT PROFILE */}
            <Card
              title="MOVEMENT PROFILE"
              subtitle={
                Number.isFinite(avgArmAngle)
                  ? `Arm Angle: ${avgArmAngle.toFixed(0)}°`
                  : undefined
              }
            >
              <div className="h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <ScatterChart
                    margin={{ top: 10, right: 10, bottom: 20, left: 20 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" />

                    <XAxis
                      type="number"
                      dataKey="hb"
                      domain={[-30, 30]}
                      tick={{ fontSize: 11 }}
                      label={{
                        value: "HB",
                        position: "insideBottom",
                        offset: -8,
                        fontSize: 11,
                      }}
                    />
                    <YAxis
                      type="number"
                      dataKey="ivb"
                      domain={[-30, 30]}
                      tick={{ fontSize: 11 }}
                      label={{
                        value: "IVB",
                        angle: -90,
                        position: "insideLeft",
                        fontSize: 11,
                      }}
                    />

                    <ReferenceLine x={0} stroke="#94a3b8" />
                    <ReferenceLine y={0} stroke="#94a3b8" />

                    {armLine ? (
                       <>
                      {/* glow/underlay */}
                      <ReferenceLine
                     segment={armLine.segment as any}
                     stroke="#ffffff"
                     strokeOpacity={0.18}
                      strokeWidth={6}
                     ifOverflow="extendDomain"
                   />
                   {/* main visible line */}
                   <ReferenceLine
                     segment={armLine.segment as any}
                     stroke="#38bdf8"          // brighter
                     strokeOpacity={0.95}
                     strokeWidth={3}
                     strokeDasharray="6 4"
                      ifOverflow="extendDomain"
                    />
                   </>
                  ) : null}

                    {/* Uses Active Spin% */}
                    <Tooltip content={<MovementTooltip />} />

                    <Scatter data={movementData} shape={<HaloDot />}>
                      {movementData.map((pt, i) => (
                        <Cell key={i} fill={pt.color} />
                      ))}
                    </Scatter>
                  </ScatterChart>
                </ResponsiveContainer>
              </div>
            </Card>

            {/* PITCH FREQUENCY */}
            <Card
              title="PITCH FREQUENCY"
              subtitle="Back-to-back: vs LHH (left) / vs RHH (right)"
            >
              <div className="h-72">
<ResponsiveContainer width="100%" height="100%">
  <BarChart
    data={freqData}
    layout="vertical"
    margin={{ top: 10, right: 24, bottom: 10, left: 10 }}
    barCategoryGap={14}
  >
    <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.25} />

    <XAxis
      type="number"
      domain={[-100, 100]}
      tick={{ fontSize: 11, fill: "rgba(226,232,240,0.85)" }}
      tickFormatter={(v) => `${Math.abs(Number(v)).toFixed(0)}%`}
      axisLine={{ stroke: "rgba(226,232,240,0.25)" }}
      tickLine={{ stroke: "rgba(226,232,240,0.25)" }}
    />
    <YAxis
      type="category"
      dataKey="code"
      width={44}
      tick={{ fontSize: 11, fontWeight: 900, fill: "rgba(226,232,240,0.92)" }}
      axisLine={{ stroke: "rgba(226,232,240,0.25)" }}
      tickLine={{ stroke: "rgba(226,232,240,0.25)" }}
    />

    {/* center split */}
    <ReferenceLine
      x={0}
      stroke="#e2e8f0"
      strokeOpacity={0.55}
      strokeDasharray="2 6"
      strokeWidth={2}
    />

    <Tooltip
      content={({ active, payload }) => {
        if (!active || !payload?.length) return null;
        const d: any = payload[0].payload;
        return (
          <div className="rounded-xl border border-slate-200/20 bg-slate-900/95 px-3 py-2 text-xs shadow-md text-slate-100">
            <div className="font-extrabold">{d.title}</div>
            <div className="mt-1 text-slate-200/90">
              Count: <span className="font-semibold">{d.count}</span>
            </div>
            <div className="text-slate-200/90">
              vs LHH: <span className="font-semibold">{pct(d.leftAbs, 1)}</span> • vs RHH:{" "}
              <span className="font-semibold">{pct(d.rightAbs, 1)}</span>
            </div>
          </div>
        );
      }}
    />

    {/* LEFT (LHH) */}
    <Bar dataKey="left" radius={[0, 0, 0, 0]} barSize={18} isAnimationActive={false}>
      {freqData.map((d, i) => (
        <Cell key={i} fill={d.color} opacity={0.85} />
      ))}

      {/* label on left side (negative) */}
    </Bar>

    {/* RIGHT (RHH) */}
    <Bar dataKey="right" radius={[0, 0, 0, 0]} barSize={18} isAnimationActive={false}>
      {freqData.map((d, i) => (
        <Cell key={i} fill={d.color} opacity={1} />
      ))}

      {/* label on right side */}
    </Bar>
  </BarChart>
</ResponsiveContainer>

                <div className="mt-2 flex items-center justify-between text-[11px] font-extrabold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                  <span>vs LHH</span>
                  <span>vs RHH</span>
                </div>
              </div>
            </Card>
          </div>

          {/* TABLE */}
          <div className="mt-5 overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-700">
            <div className="border-b border-slate-200 bg-white px-4 py-3 dark:border-slate-700 dark:bg-slate-900">
              <div className="text-xs font-extrabold tracking-widest text-slate-600 dark:text-slate-300">
                PITCH ARSENAL
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="min-w-[1120px] w-full">
                <thead className="bg-slate-50 dark:bg-slate-950">
                  <tr className="text-left text-[11px] font-extrabold uppercase tracking-wider text-slate-600 dark:text-slate-300">
                    <th className="px-4 py-3">Pitch</th>
                    <th className="px-3 py-3">#</th>
                    <th className="px-3 py-3">%</th>
                    <th className="px-3 py-3">Velo</th>
                    <th className="px-3 py-3">Spin</th>
                    <th className="px-3 py-3">ASpin%</th>
                    <th className="px-3 py-3">IVB</th>
                    <th className="px-3 py-3">HB</th>
                    <th className="px-3 py-3">RelZ</th>
                    <th className="px-3 py-3">RelX</th>
                    <th className="px-3 py-3">Ext</th>
                    <th className="px-3 py-3">Whiff/P</th>
                    <th className="px-3 py-3">SwM%</th>
                    <th className="px-3 py-3">Arm°</th>
                    <th className="px-3 py-3">Bar/PA%</th>
                    <th className="px-3 py-3">HardHit%</th>
                  </tr>
                </thead>

                <tbody>
                  {pitches.map((p) => (
                    <tr
                      key={p.code}
                      className="border-t border-slate-100 text-sm dark:border-slate-800"
                    >
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <span
                            className="inline-block h-3 w-3 rounded-sm"
                            style={{ backgroundColor: p.color }}
                          />
                          <div>
                            <div className="font-extrabold text-slate-800 dark:text-slate-100">
                              {p.title}
                            </div>
                            <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                              {p.code}
                            </div>
                          </div>
                        </div>
                      </td>

                      <td className="px-3 py-3 font-semibold text-slate-800 dark:text-slate-100">
                        {Number.isFinite(n(p.count)) ? p.count : "—"}
                      </td>
                      <td className="px-3 py-3 font-semibold text-slate-800 dark:text-slate-100">
                        {pctFromFraction(p.pitch_percent, 1)}
                      </td>
                      <td className="px-3 py-3 text-slate-700 dark:text-slate-200">
                        {fmt(p.start_speed, 1)} mph
                      </td>
                      <td className="px-3 py-3 text-slate-700 dark:text-slate-200">
                        {p.spin_rate == null ? "—" : `${fmt(p.spin_rate, 0)} rpm`}
                      </td>
                      <td className="px-3 py-3 text-slate-700 dark:text-slate-200">
                        {p.active_spin_percent == null
                          ? "—"
                          : pct(p.active_spin_percent, 1)}
                      </td>
                      <td className="px-3 py-3 text-slate-700 dark:text-slate-200">
                        {fmt(p.ivb, 1)}
                      </td>
                      <td className="px-3 py-3 text-slate-700 dark:text-slate-200">
                        {fmt(p.hb, 1)}
                      </td>
                      <td className="px-3 py-3 text-slate-700 dark:text-slate-200">
                        {fmt(p.release_pos_z, 2)}
                      </td>
                      <td className="px-3 py-3 text-slate-700 dark:text-slate-200">
                        {fmt(p.release_pos_x, 2)}
                      </td>
                      <td className="px-3 py-3 text-slate-700 dark:text-slate-200">
                        {fmt(p.extension, 2)}
                      </td>
                      <td className="px-3 py-3 text-slate-700 dark:text-slate-200">
                        {p.whiffs_per_pitch == null
                          ? "—"
                          : fmt(p.whiffs_per_pitch, 3)}
                      </td>
                      <td className="px-3 py-3 text-slate-700 dark:text-slate-200">
                        {p.swing_miss_percent == null
                          ? "—"
                          : pct(p.swing_miss_percent, 1)}
                      </td>
                      <td className="px-3 py-3 text-slate-700 dark:text-slate-200">
                        {p.arm_angle == null ? "—" : `${fmt(p.arm_angle, 0)}°`}
                      </td>
                      <td className="px-3 py-3 text-slate-700 dark:text-slate-200">
                        {p.barrels_per_pa_percent == null
                          ? "—"
                          : pct(p.barrels_per_pa_percent, 2)}
                      </td>
                      <td className="px-3 py-3 text-slate-700 dark:text-slate-200">
                        {p.hardhit_percent == null
                          ? "—"
                          : pct(p.hardhit_percent, 1)}
                      </td>
                    </tr>
                  ))}

                  {!pitches.length && (
                    <tr>
                      <td
                        colSpan={16}
                        className="px-4 py-8 text-center text-slate-500 dark:text-slate-400"
                      >
                        No pitch data found.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
              <div className="border-t border-slate-200 bg-slate-50 px-4 py-3 text-[11px] font-semibold text-slate-500">
              Axes fixed at ±30. ASpin% = Active Spin%.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}