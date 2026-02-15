// lib/supabaseClient.ts

import { createClient } from '@supabase/supabase-js'

// Use env vars (works locally via `.env.local` and on Vercel project env).
// Never hardcode keys in the repo.
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''

if (!supabaseUrl || !supabaseAnonKey) {
  // Fail fast so misconfig is obvious during dev.
  console.warn('Missing Supabase env: NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY')
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey)
