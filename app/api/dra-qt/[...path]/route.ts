import { NextRequest, NextResponse } from "next/server";

const XANA_API = "http://116.62.9.211";
const ALLOWED_STATIC = [
  "account.json",
  "portfolio.json",
  "orders.json",
  "nav_history.json",
  "signals.json",
  "indices.json",
  "metadata.json",
  "intraday_signals.json",
  "earnings_calendar.json",
  "news.json",
];

// Alpaca proxy paths on Xana
const ALPACA_PATHS = [
  "alpaca/account",
  "alpaca/positions",
  "alpaca/orders",
  "alpaca/portfolio/history",
];

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  const { path } = await params;
  const joined = path.join("/");

  // Alpaca proxy — forward to Xana /alpaca/* endpoint
  if (ALPACA_PATHS.some(p => joined === p || joined.startsWith(p + "?"))) {
    try {
      const qs = request.nextUrl.searchParams.toString();
      const url = `${XANA_API}/${joined}${qs ? `?${qs}` : ""}`;
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) {
        const text = await res.text();
        return NextResponse.json({ error: "alpaca error", detail: text }, { status: res.status });
      }
      const data = await res.json();
      return NextResponse.json(data, {
        headers: { "Cache-Control": "no-cache, no-store, must-revalidate" },
      });
    } catch {
      return NextResponse.json({ error: "fetch failed" }, { status: 502 });
    }
  }

  // Static data files
  if (!ALLOWED_STATIC.includes(joined)) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  try {
    const res = await fetch(`${XANA_API}/${joined}`, {
      next: { revalidate: 60 },
    });

    if (!res.ok) {
      return NextResponse.json(
        { error: "upstream error" },
        { status: res.status }
      );
    }

    const data = await res.json();
    return NextResponse.json(data, {
      headers: {
        "Cache-Control": "public, s-maxage=60, stale-while-revalidate=30",
      },
    });
  } catch {
    return NextResponse.json({ error: "fetch failed" }, { status: 502 });
  }
}
