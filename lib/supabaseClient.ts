// lib/supabaseClient.ts

import { createClient } from '@supabase/supabase-js'

// 这里替换为你的 Supabase 项目的 URL 和 anon key
const supabaseUrl = 'https://kipliuxottwfctecwwms.supabase.co'  // 用你的 Project URL 替换
const supabaseAnonKey = 'sb_publishable_Br5e-NaPz1WiWkwUaUSIdQ_4eRQGmsM'  // 用你的 anon key 替换

export const supabase = createClient(supabaseUrl, supabaseAnonKey)
