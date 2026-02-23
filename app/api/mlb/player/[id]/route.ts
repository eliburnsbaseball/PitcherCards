import { NextResponse } from "next/server";

export const runtime = "nodejs";

type ThrowsCode = "R" | "L" | "S";

function digitsOnly(s: string) {
  const m = s.match(/\d+/g);
  return m ? m.join("") : "";
}

async function fetchJson(url: string) {
  const r = await fetch(url, {
    headers: { "User-Agent": "pitchercards/1.0" },
    cache: "no-store",
  });
  const text = await r.text();
  let json: any = null;
  try {
    json = JSON.parse(text);
  } catch {
    // ignore
  }
  return { ok: r.ok, status: r.status, text, json };
}

export async function GET(
  _req: Request,
  context: { params: Promise<{ id: string }> }
) {
  const raw = (await context.params)?.id ?? "";
  const id = digitsOnly(raw);

  if (!id) {
    return NextResponse.json({ error: "Invalid player id", rawId: raw }, { status: 400 });
  }

  const hydrate = "currentTeam";

  const urlA = `https://statsapi.mlb.com/api/v1/people/${id}?hydrate=${hydrate}`;
  const a = await fetchJson(urlA);

  const urlB = `https://statsapi.mlb.com/api/v1/people?personIds=${id}&hydrate=${hydrate}`;
  const b = a.ok ? null : await fetchJson(urlB);

  const src = a.ok ? a : b;

  if (!src || !src.ok) {
    return NextResponse.json(
      {
        error: "MLB API error",
        id,
        tried: [urlA, urlB],
        statusA: a.status,
        statusB: b?.status ?? null,
        bodyPreviewA: a.text?.slice(0, 300) ?? null,
        bodyPreviewB: b?.text?.slice(0, 300) ?? null,
      },
      { status: 502 }
    );
  }

  const person = src.json?.people?.[0] ?? null;

  if (!person) {
    return NextResponse.json(
      { error: "No person returned from MLB API", id, tried: [urlA, urlB] },
      { status: 502 }
    );
  }

  const fullName = person?.fullName ?? null;

  const team = person?.currentTeam ?? null;
  const teamId = team?.id ?? null;
  const teamName = team?.name ?? null;

  const teamAbbr =
    team?.abbreviation ??
    team?.abbrev ??
    team?.triCode ??
    person?.currentTeam?.abbreviation ??
    null;

  const throws: ThrowsCode | null = 
    person?.throwsHand?.code ??
    person?.pitchHand?.code ??
    null;
  const age: number | null = typeof person?.currentAge === "number" ? person.currentAge : null;
  const height: string | null = typeof person?.height === "string" ? person.height : null;
  const weight: number | null = typeof person?.weight === "number" ? person.weight : null;

  return NextResponse.json({
    id,
    fullName,
    teamId,
    teamName,
    teamAbbr,
    throws,
    age,
    height,
    weight,
    source: a.ok ? "people/{id}" : "people?personIds=",
  });
}