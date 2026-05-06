---
name: neat-freak
description: >
  业务全景图项目专用的"项目文档同步 / 阶段发版"洁癖 skill，仅处理项目仓库内的文件
  （docs/、CLAUDE.md、package.json）和 auto memory 一致性，不做单次会话沉淀（那是
  /remember 的职责）。两种触发模式：
  (A) 文档同步——用户说 "/neat"、"/sync"、"同步文档"、"整理项目文档"、"对齐 docs"
  时，对齐代码、CLAUDE.md、docs/规划/、auto memory 四层。
  (B) 阶段发版——用户说 "PXX 收尾"、"PXX 完工"、"PXX 发版"、"bump 版本号"、
  "/release"、"阶段收尾三件套" 时（必须带 PXX 编号或 bump/release 字样），额外强制
  执行三件套：bump 版本号 + 更新 docs/规划/技术债务登记.md + 写 docs/规划/codex审查
  记录/阶段X/PXX/99-收尾.md。阶段发版以版本号 bump 为锚——不 bump 不写 99；bump
  必写 99。**与 /remember 的边界**：本 skill 不处理"沉淀本次会话"、"梳理记忆"、
  "收尾会话"等单次会话级请求——那些一律走 /remember。fork 自 KKKKhazix/khazix-skills
  并按本项目结构本地化。
---

# 洁癖（业务全景图本地版）

> 项目级 skill，跟仓库走（`.claude/skills/neat-freak/`）。所有路径以 `e:\业务全景图\` 为根。

## 项目语境前提（不可绕过，所有判断都建立在此之上）

- **内网部署 / 172.16.0.138 / 单实例**
- **最多 5 人并发 / < 100 用户总量**
- **协作模式**：codex 三件套（先审取舍 → 翻译报告 → 独立推荐）+ Claude 落地 + Playwright e2e
- 不要按通用 SaaS / 高并发场景做建议；遇到 codex / 自检产出"加 rate limit"、"加 CDN"、"加监控告警"这类建议，先用语境过滤一遍

## 关键概念：四层知识，四种受众

| 位置 | 受众 | 职责 |
|---|---|---|
| **auto memory**（`C:\Users\FY\.claude\projects\e-------\memory\`） | 跨会话的 Claude 自己 | 协作偏好、踩坑、项目语境前提（不写代码能查到的事实） |
| **项目根 `CLAUDE.md`** | 当前项目的 Claude（本会话 / 下次会话） | 项目约定、红线、目录速查、命令速查 |
| **`docs/规划/`**（技术债务登记、多人协作-方案、codex审查记录/） | 未来的你 + 未来的 codex/Claude | 阶段决策快照、债务台账、流程模板 |
| **`README.md`** | 第一次接触项目的人（团队新成员、外部接入） | 5 分钟速览：是什么 / 怎么跑 / 怎么部署 |

**受众不混**：CLAUDE.md 不抄 docs/ 全文，docs/ 不写"我记得上次……"那是记忆的事，README 不写阶段细节。

## 模式 A：文档同步（默认）

用户触发词：`/neat`、`/sync`、`同步文档`、`整理项目文档`、`对齐 docs`、`审查文档一致性`、`新人能直接上手项目`

**不在触发范围**：`梳理记忆`、`沉淀会话`、`收尾一下`（含糊版）→ 这些走 `/remember`，不走本 skill。本 skill 只处理项目仓库内的文档和 auto memory 一致性。

### 第一步：盘点现状（机械式枚举，不能跳过）

按顺序执行，**先 ls 再判断**：

1. **auto memory**：
   - 用 Glob：`C:\Users\FY\.claude\projects\e-------\memory\*.md`
   - 读 `MEMORY.md`，再逐个读它索引的所有 `.md`
2. **项目根 markdown**：
   - 读 `CLAUDE.md`（若存在）、`README.md`、`AGENTS.md`（若存在）
3. **docs/规划/**：
   - Glob `docs/规划/*.md` → 至少有 `技术债务登记.md`、`多人协作-方案.md`
   - Glob `docs/规划/codex审查记录/**/*.md` → 阶段产物全集
4. **本次对话回顾**：本会话产生了哪些事实？涉及哪些 PXX？

**输出文件清单**（内部用）：每个文件标 「评估过 / 要改 / 不用改」。漏一个就回去补。

### 第二步：识别变更——查 sync-matrix

完整映射见 [references/sync-matrix.md](references/sync-matrix.md)。本项目高频场景速览：

- **新增 React Flow 节点 / hook 联动** → `CLAUDE.md` + auto memory 是否需要新增"踩坑"条目（如又一次 useNodesState 锁外部 props）
- **新增 / 改 API 路由** → `CLAUDE.md` 路由清单（若有）+ 当阶段 codex 审查文档
- **改 Playwright 流程 / 新增 e2e** → auto memory `feedback_e2e_before_release.md` 检查是否还准
- **改部署 / hook / 内网相关** → auto memory `feedback_windows_git_hooks.md` 检查是否冲突，必要时更新
- **codex 审查里发现新债务** → `docs/规划/技术债务登记.md` 追加到"主动归档"
- **过期记忆 / 相对时间** → 改 auto memory，相对日期改成 `2026-05-06` 这种绝对日期

### 第三步：实际修改（用 Edit / Write，不只是描述）

**顺序**：先改 docs/（外部影响最大）→ 再改项目根 markdown → 最后整 auto memory。

**编辑原则**：
- **合并优于追加**：旧条目过期就改它，不要再加一条
- **删除优于保留**：完成的待办、推翻的决策、过期的上下文，删
- **绝对时间**：永远 `2026-05-06`，不写"今天"、"最近"、"上周"
- **技术债务登记**特殊规则：处理完的债务**移到底部"已偿还"段**，不要直接删（保留追溯性）
- **auto memory 索引**：`MEMORY.md` 里只放一行链接，详情进单独文件；行数控制在 200 内

### 第四步：自检清单（必须逐项过）

- [ ] 第一步列出的每个文件都判断了"不用改"或"已改"
- [ ] `MEMORY.md` 每个链接指向真实存在的文件
- [ ] auto memory 之间没有互相矛盾
- [ ] CLAUDE.md / README 里提到的路径 / 命令 / 端口 / 环境变量在代码或部署脚本中真实存在
- [ ] 没有相对时间遗留：用 Grep 跑 `(今天|昨天|刚刚|最近|上周|本周|today|yesterday|recently)` 在 auto memory 和 CLAUDE.md 应清零
- [ ] **项目语境前提**没被违反：自检产出里没有"加 rate limit / 加 CDN / 加 SLO"这类不适用于内网 5 人场景的建议
- [ ] 涉及 React Flow 派生 / 跨组件通信 / hook 联动的改动：是否提醒了 e2e 必跑？

### 第五步：变更摘要

```
## 同步完成

### auto memory
- 更新：xxx（原因）
- 新增：xxx
- 删除：xxx（原因）

### 项目文档
- CLAUDE.md — xxx
- docs/规划/技术债务登记.md — xxx
- docs/规划/codex审查记录/阶段X/PXX/0Y-xxx.md — xxx

### 未处理
- xxx（为什么没处理，需要用户确认的事）
```

只列有实际变更的条目。

---

## 模式 B：阶段发版（bump 版本号触发）

用户触发词：必须**同时**满足"阶段编号或 bump/release 字样"——`PXX 收尾`、`PXX 完工`、`PXX 发版`、`bump 版本号 → X.Y.Z`、`/release`、`阶段收尾三件套`、`PXX 阶段做完了准备发版`

**不在触发范围**：单纯的"收尾一下"、"做完了"、"沉淀这次会话"——那些含糊请求走 `/remember`，不走本 skill。如果用户没明说阶段编号或版本号，**不要假设是 B 模式**，先反问一句"是要 /remember 沉淀本次会话，还是要 /neat 同步项目文档？"

**铁律**：**以版本号 bump 为锚——不 bump 不写 99；bump 必写 99。**

### 前置确认（执行前问用户）

如果用户没明说，先确认这三件：
1. 当前要收尾哪个阶段？（如 P3G、P3H）
2. 版本号怎么 bump？（patch/minor/major + 具体目标版本）
3. 这次发版的"主题一句话"是什么？（用于 commit message 和 99-收尾.md 标题）

任何一项不清楚，**停下来问**，不要自己猜版本号。

### 标准动作四件（从 A 升级）

1. **执行模式 A 的第一/二/三步**（盘点 / 识别变更 / 修改文档）
2. **bump 版本号**：
   - 改 `package.json` 的 `version` 字段
   - 检查是否有 `package-lock.json` / `pnpm-lock.yaml` 需要同步（一般 `npm i` 一次即可，但**不要自己跑**——确认环境后由用户跑）
3. **更新 `docs/规划/技术债务登记.md`**：
   - 本阶段**新发现**的债务追加到"主动归档"对应阶段段
   - 本阶段**已偿还**的债务从"主动归档"移到"已偿还"
   - 每条必须含：来源（哪份审查文档）、问题简述、建议阶段、严重度（🔴/🟡/⚪）
4. **写 `docs/规划/codex审查记录/阶段X/PXX/[可选 DayN-主题/]99-收尾.md`**：
   - 用 [references/99-收尾模板.md](references/99-收尾模板.md) 的轻量骨架（500–1000 字）
   - **不要重复 01/02/03 已经写过的 codex 审查内容，只做"指针 + 抽象"**
   - 文件名固定 `99-收尾.md`（避开 01/02/03/04… 审查编号撞车）
   - **多 Day 切片阶段**（如阶段 5 4 天 MVP）：99-收尾 写到对应 `DayN-主题/` 子目录（如 `阶段5/P5-合并算法/Day1-基建/99-收尾.md`），避免每天 bump 都撞同一个文件名
   - **单一主题阶段**（如阶段 4）：99-收尾 直接写阶段目录根（如 `阶段4/P4-设计取舍/99-收尾.md`）
   - 阶段整体收尾时（最后一天 Day N）：在 `阶段X/PXX/README.md` 写整阶段时间线表格 + 整阶段总收尾指针

### 阶段收尾自检清单（在 A 的清单基础上加这几项）

- [ ] `package.json` version 已 bump 且与 commit message 中的版本一致
- [ ] `99-收尾.md` 已落盘且引用了本阶段的 01/02/03/04 审查文档（相对路径）
- [ ] `技术债务登记.md` 的"主动归档"和"已偿还"段都更新了
- [ ] 本阶段如果改了 React Flow 派生 / 跨组件通信 / hook 联动 → **Playwright e2e 已跑过**（feedback_e2e_before_release.md 红线）
- [ ] commit message 模式正确：`chore(release): bump X.Y.Z — <主题>`
- [ ] 不要在 commit 里直接 `git push`——发版推送由用户决定（部署是 hook 自动的，不需要 push 触发）

### 阶段收尾摘要（在 A 的摘要基础上加这段）

```
### 阶段收尾三件套
- package.json: 1.9.0 → 1.10.0
- 技术债务登记.md: 新增 N 条 / 移到已偿还 M 条
- docs/规划/codex审查记录/阶段X/PXX/[DayN-主题/]99-收尾.md: 已落盘 (xxx 字)

### 待用户确认
- 是否执行 git commit + push？（默认不自动）
- 是否需要更新 README 版本号或部署文档？
```

---

## 特殊情况

**对话没有产生新事实**：审查现有文档和记忆有没有过期 / 冲突 / 相对时间——审查本身就有价值，照样输出摘要。

**记忆之间出现无法自动判断的矛盾**：列在「未处理」让用户决定。**这是唯一需要用户介入的情况**，其他都自己拍板。

**用户说"阶段做完了"但还没 bump**：走模式 A，并在摘要末尾问一句"是否要顺便 bump 版本走收尾三件套？"。**不要擅自 bump**。

**发现之前的同步漏了东西**：修掉。不要说"那不是这次对话的事"——你就是这个项目的持续编辑，过去的漏洞也归你管。

**docs 里出现了 README 里也有的内容**：以 docs/ 为准，README 只保留"5 分钟速览"。

**技术债务登记里有项目语境不适用的建议**（比如 codex 之前没带语境时建议的"加监控告警"）：标注 `(语境不适用，已搁置)` 或直接删，附理由。

## 与其他 skills 的边界

- 这个 skill **不写代码**，只整理文档 / 版本号 / 记忆
- 改代码归 Claude 主进程或专门的实现 skill
- codex 审查归 codex（你不模拟 codex 的审查产出，只引用它的结论）

## 参考

- [references/sync-matrix.md](references/sync-matrix.md) — 变更类型 → 要改哪些文件 的本项目映射
- [references/99-收尾模板.md](references/99-收尾模板.md) — 阶段收尾文档骨架（轻量复盘）
- [references/agent-paths.md](references/agent-paths.md) — Claude Code 记忆路径速查（fork 自原 skill，本项目只用 Claude Code）
