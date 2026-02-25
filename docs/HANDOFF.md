# 爱巴基项目交接文档

## 给新 session 的一句话

> "继续 xuxuxu 项目的爱巴基模块开发，读 docs/HANDOFF.md 了解全部背景，当前分支 `claude/review-xuxuxu-code-tqLoC`，所有改动已推送，接着做未完成的功能。"

---

## 项目基本信息

| 项目 | xuxuxu（个人网站 + 爱巴基 AI 聊天应用）|
|------|------|
| 框架 | Next.js App Router |
| 样式 | Tailwind CSS |
| 数据库 / 认证 | Supabase |
| 当前开发分支 | `claude/review-xuxuxu-code-tqLoC` |
| 设计参考 | `/home/user/xuxuxu/0225/src/App.tsx`（Gemini 生成的完整设计稿） |

---

## 目录结构（关键路径）

```
app/
├── aibaji/
│   ├── layout.tsx              ← 爱巴基整体布局（侧边栏 + 底部导航）
│   ├── square/
│   │   ├── page.tsx            ← 广场（发现角色）
│   │   └── [characterId]/
│   │       └── page.tsx        ← 角色详情页
│   ├── chat/
│   │   ├── page.tsx            ← 聊天列表页
│   │   └── [characterId]/
│   │       └── page.tsx        ← 聊天窗口
│   └── characters/
│       ├── page.tsx            ← 我的角色列表
│       └── new/
│           └── page.tsx        ← 创建新角色表单
├── auth/
│   └── callback/
│       └── page.tsx            ← 邮箱验证回调页
├── login/
│   └── page.tsx                ← 登录页
└── page.tsx                    ← xuxuxu 主站首页（作品集）
```

---

## 已完成的工作

### 1. 全页面暗色系重设计
所有爱巴基页面已按设计参考 (`0225/src/App.tsx`) 重新实现，统一设计语言：
- **背景**：`bg-zinc-950`（页面），`bg-zinc-900/80`（卡片）
- **强调色**：`text-pink-500`，渐变 `from-pink-500 to-purple-500`
- **玻璃效果**：`backdrop-blur-xl`，`border border-zinc-800/50`
- **发光阴影**：`shadow-[0_0_30px_rgba(236,72,153,0.3)]`
- **圆角**：`rounded-[2.5rem]`（大卡片），`rounded-xl`（小元素）

### 2. 响应式布局修复
原来 `app/aibaji/layout.tsx` 有 `max-w-[480px] mx-auto` 导致所有页面在桌面端被锁死为 480px 宽。已完全重写布局：

```
桌面端：左侧固定侧边栏 w-64 (sticky, 100dvh) + 右侧 flex-1 主内容区
移动端：顶部 header (md:hidden) + 底部固定导航栏 h-[72px] (md:hidden)
```

各页面配套改动：
- 页面根元素改为 `flex-1 overflow-y-auto`（滚动页）或 `flex-1 flex flex-col`（聊天窗口）
- 聊天窗口特殊处理：`style={{ height: 0, minHeight: '100%' }}` 避免与父容器 `md:h-screen` 冲突
- 移动端页面加 `pb-[72px] md:pb-0` 防止内容被底部导航遮挡
- 网格布局加响应断点：`grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5`

### 3. 登录后跳转修复
邮箱验证完成后原来跳转到旧版 `/home`，已全部改为 `/aibaji/square`：
- `app/login/page.tsx`：已有 session 时的跳转
- `app/auth/callback/page.tsx`：早期 session 检测跳转 + 验证成功跳转（共 2 处）

---

## 未完成的功能（可继续做）

### 优先级高
1. **「我的」个人资料页** (`/aibaji/profile` 或 `/aibaji/me`)
   - 设计参考在 `0225/src/App.tsx` 里有 `AibajiProfile` 组件
   - 目前导航里没有对应入口，需要在 `layout.tsx` 加导航项
   - 功能：显示用户邮箱、登出按钮、收藏的角色列表

2. **聊天窗口角色头像**
   - 当前 `app/aibaji/chat/[characterId]/page.tsx` 用角色名首字作为头像
   - 应改为从 Supabase Storage 读取角色图片（`character_assets` 表，`kind` 为 `head` / `cover`）
   - 签名 URL 方式已在 `characters/page.tsx` 里有参考实现

### 优先级低
3. **移动端细节打磨**（各页面的移动端体验）
4. **合并 PR**：将 `claude/review-xuxuxu-code-tqLoC` 合并到 `main`

---

## Supabase 数据库表结构（关键表）

| 表名 | 主要字段 |
|------|------|
| `characters` | `id, user_id, name, system_prompt, profile(jsonb), settings(jsonb), visibility('public'/'private'), created_at` |
| `character_assets` | `id, character_id, kind('cover'/'full_body'/'head'), storage_path, created_at` |
| `conversations` | `id, user_id, character_id, title, created_at` |
| `messages` | `id, conversation_id, role('user'/'assistant'), content, created_at` |

Storage bucket：`character-assets`（通过 `createSignedUrl` 访问）

---

## API 路由

- `POST /api/chat` — 发送消息，返回 AI 回复（`assistantMessage` 字段）
- `POST /api/aibaji/start-chat` — 从广场角色创建本地副本并返回 `localCharacterId`

---

## Git 操作规范

```bash
# 当前分支
git checkout claude/review-xuxuxu-code-tqLoC

# 推送
git push -u origin claude/review-xuxuxu-code-tqLoC
```

**注意**：分支名必须以 `claude/` 开头，以 session ID `tqLoC` 结尾，否则 push 会返回 403。

---

## 快速上手验证

```bash
cd /home/user/xuxuxu
git status              # 应显示 working tree clean
git log --oneline -5    # 查看最近提交历史
npm run dev             # 启动开发服务器
```
