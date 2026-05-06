# Agent 记忆与配置路径速查（业务全景图本地版）

本项目只用 Claude Code，所以这份文档只保留 Claude Code 部分。原 skill 的 Codex / OpenCode / OpenClaw 路径已删——遇到要跨 agent 同步的需求再加回来。

## Claude Code

| 用途 | 实际路径 |
|---|---|
| auto memory（跨会话记忆） | `C:\Users\FY\.claude\projects\e-------\memory\` |
| 记忆索引 | `C:\Users\FY\.claude\projects\e-------\memory\MEMORY.md` |
| 全局指令 | `C:\Users\FY\.claude\CLAUDE.md`（如有） |
| 项目级指令 | `e:\业务全景图\CLAUDE.md`（如有，可层级嵌套到子目录） |
| 项目级 skills | `e:\业务全景图\.claude\skills\<name>\SKILL.md` |
| 用户级 skills | `C:\Users\FY\.claude\skills\<name>\SKILL.md` |
| 项目设置 | `e:\业务全景图\.claude\settings.local.json` |

## 记忆文件 frontmatter 规范

每个记忆 `.md` 顶部必须有：

```yaml
---
name: <短标题>
description: <一行描述，决定未来会话是否检索到该条>
type: user | feedback | project | reference
---
```

四种 type：
- `user`：用户角色 / 偏好 / 知识背景
- `feedback`：协作反馈（"不要 X"、"以后都要 Y"）——**最常用**
- `project`：当前项目状态 / 决策 / 时间线
- `reference`：外部系统的指针（Linear ticket、Slack 频道、Grafana 看板）

## 编辑 auto memory 时的硬约束

- **MEMORY.md 是索引**：每条一行，`- [标题](file.md) — 一句话钩子`，全文不超过 200 行（超过会被截断）
- **不在 MEMORY.md 写记忆正文**——内容必须进单独文件
- **重复检测**：写新记忆前先用 Grep 在 memory/ 里搜关键词，避免新建已经存在的条目
- **绝对日期**：所有日期写成 `2026-05-06` 格式

## 当前已存在的记忆文件（截至 2026-05-06）

来自 `MEMORY.md`，用于盘点时核对：

- `project_business_flow_scope.md` — 项目语境前提（内网/5 人/<100 用户）
- `feedback_ai_collaboration.md` — codex 三件套
- `feedback_windows_git_hooks.md` — UNC bare repo 部署双坑
- `feedback_tsc_references_explicit_project.md` — tsc -p 必显式
- `feedback_react_flow_state_lock.md` — useNodesState 锁外部 props
- `feedback_e2e_before_release.md` — 发版前必跑 Playwright

每次同步时核对：
- 索引和文件是否一一对应（没有索引指向不存在文件，没有文件没在索引中）
- description 和文件实际内容是否一致
