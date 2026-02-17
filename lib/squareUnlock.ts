export type SquareUnlockResult = {
  ok: boolean
  walletReady: boolean
  alreadyUnlocked: boolean
  localCharacterId: string
  chargedCoins: number
  priceCoins: number
  balanceAfter: number | null
  error?: string
  balance?: number
}

function parseUnlockResult(data: Record<string, unknown>): SquareUnlockResult {
  return {
    ok: data.ok !== false,
    walletReady: data.walletReady !== false,
    alreadyUnlocked: data.alreadyUnlocked === true,
    localCharacterId: String(data.localCharacterId || ''),
    chargedCoins: Number(data.chargedCoins || 0),
    priceCoins: Number(data.priceCoins || 0),
    balanceAfter: data.balanceAfter == null ? null : Number(data.balanceAfter),
    error: typeof data.error === 'string' ? data.error : undefined,
    balance: data.balance == null ? undefined : Number(data.balance),
  }
}

export async function unlockSquareCharacter(token: string, sourceCharacterId: string): Promise<SquareUnlockResult> {
  const resp = await fetch('/api/square/unlock', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ sourceCharacterId }),
  })
  const data = (await resp.json().catch(() => ({}))) as Record<string, unknown>
  const parsed = parseUnlockResult(data)
  if (!resp.ok && !parsed.ok) return parsed
  if (!resp.ok) throw new Error(String(data.error || `unlock failed (${resp.status})`))
  return parsed
}

