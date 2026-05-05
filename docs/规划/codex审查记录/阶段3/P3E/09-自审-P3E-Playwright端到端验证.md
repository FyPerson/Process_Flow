# P3E — Playwright 端到端验证（自审归档）

> **决策**：P3E 引入 `tmp-test/` Playwright 端到端测脚本作为发版前必跑步骤；不引 RTL 基建。
> **理由**：
> - 内部项目 / 最多 5 人并发 / < 100 用户：RTL + jsdom 一次性基建成本不划算（沿用 P3D-2 step 9 4 条触发判定）
> - 但本次部署 v1.7.0 后 codex 6 轮审查 + 156 单测 + 部署成功仍漏了浏览器 bug（节点徽章 unresolved 计数永远显示 0），证明发版前必须有真浏览器交互验证
> - tmp-test/ Playwright 一次性脚本：不引基建、随用随写、已 gitignore 不入仓库
>
> **本归档作用**：
> 1. 持久化 P3E 端到端验证 8 场景的覆盖范围（脚本本身不入仓库，证据靠本文件）
> 2. 记录 Playwright 抓出的 useNodesState 锁状态 bug + 修法（commit `2be81f4`）
> 3. 留下用户回来后须人工验证的 6 项清单（Playwright 不易覆盖的交互场景）

---

## 触发缘由

本次 P3E 实施完整闭环了 codex 7 轮审查链（02 P3E-1 一审 / 03 P3E-2 一审 / 04 二审 / 05 三审 / 06 P3E-3 取舍审 / 07 P3E-3 一审 / 08 P3E-3 二审），单测从 120 项扩到 156 项（+ 26 service / + 10 路由），部署 v1.7.0 自动验证 5/5 全过。

**但浏览器实测**：节点徽章 unresolved 计数永远显示 0。

**诊断链路**：
- `bundle.getAnnotationsForNode` 派生 → 1 条
- `processedNodes` 注入 `data.__annotationUnresolvedCount` → 0 条
- 同一 hook 派生在不同消费路径结果不同 → 中间有状态截断

**根因**：`FlowCanvas` 用 `useNodesState(initialNodes)` 锁内部 state；外部 `BFV` 重算 `processedNodes` 注入的 data 字段不响应。

**修法**（commit `2be81f4`）：CustomNode/GroupNode 改通过 `AnnotationBadgeContext` 直接读 hook 派生（响应式）；BFV 不再注入 `__annotationUnresolvedCount` 到 data；types/flow.ts 删除字段。

**元教训**：codex 多轮审查 + 单测全过 + 部署成功 ≠ 真实功能可用；状态机锁定问题只有真浏览器交互能暴露。

---

## 测试结果总览

- **脚本路径**：`tmp-test/test-p3e-annotations.py`（已 gitignore；不入仓库，归档说明见本文件）
- **场景数**：8 主场景
- **断言数**：18 项
- **通过**：17/18
- **未通过 1 项**：场景 1.2 测试 selector 缺陷（产品功能正常，测试代码 bug）
  - 现象：`.detail-panel.visible` selector 偶尔抓不到（CSS class 拼接 + 渲染时机），但实际 panel 已打开
  - 修法（已固化）：`is_panel_open` 加 `.panel-content` fallback
    ```python
    def is_panel_open(page: Page) -> bool:
        if page.locator(".detail-panel.visible").first.count() > 0:
            return True
        return page.locator(".panel-content").first.is_visible()
    ```
  - 普适教训：测试**误报 FAIL** 也是测试代码缺陷，需要修测试不是修产品

---

## 8 场景覆盖范围

| # | 场景 | 覆盖断言 |
|---|---|---|
| 1 | 选中节点 → 详情面板打开 + tab 默认"详情" | 1.1 选中 / 1.2 panel 打开 / 1.3 默认 tab |
| 2 | 切换到"批注" tab → 列表/表单可见 | 2.1 tab 切换 / 2.2 表单可见 |
| 3 | 创建批注 → 列表新增 + 徽章 +1 | 3.1 创建成功 / 3.2 列表项 / 3.3 徽章计数 |
| 4 | resolve 批注 → 列表标已解决 + 徽章 -1 | 4.1 状态变更 / 4.2 徽章计数 |
| 5 | reopen 批注 → 列表标未解决 + 徽章 +1 | 5.1 状态变更 / 5.2 徽章计数 |
| 6 | 切换 sheet → 旧 sheet 批注不串到新 sheet | 6.1 sheet 切换 / 6.2 列表清空 |
| 7 | 单节点容量上限 100 条 → POST 第 101 条返回 409 | 7.1 capacity_exceeded |
| 8 | admin 关闭他人创建的批注 → 成功（其他用户对他人批注 resolve 按钮隐藏） | 8.1 admin resolve 通过 |

**模式**：API helper 创建测试 canvas → Playwright 走 UI 操作 → 末尾自动 cleanup（DELETE → archive）。

---

## 用户回来后须人工浏览器验证 6 项

Playwright 脚本不易覆盖（视觉判断 / 网络模拟 / 多账号切换），改为人工 checklist：

### 1. 长批注折叠（双条件兜底）
- **断言**：批注内容 > 6 行 或 > 200 字符 → 列表项显示折叠摘要 + "展开"按钮；展开后显示完整内容
- **测法**：批注 tab → 创建一条 7 行短文本（验行数条件） + 创建一条 1 行 250 字（验字符条件）
- **关联**：codex 07 medium 3 — getCollapsedContent 双条件折叠 helper

### 2. 网络错误 inline 提示
- **断言**：fetch annotations 失败时（断网 / 服务端 500）→ 列表区显示 inline 错误条；不显示关闭按钮（fetchError 场景持续可见）
- **测法**：DevTools → Network → 设置 offline → 切换到批注 tab → 列表显示错误条；恢复网络后下次切换正常
- **关联**：codex 07 medium 4 — ErrorBanner dismissible（fetchError 不带 onDismiss）

### 3. 游客身份隐藏 resolve 按钮
- **断言**：未登录访问公开画布 → 批注 tab 列表项不显示 resolve / reopen 按钮 + 不显示创建表单
- **测法**：开无痕窗 → 访问任意公开画布 → 批注 tab → 检查所有列表项

### 4. 普通用户对他人批注隐藏 resolve 按钮
- **断言**：普通用户登录（非 admin / 非节点 creator / 非批注作者）→ 他人创建的批注 resolve 按钮隐藏
- **测法**：用户 A 登录创建批注 → 退出 → 用户 B 登录（普通用户，非 A）→ 批注 tab → 看 A 的批注无 resolve 按钮
- **关联**：canCloseAnnotation 三方判定（作者 / 节点 creator / admin）

### 5. 面板关闭后点徽章能重新打开 + 切到批注 tab
- **断言**：选中节点开面板 → 点关闭按钮 → 节点选中状态保留 + 面板关 → 再点节点徽章 → 面板打开 + tab 自动跳到"批注"
- **测法**：选 A → 关面板 → 点 A 徽章
- **关联**：FlowCanvas onAnnotationBadgeClick + bundle.requestPanelTab('annotations')

### 6. 已选中 A 切到 B 时徽章计数刷新
- **断言**：选中 A 时 A 徽章计数正确 → 切选 B 时 B 徽章计数正确（不串到 A 的计数）
- **测法**：A 上加 2 条未解决 → B 上加 1 条 → 来回切换看徽章数字
- **关联**：徽章 React Context 读 unresolvedCount + activeSheetId（commit 2be81f4 修法验证）

---

## 反复出现标记 + 长期偏好升级

### React Flow useNodesState/useEdgesState 锁外部 props（⚠️ 反复 2 次）

- 0430 P3C 边视觉派生：edge.data 派生污染 storage（同根因不同表现）
- 0505 P3E-3 节点徽章计数：useNodesState 锁内部 state（本次）
- **已升级**：`~/.claude/projects/e-------/memory/feedback_react_flow_state_lock.md`
  - 三条修法路径：A data 注入（仅静态字段）/ B useStore + nodeLookup / C React Context（本次采用）
  - MEMORY.md "工程基建"段加索引行

### 发版前必跑端到端 Playwright 测核心路径（⚠️ 反复 3 次）

- 0429 P2J：手动用例 3/20 残留
- 0505 P3D-2 step 9：RTL 降级判断时埋下"端到端 bug 1 天内可修"前提
- 0505 P3E-3：本次抓出 useNodesState 锁状态 bug
- **已升级**：`~/.claude/projects/e-------/memory/feedback_e2e_before_release.md`
  - 触发条件 + 不需要跑的场景 + tmp-test/ 一次性脚本模式
  - MEMORY.md 新增"发版纪律"段
  - 与"RTL 降级"决策不冲突——一次性脚本不引基建

---

## tmp-test/ Playwright 一次性脚本模式（项目惯例）

本次确立的工程惯例（沿用 P2J 起的 tmp-test/ 习惯）：

1. **路径**：`tmp-test/test-<阶段>-<功能>.py`，已在 .gitignore 中，不入仓库
2. **依赖**：仅 Playwright + Python 标准库；不引 RTL / vitest / jsdom
3. **结构**：
   - 顶部：API helper（登录 / 创建测试 canvas / 拿到节点 ID）
   - 中部：Playwright 走 UI 断言（headless 或 headed 都可）
   - 底部：自动 cleanup（DELETE → archive 测试 canvas）
4. **触发条件**（feedback_e2e_before_release.md 已固化）：
   - 改 React Flow 派生
   - 改跨组件通信（Context / props 注入）
   - 改 hook 联动（多个 hook 状态机交互）
5. **不必跑的场景**：纯数据层 helper / 纯 service / 不影响 UI 的 schema/类型改动
6. **归档方式**：脚本本身不入仓库；本类自审归档文档（如本文件）作为证据留底

---

## 关联归档

- 本阶段 codex 审查链：[01](./01-取舍审查-P3E-批注-5取舍.md) / [02](./02-代码审查-P3E-1-服务端API.md) / [03](./03-代码审查-P3E-2-前端hook.md) / [04](./04-二审-P3E-2-前端hook.md) / [05](./05-三审-P3E-2-前端hook.md) / [06](./06-取舍审查-P3E-3-UI-5取舍.md) / [07](./07-代码审查-P3E-3-UI.md) / [08](./08-二审-P3E-3-UI.md)
- 同模式归档：[阶段3/P3D/29-自审-P3D-2-step9-RTL占位清单降级.md](../P3D/29-自审-P3D-2-step9-RTL占位清单降级.md)
- 修法 commit：`2be81f4` fix(annotation): P3E-3 徽章 unresolved 计数响应式从 Context 读
