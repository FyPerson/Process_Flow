# P5 Day 4 取舍审 — 真冲突 UI + Playwright + 部署

- **日期**：2026-05-07
- **范围**：Day 4 真冲突弹窗 4B 流程（保存草稿 / 继续编辑草稿 / 取消）+ toast 自动合并报告 + Playwright e2e + 部署
- **codex 调用**：
  - 模式：advice-only / sandbox read-only / MaxContextChars=200000
  - 调用方式：stdin 注入（45KB prompt，避开 Windows sandbox 1326 + ARG_MAX 32KB）
  - bash id：（同步阻塞跑，约 3-4 分钟返回）
  - 输入文件：`E:/tmp/codex-day4-quxie-shen.md`
  - 输出文件：`E:/tmp/codex-day4-quxie-result.md`

## 4 个用户拍板项（取舍审前置）

1. **W1 弹窗按钮组**：三按钮 = 保存草稿并查看最新版本 / 继续编辑草稿 / 取消
2. **W2 mergeReport 透传**：透传 + toast 显示概要（"已合并 X 的 N 条改动"+ E7 warning 可展开）
3. **B 方案 changeSeq 不等淡化 toast**：显示淡化 toast `已与对方改动合并，但你的最新编辑会在下次保存合并`
4. **W3 e2e 范围**：3 路径（直接保存 / 真合并自动通过 / 真合并冲突弹窗）

## codex 取舍审 12 隐藏判断点 + 4 拍板复核 — 原始返回

### 4 个用户拍板项 codex 复核结果

- **弹窗三按钮**：同意。反对意见：必须明确"继续编辑草稿"和"取消"的状态差异，否则会把 autosave 卡死
- **mergeReport 透传 + toast 概要**：同意。反对意见：必须走 `SaveResult.merged` **同步返回**，不要用 hook 外置 state/useEffect
- **B 方案 changeSeq 不等淡化 toast**：同意。反对意见：必须只在 deferred 分支显示，且去重
- **W3 三路径 e2e**：同意。反对意见：必须真服务端 + 双 context，不建议 mock

### 高风险（5 条）

#### H1 — 保存草稿后查看最新版必须主动 PUT 草稿（J2）

- **现象**：防抖 5s 内点击"保存草稿并查看最新版本"，最新编辑可能还没进 draft；conflict 后 autosave 又已 disabled
- **推荐方案**：选项 B
- **理由**：项目语境不冲突；5 人内网下多一次 `PUT /api/drafts` 成本极低，但能守住"不丢本地编辑"
- **具体修法建议**：按钮点击时主动 `PUT draft(currentProject)`，成功后再 `discardAndReload`；PUT 失败则不 reload，保留弹窗和 dirty

#### H2 — "继续编辑草稿"必须恢复自动保存（J3）

- **现象**：如果只关弹窗但保留 `conflict` 和 `autoSaveDisabled=true`，用户以为能继续编辑，实际后续 save/autosave 不会正常进入合并
- **推荐方案**：语义 Y
- **理由**：项目语境不冲突；这是继续沿用旧 `baseVersion` 让服务端下轮再合并，不是 OT/CRDT
- **具体修法建议**：关闭弹窗、`setConflict(null)`、`setAutoSaveDisabled(false)`，但**不要**推进 `serverVersionRef`、不要替换 `projectRef`、不要清 dirty、不要删草稿

#### H3 — e2e 必须跑真服务端真合并（J8）

- **现象**：mock `PUT /api/canvases` 只能测弹窗渲染，测不到 Day 3 合并、不变量、draft 删除/保留、409 分支
- **推荐方案**：选项 A
- **理由**：项目已有 P3G 真服务端 Playwright 模式；两个 browser context 模拟 A/B 用户不属于高并发架构
- **具体修法建议**：复用 tmp-test dev server，两个登录 context 操作同一 public canvas，分别覆盖直接保存、自动合并、真冲突弹窗

#### H4 — #34(g) 必须在 hook 层断言状态不变（J9）

- **现象**：只靠 e2e 看最终 UI，无法证明 `serverVersionRef/projectRef/dirty/draft` 在 changeSeq 不等时全部不动
- **推荐方案**：选项 A 的测试落点；g3 用轻量静态 grep/脚本，不做重型 lint 规则
- **理由**：这是 Day 3 核心不变量，必须能精确观察 hook 内状态；开发量也比端到端强行探测 refs 小
- **具体修法建议**：useMultiCanvas 单测覆盖 g1/g2；g3 放 CI grep，检查 merged + changeSeq 不等分支内没有推进 `serverVersionRef` / `setServerVersion` / 替换 `projectRef`

#### H5 — 冲突弹窗期间必须 modal block（J11）

- **现象**：弹窗开着还能切画布、导入或 ESC 误关，会留下 dirty/conflict/autosaveDisabled 的半处理状态
- **推荐方案**：选项 A
- **理由**：项目是桌面端单实例，modal block 成本低；这里要防本地草稿丢失，不是通用协同自由编辑
- **具体修法建议**：弹窗 `aria-modal=true`，不允许 ESC 隐式关闭；CanvasSwitcher/Import/beforeunload 都继续受 `dirty || saving || conflict` 保护

### 中风险（5 条）

#### M1 — merged 结果应直接携带 report（J1）

- **现象**：BFV 需要在 `case 'merged'` 立即显示 toast；用 `lastMergeReport` 或 callback 容易和 canvas 切换、discarded 回包、并发保存错位
- **推荐方案**：选项 A
- **理由**：项目语境不冲突；这只是返回保存结果的同步元数据，不增加协同复杂度
- **具体修法建议**：`SaveResult.merged` 加**必填** `report: MergeReport`，不是 optional；这不会破坏 discriminated union，因为 `status: 'merged'` 仍是唯一 discriminant，只是收紧该分支 payload

#### M2 — E7 warning 需要可展开详情（J5）

- **现象**：只显示"丢弃 K 条悬空边"用户知道有损失，但无法定位自己刚加的哪条边没了
- **推荐方案**：选项 B
- **理由**：E7 不是阻塞冲突，不该弹强 dialog；但 `MergeReport` 注释已写"必须显示给用户"
- **具体修法建议**：toast 概要显示合并计数和 warning 数；展开区列 `sheetId / edgeId / missingEndpoint`，能跳转则跳转，不能跳转也要可复制定位信息

#### M3 — changeSeq 不等 toast 要按连续编辑窗口去重（J6）

- **现象**：5 轮 autosave 都 deferred 时，重复淡化 toast 会干扰编辑
- **推荐方案**：选项 C
- **理由**：5 人内网不需要复杂通知中心；用户只需知道当前连续编辑窗口里发生过延后合并
- **具体修法建议**：同一 dirty/editing session 只提示第一次；在一次正常 saved/merged-applied、reload、切画布后重置该去重标记

#### M4 — base_version_expired 不要混成普通 conflict（J7）

- **现象**：base 版本过期无法合并，如果复用 4B 并保留"继续编辑草稿"，用户会陷入反复 409
- **推荐方案**：选项 A
- **理由**：项目语境不冲突；独立小弹窗比 alert 更一致，但语义必须和 conflict 分开
- **具体修法建议**：做 `BaseVersionExpiredDialog`，主按钮同样先 PUT draft 再 reload；"留在草稿"可以关闭弹窗但不要恢复 autosave

#### M5 — 弹窗和 toast 用 portal，不要卸载 React Flow（J12）

- **现象**：直接挂在 BFV 子树可能遇到 z-index/transform/input 捕获问题；卸载 React Flow 又会造成大画布重建成本
- **推荐方案**：选项 A
- **理由**：Chrome/Firefox/Edge 100+ 全支持 portal；这不引入依赖，也符合 1000+ 节点画布约束
- **具体修法建议**：portal 到 `document.body`，少动画、不要 backdrop-filter；50 条 conflicts 用 max-height + scroll 即可，超过几百条再考虑 virtualization

### 低风险（2 条）

#### L1 — toast 自建即可（J4）

- **现象**：项目没有 toast 基建；引入库会增加依赖面，Notification API 还需要权限且脱离应用上下文
- **推荐方案**：选项 A
- **理由**：5 人内网 + 桌面端 only 下，自建轻量 toast 最合适
- **具体修法建议**：参考 DraftRecoveryDialog 的 CSS 风格做 `ToastHost/ToastItem`，支持 info/warning、替换/去重、可展开详情即可

#### L2 — conflicts undefined 仍走新弹窗（J10）

- **现象**：理论上 Day 3 后 conflict 都有 conflicts，但防御场景下旧 alert 会让 4B 流程倒退
- **推荐方案**：选项 B
- **理由**：项目语境不冲突；这是 UI fallback，不改变服务端契约
- **具体修法建议**：保留三按钮，详情区显示"服务端未返回冲突明细，建议先保存草稿后查看最新版"

### codex 主动挖出的隐藏判断点（X1-X3）

#### X1 — merged 还需要暴露"是否已应用到本地"

- **理由**：BFV 只知道 `status: 'merged'` 不够区分默认 applied 路径和 changeSeq 不等 deferred 路径，无法稳定显示两种 toast 文案
- **具体修法建议**：在 `SaveResult.merged` 增加 `appliedToLocal: boolean` 或 `deferredLocalEdits: boolean`；不要让 BFV 读异步 `dirty` 来猜

#### X2 — "取消"必须有可恢复入口

- **理由**：如果取消后关闭弹窗但保留 `conflict` + `autoSaveDisabled=true`，用户需要能再次打开处理入口，否则状态被静默卡住
- **具体修法建议**：取消要么不关闭 modal，要么关闭后显示顶栏/状态条"冲突待处理"并允许重新打开弹窗

#### X3 — draft PUT/reload 按钮需要防重复点击

- **理由**：保存草稿、reload、DELETE/PUT 这些路径已有竞态历史；双击主按钮会放大边界问题
- **具体修法建议**：弹窗 action 进入 pending 后禁用全部按钮，只允许一次 PUT draft + reload 完成或失败回退

### 整体判定

**canEnterImpl: true / confidence: high**

## Claude 拍板记录（用户对每条 codex 意见的回复）

按 CLAUDE.md「协作三件套」第 3 步「独立推荐 → 用户拍板」，用户对 15 项 codex 意见 + 4 拍板复核全部**采纳推荐结论**。详见 [02-拍板记录.md](02-拍板记录.md)。

| 风险级 | # | 主题 | 用户拍板 |
|---|---|---|---|
| high | H1 | 保存草稿主动 PUT | ✅ 采纳选项 B |
| high | H2 | 继续编辑恢复 autosave | ✅ 采纳语义 Y |
| high | H3 | e2e 真服务端 | ✅ 采纳选项 A |
| high | H4 | #34(g) 单测 + CI grep | ✅ 采纳选项 A |
| high | H5 | 弹窗 modal block | ✅ 采纳选项 A（ESC 不隐式关闭）|
| medium | M1 | report 必填 | ✅ 采纳必填 |
| medium | M2 | E7 可展开详情 | ✅ 采纳选项 B |
| medium | M3 | toast session 内只一次 | ✅ 采纳选项 C |
| medium | M4 | base_version_expired 独立弹窗 | ✅ 采纳选项 A |
| medium | M5 | React Portal | ✅ 采纳选项 A |
| low | L1 | toast 自建 | ✅ 采纳选项 A |
| low | L2 | conflicts undefined fallback | ✅ 采纳选项 B |
| 主动 | X1 | appliedToLocal 字段 | ✅ 采纳 |
| 主动 | X2 | 取消顶栏提示 + 可重开 | ✅ 采纳 |
| 主动 | X3 | pending 中 disable 全按钮 | ✅ 采纳 |

## 与 Day 1/2/3 取舍审的衔接

- Day 1 取舍审：[Day1-基建/01-取舍审查.md](../Day1-基建/01-取舍审查.md)（11 项决策锁定）
- Day 2 取舍审：[Day2-合并算法/](../Day2-合并算法/)（11 项判断点 + 4 风险吸收）
- Day 3 取舍审：[Day3-客户端/01-取舍审-客户端接合并响应+conflict_logs.md](../Day3-客户端/01-取舍审-客户端接合并响应+conflict_logs.md)（10 项判断点 + 3 风险）
- **Day 4 取舍审**（本文档）：12 项隐藏判断 + 4 拍板复核 + 3 主动挖（共 19 项），全部采纳；canEnterImpl: true / confidence: high

## codex 协作模式实战记录

- **prompt 体量**：45KB（比 Day 2 v2 的 115KB 小，因关键代码段用 sed 精确截取）
- **stdin 注入**：必须，避开 Windows sandbox 1326 + ARG_MAX 32KB 双坑
- **同步阻塞**：用户选择同步阻塞跑（不后台 + 不 ScheduleWakeup）
- **codex 输出**：5 high + 5 medium + 2 low + 3 主动 = 15 条意见，confidence=high 通过
