export type WalletSummary = {
  walletReady: boolean
  balance: number
  totalSpent: number
  totalUnlocked: number
}

export async function fetchWalletSummary(token: string): Promise<WalletSummary> {
  const resp = await fetch('/api/wallet/summary', {
    method: 'GET',
    headers: { Authorization: `Bearer ${token}` },
  })
  const data = (await resp.json().catch(() => ({}))) as Record<string, unknown>
  if (!resp.ok) throw new Error(String(data.error || `wallet summary failed (${resp.status})`))
  return {
    walletReady: data.walletReady !== false,
    balance: Number(data.balance || 0),
    totalSpent: Number(data.totalSpent || 0),
    totalUnlocked: Number(data.totalUnlocked || 0),
  }
}

