import { NextRequest, NextResponse } from "next/server";

const XANA_API = "http://116.62.9.211";
const ALLOWED_PATHS = [
  "account.json",
  "portfolio.json",
  "orders.json",
  "nav_history.json",
  "signals.json",
  "indices.json",
  "metadata.json",
];

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  const { path } = await params;
  const file = path.join("/");

  if (!ALLOWED_PATHS.includes(file)) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  try {
    const res = await fetch(`${XANA_API}/${file}`, {
      next: { revalidate: 60 }, // cache 60s on Vercel edge
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
