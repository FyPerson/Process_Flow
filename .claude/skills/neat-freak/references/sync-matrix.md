# 变更影响矩阵（业务全景图项目本地版）

遇到不确定"这次改动要同步哪些文件"时查这张表。**所有判断都建立在项目语境前提之上**：内网 / 5 人并发 / <100 用户。

## 代码层变更 → 文档层变更

| 本次对话发生的事 | 要改的文件 |
|---|---|
| 新增 / 改 React Flow 节点类型 | `CLAUDE.md` 节点速查（若有）+ 当阶段 codex 审查（如 `阶段3/P3X/0Y-...md`） |
| **改 React Flow 派生 / hook 联动 / useNodesState** | auto memory `feedback_react_flow_state_lock.md` 验证是否还准 + 强制提示用户跑 Playwright e2e |
| 新增 / 改 API 路由（server/） | `CLAUDE.md` 路由清单（若有）+ 当阶段 codex 审查文档 |
| 新增 / 改 Zustand store / 跨组件通信 | auto memory 检查是否需要新增"踩坑"+ 强制提示 e2e |
| 新增 Playwright e2e 测试 | auto memory `feedback_e2e_before_release.md` 检查是否需要更新触发条件清单 |
| 改部署 hook / 内网部署脚本 / 172.16.0.138 相关 | auto memory `feedback_windows_git_hooks.md` 检查冲突 + 必要时改写 |
| 改 tsconfig / 构建流程 | auto memory `feedback_tsc_references_explicit_project.md` 验证 |
| 改 package.json scripts | `CLAUDE.md` 命令速查（若有）+ README 运行步骤 |
| 涉及多人协作 / 权限 / 画布所有权 | `docs/规划/多人协作-方案.md` |
| codex 审查里发现新债务 | `docs/规划/技术债务登记.md` 主动归档 |
| codex 审查里偿还旧债务 | `docs/规划/技术债务登记.md`：从主动归档**移到**已偿还（不要直接删） |
| 新增大特性（一个完整 PXX） | 阶段产物 `docs/规划/codex审查记录/阶段X/PXX/01-04-...md` 应该已经有；收尾时补 `99-收尾.md`（仅模式 B） |

## 记忆层变更（auto memory）

| 情况 | 处理方式 |
|---|---|
| 过期事实 | 改记忆文件，同时更新 `MEMORY.md` 索引的 description |
| 相对时间（"今天"、"最近"、"上周"） | 全部转成绝对日期（`2026-05-06` 而非"今天"） |
| 重复记录（多条说同一件事） | 合并为一条，改索引 |
| 已完成的待办 | 删除——auto memory 不是历史档案 |
| 推翻的决策 | 删除旧条目，留新决策 |
| 跨会话只用一次的临时上下文 | 删除 |
| 又一次踩到 React Flow 锁外部 props | 在 `feedback_react_flow_state_lock.md` 追加"已踩 N 次"计数；不新建文件 |
| 新出现的"通用纪律"（适用于所有未来阶段） | 新建 `feedback_*.md` 文件 + 加到 `MEMORY.md` 索引 |

## 高频踩坑提醒（来自 auto memory）

每次同步时顺手核对：

- **React Flow useNodesState 锁外部 props**（已踩 P3C / P3E-3 两次）：派生注入节点 data 必须走 useStore 订阅或 React Context
- **tsc references 须显式 -p**：`npx tsc --noEmit` 默认不编译子项目，前端验证必须 `-p tsconfig.client.json`
- **Windows git hook 双坑**：UNC bare repo 自动部署里必须清 `GIT_DIR` 且禁用全局 Stop ErrorAction
- **e2e 必跑红线**：codex 多轮审查 + 单测全过 + 部署成功 ≠ 真实功能可用；改 React Flow 派生 / 跨组件通信 / hook 联动时必跑 `tmp-test/` Playwright

如果本次改动**碰到了上面任何一条的触发条件**，但你**没在文档里看到提醒用户跑对应验证**，那是漏改——补上。

## 项目语境过滤（重要）

执行同步过程中如果产出以下建议，**先用项目语境过滤**：

| 通用建议 | 本项目是否适用 | 原因 |
|---|---|---|
| 加 rate limit | ❌ | 5 人并发，没必要 |
| 加 CDN | ❌ | 内网部署 |
| 加监控告警 / SLO | ❌ | 单实例，看日志即可 |
| 加 OAuth / 多租户隔离 | ❌ | 内网 + <100 用户 |
| 加 i18n | ❌ | 中文单一语言 |
| 加 Sentry / APM | ❌ | 内网，靠 console + 服务端日志 |
| **e2e 测试 / 数据备份 / 错误边界** | ✅ | 5 人共用画布，数据丢失代价高 |
| **权限校验 / 画布所有权** | ✅ | 多人协作核心 |
| **TypeScript 严格化** | ✅ | 5 人协作减少口头沟通 |

文档里如果遗留了"❌"那一栏的建议，标注 `(语境不适用，已搁置)` 或直接删，附理由。

## 跨文件影响速查（最容易漏改的场景）

- **改了 auto memory 里某条规则** → 检查 `CLAUDE.md` 是否也有同样的规则、改了没；两边只能有一份，**通常以 auto memory 为权威**
- **改了 `技术债务登记.md`** → 阶段审查文档（`阶段X/PXX/0Y-...md`）里如果引用了该债务的旧描述，也要同步
- **bump 版本号** → `package.json` + 可能的 `CHANGELOG.md`（如果有）+ `99-收尾.md` 标题里的版本号
- **改部署相关** → README 部署章节 + auto memory `feedback_windows_git_hooks.md` + 部署 hook 脚本（这是代码不是文档，但要确认两侧一致）

## 文档不该做的事

- **CLAUDE.md 不要抄 docs/ 全文**——CLAUDE.md 给当前会话的 Claude 看，简洁列点 + 路径指引就够
- **docs/ 不要写"我记得上次……"** ——那是 auto memory 的事
- **README 不要写阶段细节** ——README 是 5 分钟速览
- **auto memory 不要存代码片段或文件路径**——读代码就能查到的事不要进 memory（参考 MEMORY.md 顶部的"什么不该存"）
