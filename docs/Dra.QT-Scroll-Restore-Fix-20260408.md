# Dra.QT 页面刷新回顶部修复设计（2026-04-08）

## 现象
- Dra.QT 页面在浏览器刷新后，经常停留在页面底部，而不是从顶部开始。

## 初步判断
- 浏览器会尝试恢复上一轮滚动位置。
- Dra.QT 页面内容很长，且为客户端页面，浏览器恢复滚动时容易直接落在之前的底部位置。
- 当前页面没有显式禁用 scroll restoration，也没有在首屏挂载时主动滚回顶部。

## 修复目标
1. 刷新 Dra.QT 页面时，默认回到页面最上方。
2. 只影响该页面，不扩大到全站其他页面。
3. 改动尽量小，避免影响现有数据刷新逻辑。

## 方案
- 在 `app/project/dra-qt/page.tsx` 页面组件挂载时：
  - 暂时将 `window.history.scrollRestoration` 设为 `manual`
  - 在首帧执行 `window.scrollTo({ top: 0, left: 0, behavior: "auto" })`
  - 组件卸载时恢复之前的 `scrollRestoration` 值

## 风险
- 低风险，仅影响 Dra.QT 页面初次挂载的滚动行为。
- 不应影响页面内的定时数据刷新。

## 验证
- 打开 Dra.QT 页面，手动滚动到页面底部。
- 执行浏览器刷新。
- 期望：页面回到顶部，而不是停在底部。

## 回滚
- 恢复备份：`backups/20260408-0348-draqt-scroll-top/page.tsx`
