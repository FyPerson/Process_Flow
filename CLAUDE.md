# CLAUDE.md — 业务全景图项目级约定

> 本文件仅给 Claude/Codex 看。新人友好向看 [README.md](README.md)。

## 项目语境（不可绕过）

- **内网部署 / 172.16.0.138 / 单实例**
- **最多 5 人并发 / < 100 用户总量**
- **不在范围**：OT/CRDT/Redis/Postgres/i18n/SSO/移动端 — 都不要按公网 SaaS 高并发场景给建议
- 详见 auto memory `project_business_flow_scope.md`（C:\Users\FY\.claude\projects\e-------\memory\）

## 协作模式（codex 三件套，每个阶段都要走）

1. **先审取舍**（spec-critique）— 方案/取舍点交 codex，拦掉会推翻草案的判断
2. **翻译报告**（不下结论） — codex 报告原样呈现给用户，分 severity 排列；不替用户做"采纳/不采纳"
3. **独立推荐** — 用户对每条意见拍板后再落地

详见 auto memory `feedback_ai_collaboration.md`。

**调 codex 前必报预估耗时**：advice-only 短任务 30-90s / 中等 90-180s / 长任务 180-600s / ≥5 分钟用后台模式 + ScheduleWakeup。

**何时跳过 codex 跑自审**（4 条全满足）：纯展示组件 + 无 mutation 副作用 + 依赖底层已审 + 边界 ≤ 10 可穷举。

## 工程红线

- **发版前必跑端到端 Playwright**：改 React Flow 派生 / 跨组件通信 / hook 联动时，单测 + tsc + codex 全过 ≠ 真功能可用。详见 `feedback_e2e_before_release.md`。
- **React Flow useNodesState/useEdgesState 锁外部 props**：派生注入节点 data 的字段必须走 useStore 订阅或 React Context，否则被锁。详见 `feedback_react_flow_state_lock.md`。
- **半组复制不支持绝对坐标**（P3B 决策）：FlowCanvas.copyNodes 只 copy 选中节点，剪贴板没源父位置；半组孤儿按"无父孤儿"+OFFSET 降级。如需支持，扩 copyNodes 写源父 position 入剪贴板元信息。

## 关键命令速查

```bash
# 开发
npm run dev              # api + vite 双进程并发，端口 5173

# 验证（npm test 已串好 lint:ids → typecheck:test → 单测）
npm test                 # 293 测试 + lint:ids 兜底 + 测试 type-check
npx tsc --noEmit -p tsconfig.client.json   # 前端类型检查（必须显式 -p）
npx tsc --noEmit -p tsconfig.server.json   # 服务端类型检查
npx tsc --noEmit -p tsconfig.test.json     # 测试类型检查

# 端到端
python tmp-test/test-p3b-nanoid-ids.py     # P3B 端到端示例

# 部署（v2 双 push + 客户端 deploy.ps1）
git push origin main && git push server main
powershell -File scripts/deploy.ps1        # 主 PowerShell 跑（不能在 hook 派生进程）
# 仅 server/ 改动可加 -SkipBuild
```

## 部署模式（v2，2026-04-30 起）

- 远端 `server` = `\\172.16.0.138\C$\GitRepos\business-flow.git`（bare repo）
- push 触发 hook **只做 fetch+reset 同步代码**，**不再调 ssh**（v1 hook 派生 PowerShell 子进程 ssh 静默失败 3 次）
- 客户端 `scripts/deploy.ps1` 在主 PowerShell 跑：ssh + npm install + build + pm2 restart + 验证 PM2 真重启 + /api/health 探活
- PM2 进程名 `business-flow`，由 [ecosystem.config.cjs](ecosystem.config.cjs) 管（DATA_DIR=E:/business-flow-data / PORT=3001）
- **仅 docs/.claude/README.md 改动不需要跑 deploy.ps1**

详见 [.claude/skills/deploy/SKILL.md](.claude/skills/deploy/SKILL.md)。

## 工程基建踩坑（auto memory 已固化）

- **Windows + PowerShell git hook**：UNC bare repo 必须清 GIT_DIR + 禁用全局 Stop ErrorAction，否则 fetch 假报错
- **tsc references 须显式 -p**：本项目 4 个 tsconfig（root + client + server + test）references 模式，`npx tsc --noEmit` 默认不编译子项目
- **加新 tsconfig 子项目**：建 + 加 references + 加 typecheck:xxx npm script + 排除/包含规则要让 IDE TS 服务能认领（避免红波浪线）

## 文档地图

| 位置 | 受众 | 职责 |
|---|---|---|
| [README.md](README.md) | 团队新人 | 5 分钟速览（是什么 / 怎么跑 / 怎么部署） |
| **CLAUDE.md（本文件）** | Claude / Codex | 项目约定 + 红线 + 命令速查 |
| [docs/规划/多人协作-方案.md](docs/规划/多人协作-方案.md) | 阶段决策 | 多人协作主方案（阶段 0-6 实施计划） |
| [docs/规划/技术债务登记.md](docs/规划/技术债务登记.md) | 债务台账 | 主动归档 / 已偿还 / 未结项 |
| [docs/规划/codex审查记录/阶段X/PXX/](docs/规划/codex审查记录/) | 历史归档 | 每阶段 codex 审查链 + 99-收尾 |
| [.claude/skills/deploy/SKILL.md](.claude/skills/deploy/SKILL.md) | Claude | /deploy 流程定义 |
| [.claude/skills/neat-freak/SKILL.md](.claude/skills/neat-freak/SKILL.md) | Claude | /neat 文档同步 + 阶段发版 |
| [.claude/skills/codex-cli-bridge/SKILL.md](C:\Users\FY\.claude\skills\codex-cli-bridge\SKILL.md) | Claude | codex 调用桥（user 级） |
| auto memory MEMORY.md | Claude | 跨会话记忆（C:\Users\FY\.claude\projects\e-------\memory\） |
| [内部凭据.md](内部凭据.md) | 本机持久化 | gitignore 不入仓库 |

## 当前阶段

阶段 5 合并算法 4 天 MVP — **Day 1 完工**（v1.12.0，2026-05-06）：类型/框架/saveCanvas 入口三分支改造 + schema parentId 真校验 + 旧数据审计脚本。Day 1 是基建层无功能落地（合并算法 stub 未真接入，Day 2 才接 detector/apply）。
- `server/services/merge/`（新建 39KB）：types.ts（含 ConflictType 16 项 + DetectContext + StorageNodeContentFields/StorageConnectorContentFields + 4 个 AssertNever 真断言双向防漂移）/ computeDelta.ts（含 DataIntegrityError + assertProjectIntegrity 7 项硬约束 + computeDelta 主入口）/ computeDelta.test.ts 18 case
- `server/schemas/canvas.ts`：parentId 真校验（line 247-294 两遍循环 + 自引用拒 + group 不能嵌套 + 必须指向 group）+ canvas.test.ts 新建 6 case
- `server/services/canvases.ts`：saveCanvas 入口三分支（baseVersion <、=、> 三种语义）+ SaveCanvasResult 加 base_version_expired
- `server/db/migrations/0005_conflict_logs_extend_resolution.sql`：扩 CHECK 加 base_version_expired
- `scripts/audit-canvas-integrity.mjs`：旧数据审计脚本，生产 db 已跑过 0 违规

codex 7 轮审查链 final 0 high + 0 medium 全闭环 confidence=high；单测 282→293；tsc 三端 + lint:ids + build 全过。下次进 Day 2 detector/apply 主体（约 6h + 25+ 单测）。

详见 [docs/规划/codex审查记录/阶段5/P5-合并算法/99-收尾.md](docs/规划/codex审查记录/阶段5/P5-合并算法/99-收尾.md)。

## 给未来 Claude 的话

- 看到 `Date.now()` 拼节点 ID 立刻警觉（已被 lint:ids 拦），用 `src/utils/ids.ts` 的 `newNodeId/newGroupId/newEdgeId`
- 改 `useFlowClipboard.ts` 或 `useMultiCanvas.ts` 复制粘贴路径必读 `src/hooks/useFlowClipboard.test.ts` 单测
- codex 报告里若给"加 rate limit/CDN/SLO 监控"这类建议，先用项目语境过滤
- 修法描述 ≠ 修法实现：codex 揪出"我以为修了实际没改对"已 ≥4 次（P3D-2 step 3 helper 写没用 / P3B 二/三审复制粘贴 idMap 死代码 / P4 useDraftAutosave interval 被 effect deps 重置 / P5 Day 1 五审 M5 元组假断言 TS 不拒编译）。**Read 完整文件不够**——必须用反向测试证明断言/防漏机制生效（如临时删字段跑 tsc 验证报错）
