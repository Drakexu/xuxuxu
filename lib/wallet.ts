export type WalletSummary = {
  walletReady: boolean
  balance: number
  totalSpent: number
  totalUnlocked: number
}

export type WalletTransaction = {
  id: string
  kind: string
  amount: number
  reason: string
  createdAt: string
  sourceCharacterId: string
  sourceCharacterName: string
  localCharacterId: string
  localCharacterName: string
}

export type WalletUnlockReceipt = {
  id: string
  createdAt: string
  priceCoins: number
  sourceCharacterId: string
  sourceCharacterName: string
  localCharacterId: string
  localCharacterName: string
}

export type WalletHistory = {
  walletReady: boolean
  transactions: WalletTransaction[]
  unlocks: WalletUnlockReceipt[]
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

export async function fetchWalletHistory(token: string): Promise<WalletHistory> {
  const resp = await fetch('/api/wallet/history', {
    method: 'GET',
    headers: { Authorization: `Bearer ${token}` },
  })
  const data = (await resp.json().catch(() => ({}))) as Record<string, unknown>
  if (!resp.ok) throw new Error(String(data.error || `wallet history failed (${resp.status})`))
  return {
    walletReady: data.walletReady !== false,
    transactions: Array.isArray(data.transactions) ? (data.transactions as WalletTransaction[]) : [],
    unlocks: Array.isArray(data.unlocks) ? (data.unlocks as WalletUnlockReceipt[]) : [],
  }
}
