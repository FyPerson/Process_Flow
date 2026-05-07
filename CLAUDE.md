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
npm test                 # 447 测试 + lint:ids + check:invariants + check:conflict-guards + 测试 type-check
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

阶段 5 合并算法 4 天 MVP —— **Day 1 + Day 2 + Day 3 + Day 4 完工 / 4/4 全闭环**（截至 2026-05-08）：
- **Day 1**（v1.12.0，2026-05-06）：类型/框架/saveCanvas 入口三分支改造 + schema parentId 真校验 + 旧数据审计脚本。codex 7 轮审 final 0 high + 0 medium，单测 282→293
- **Day 2**（v1.13.0，2026-05-07）：合并算法主体 — detector + applyDelta + tryMerge + saveCanvas 接合并完整闭环
  - 阶段 A：saveCanvas 快速路径迁移 Delta + 3 helper / 阶段 B 五切片 detector+applyDelta+tryMerge / 阶段 C saveCanvas 接合并 7 case 端到端 / 阶段 D 末尾审 0 issue
  - codex 修订 #2 #3：用 canvas_versions.saved_by 不用 canvases.updated_by（PATCH/publish 会改脏主表）
  - high 风险吸收：saveCanvas 独立持有 deltaB 给 helper 用；tryMerge 内部 deltaB 不外传
  - 单测 293 → 389 / 4 test_gap 挂账 #33/#34
- **Day 3**（v1.14.0，2026-05-07）：客户端接合并响应 + conflict_logs 写入 + Delta 序列化 + 类型契约守门
  - **前置 P-1/P-2/P-3**：开 includeDebugDelta=true / ApiError 扩 conflicts / base_version_expired 补查 currentVersionAuthor
  - **D-1 D-2 D-3**：serialize.ts（7 Map → entries + 64KB 截断）/ conflict_logs.ts（3 种 resolution 同事务 INSERT）/ 客户端类型镜像 + 契约测试
  - **D-4**：useMultiCanvas.save() 处理 merged=true / base_version_expired / conflict 携 conflicts
  - **codex 4 轮审查**：取舍审 → 首轮末尾审戳穿 2 high → 复审戳穿 A 方案破坏不变量 → 三审 PASS B 方案；canEnterBump: true
  - **B 方案核心不变量**：serverVersionRef ≡ projectRef 服务端基线；merged=true + changeSeq 不等时 server-side state 全不动；下次 save 用旧 baseVersion 让服务端再合并
  - **D-3 high #1 修法**：契约测试改 `Assert<T extends true>` + `IsEqual<X,Y>` 真 compile-fail pattern；旧 `type X = ... ? true : never` 沉默通过；反向验证 2 次都让 tsc 真报错
  - 单测 **389 → 406** 全过 / tsc 三端 0 错 / lint:ids 0 违规

- **Day 4**（v1.15.0，2026-05-08）：真冲突 UI + Playwright e2e + BFV bug 修法
  - **codex 7 次审查链**：01 取舍审 → 02 拍板（22 切片）→ 03 切片设计审 → 04 F16-fh 范围判读审 → 05 F16b 小范围审 → 06 F14b 设计取舍审 → 07 末尾审 canEnterBump=true
  - **切片 1+2**（commit `d301fb2`）：类型层 + B 方案不变量三层守门（类型 mergeSavePlan + 单测 g1/g2 + grep check:invariants）
  - **切片 3+4**（commit `7ee4ad5`）：Toast 基建 + ConflictResolutionDialog + BaseVersionExpired 弹窗 + BFV 接入 + check:conflict-guards
  - **F-16a 服务端 5 case**（#34 (a)-(e) 偿还）：annotations 级联 / sheet_removed_modified / deprecated 路径 / E7 warnings / connector E1+E3
  - **F-16b 抽 saveErrorDispatcher 纯函数**（#34 (f)/(h) 偿还）：04 范围判读审拍板"不引入 RTL/jsdom"+ 类型层 `shouldDeleteDraft: false` 字面常量守门 (h) + L2 switch never 穷尽检查 + R5 currentVersion 类型非法测试
  - **F-15 PUT route supertest**（#33 偿还）：6 it 覆盖 DataIntegrityError 500 / conflict 409 + conflicts JSON 序列化 / base_version_expired / 权限优先级 403 / merged 200
  - **F-14a smoke 12/12 + F-14b conflict-flow 32/32**：双 ctx 隔离基建验证 + 3 路径 e2e（直接保存 / 真合并自动通过 / 真冲突弹窗）；06 设计审拍板"单浏览器 + API 模拟对方"模式
  - **F-14b 揪出 BFV 真 bug + C 修法**：BFV [887] 错误兜底页判 `serverError || !project` 让 conflict 路径 setServerError 触发兜底页吞 ConflictResolutionDialog；修法把 setServerError 挪到 rethrow 分支
  - **F-17 末尾审**：canEnterBump=true / 0 critical+high / M1 修法（planSaveError 入参 unknown + 形状守卫防非 ApiError 二次异常）/ L1+L2 挂账 #35 #36
  - 单测 416 → **447**（+31：dispatcher 19 / merge.test +6 / put.test 6）/ tsc 三端 0 错 / lint + check:invariants + check:conflict-guards + typecheck:test 全过

阶段 5 整体进度 **3.5/4 → 4/4**（Day 1 + 2 + 3 + 4 完工，合并算法 4 天 MVP 全闭环）。
- 整阶段时间线：[阶段5/P5-合并算法/README.md](docs/规划/codex审查记录/阶段5/P5-合并算法/README.md)
- Day 1 收尾：[Day1-基建/99-收尾.md](docs/规划/codex审查记录/阶段5/P5-合并算法/Day1-基建/99-收尾.md)
- Day 2 收尾：[Day2-合并算法/99-收尾.md](docs/规划/codex审查记录/阶段5/P5-合并算法/Day2-合并算法/99-收尾.md)
- Day 3 收尾：[Day3-客户端/99-收尾.md](docs/规划/codex审查记录/阶段5/P5-合并算法/Day3-客户端/99-收尾.md)
- **Day 4 收尾**：[Day4-真冲突UI/99-收尾.md](docs/规划/codex审查记录/阶段5/P5-合并算法/Day4-真冲突UI/99-收尾.md)

**下次 next**（阶段 5 完工后下个阶段方向待用户拍板）：
- 选项 A：阶段 6 多人协作 v2 / 演示 / 培训
- 选项 B：代码质量子阶段（清 lint 74 项 + 偿还 #22-#27 安全债 + 偿还 #35/#36 Day 4 挂账）

**Day 4 已沉淀的关键约束**（写入 02-拍板记录 + 99-收尾）：
- B 方案不变量已升级为**类型不变量**：`mergeSavePlan` 纯函数 `DeferMergedPlan` 不携带"推进 ref/替换 project"字段；`saveErrorDispatcher` 的 `shouldDeleteDraft: false` 字面常量守门 (h)
- 三层守门齐全：类型层 + 单测 g1/g2 + grep `check:invariants` / `check:conflict-guards`
- 三个 modal 弹窗（Conflict / BaseVersionExpired / DraftRecovery）都用 React Portal 挂 document.body
- ESC 不隐式关闭弹窗 + aria-modal=true + pending action 中 disable 全按钮
- **catch 块决策走 saveErrorDispatcher 纯函数 plan**（switch + never 穷尽检查 + 入参 unknown 形状守卫）；setServerError 仅在 rethrow 路径写（C 修法防 BFV 错误兜底页吞弹窗）

**codex 调用 Windows sandbox 1326 + ARG_MAX 32KB 双坑根治**：大 prompt 必须用 stdin 注入 + 前置代码内容（避开 PowerShell 子进程 1326 / Windows 命令行长度限制）。详见 [P5-合并算法/README.md § codex 协作模式](docs/规划/codex审查记录/阶段5/P5-合并算法/README.md)。

## 给未来 Claude 的话

- 看到 `Date.now()` 拼节点 ID 立刻警觉（已被 lint:ids 拦），用 `src/utils/ids.ts` 的 `newNodeId/newGroupId/newEdgeId`
- 改 `useFlowClipboard.ts` 或 `useMultiCanvas.ts` 复制粘贴路径必读 `src/hooks/useFlowClipboard.test.ts` 单测
- codex 报告里若给"加 rate limit/CDN/SLO 监控"这类建议，先用项目语境过滤
- 修法描述 ≠ 修法实现：codex 揪出"我以为修了实际没改对"已 ≥4 次（P3D-2 step 3 helper 写没用 / P3B 二/三审复制粘贴 idMap 死代码 / P4 useDraftAutosave interval 被 effect deps 重置 / P5 Day 1 五审 M5 元组假断言 TS 不拒编译）。**Read 完整文件不够**——必须用反向测试证明断言/防漏机制生效（如临时删字段跑 tsc 验证报错）
