import { NextRequest, NextResponse } from "next/server";

const ALPACA_BASE = "https://paper-api.alpaca.markets";

const ALLOWED_PATHS: Record<string, string> = {
  "account": "/v2/account",
  "positions": "/v2/positions",
  "orders": "/v2/orders",
  "portfolio/history": "/v2/account/portfolio/history",
};

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  const { path } = await params;
  const key = path.join("/");

  const alpacaPath = ALLOWED_PATHS[key];
  if (!alpacaPath) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const apiKey = process.env.ALPACA_API_KEY_ID;
  const secretKey = process.env.ALPACA_API_SECRET_KEY;

  if (!apiKey || !secretKey) {
    return NextResponse.json({ error: "Alpaca not configured" }, { status: 503 });
  }

  try {
    // Forward query params (e.g., for orders: status, limit, after, direction)
    const url = new URL(`${ALPACA_BASE}${alpacaPath}`);
    const searchParams = request.nextUrl.searchParams;
    searchParams.forEach((value, key) => {
      url.searchParams.set(key, value);
    });

    const res = await fetch(url.toString(), {
      headers: {
        "APCA-API-KEY-ID": apiKey,
        "APCA-API-SECRET-KEY": secretKey,
      },
      cache: "no-store",
    });

    if (!res.ok) {
      const text = await res.text();
      return NextResponse.json(
        { error: "alpaca error", detail: text },
        { status: res.status }
      );
    }

    const data = await res.json();
    return NextResponse.json(data, {
      headers: {
        "Cache-Control": "no-cache, no-store, must-revalidate",
      },
    });
  } catch {
    return NextResponse.json({ error: "fetch failed" }, { status: 502 });
  }
}
