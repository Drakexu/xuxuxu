# Dra.QT UI Worklog（2026-04-08）

## Task: 页面刷新后回到顶部

- **问题**：Dra.QT 页面刷新后会停在页面底部，体验很差。
- **设计文档**：`docs/Dra.QT-Scroll-Restore-Fix-20260408.md`
- **备份**：`backups/20260408-0348-draqt-scroll-top/page.tsx`
- **计划**：在页面挂载时关闭浏览器自动滚动恢复，并主动滚动到顶部。
- **回滚**：用备份文件覆盖 `app/project/dra-qt/page.tsx`

### 修复完成（2026-04-08）

**改动文件**：`app/project/dra-qt/page.tsx`

**改动内容**：在组件挂载时新增一个 `useEffect`（空依赖数组，仅首次挂载执行）：
1. 保存当前 `window.history.scrollRestoration` 值
2. 设为 `"manual"` 禁止浏览器自动恢复滚动位置
3. 调用 `window.scrollTo({ top: 0, left: 0, behavior: "auto" })` 强制回顶部
4. 组件卸载时恢复原始 `scrollRestoration` 值

**验证步骤**：
1. 打开 Dra.QT 页面，等待数据加载完成
2. 手动滚动到页面底部
3. 按 F5 / Cmd+R 刷新浏览器
4. 确认页面从顶部开始显示，而非停留在底部
5. 导航到其他页面，确认其他页面滚动行为不受影响
