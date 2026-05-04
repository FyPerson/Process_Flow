**第一层：非技术总结**

**还不能进 step 4。** 三审找到 1 个严重漏洞——我把"替换节点"的权限判定写错了：用"替换后的新数据"判权限。攻击者可以构造一个 `replace` 把节点的 `creator_id` 改成自己、或加上"本地新建"标记，从而绕过权限把别人的节点改了。

正确做法是：改别人节点（replace）时，必须看**原节点**的 creator_id，不能信新 payload。

**第二层：技术细节（codex 原话）**

**Critical：replace 信任 item.data 可被伪造**

[canEditNode.ts](E:/业务全景图/src/auth/canEditNode.ts) `filterNodeChangesByPermission`：`add` 和 `replace` 都优先使用 `change.item.data` 判权。对 `replace` 来说，`item.data` 是替换后的节点数据，可能已经被本次 mutation 改成 `{ creator_id: 当前用户 }` 或 `{ __localNew: true }`，从而绕过对原节点归属的判断。`replace` 应按当前 `nodes` 中的目标节点数据判权，不能信任新 payload。

**修法**：拆分 `add` 与 `replace` 路径——`add` 使用 `change.item.data`，且要求普通用户必须 `__localNew === true`；`replace` 必须先用 `change.id` 在当前 `nodes` 中找到原节点，并用原 `target.data` 调 `canEditNodeData`。找不到目标时 fail-closed。

**High 1：add 凭 creator_id 也会放行**

`add` 当前只要 `item.data.creator_id === user.id` 也会放行。若前端新增节点的 `creator_id` 可由导入、粘贴、外部事件或错误调用携带，普通用户可以构造带自己 `creator_id` 的持久化形态节点绕过"本地新增必须由客户端流程产生"的约束。虽然服务端应兜底，但前端 mutation gate 的语义会变松。

**修法**：对 `change.type === 'add'` 单独收紧——普通用户仅允许 `item.data.__localNew === true`；admin 可放行；游客或 `!canvasWritable` 拒绝。

**High 2：FlowCanvas handleDelete 漏 __canEdit**

[FlowCanvas/index.tsx](E:/业务全景图/src/components/FlowCanvas/index.tsx) `handleDelete`：侧边栏删除和 Backspace 删除仅检查 `readOnly`，随后把所有选中节点传给 `deleteElements`。如果 React Flow 的 `deleteElements` 触发的是 `remove` change，理论上会被 `wrappedOnNodesChange` 过滤；但确认弹窗、关闭面板等副作用已经发生，且是否完全依赖受控 `onNodesChange` 兜底需要 `useFlowHandlers.ts` 才能确认。这里没有显式过滤 selectedNodes 的 `__canEdit`，和"节点级删除入口禁用"目标不完全闭环。

**修法**：在 `handleDelete` 中先按 `canEditNodeData` 或 `data.__canEdit !== false` 过滤 selectedNodes；若存在不可删节点，应 all-or-nothing 拒绝或只对可删集合确认。

**Medium（保留不修）**

- CustomNode resize / FlowCanvas label：`__canEdit === undefined` 默认放行（兼容旧节点）。**Claude 判断保留**：BFV 已为所有节点稳定派生 __canEdit，且服务端 §5.7 + filterNodeChangesByPermission 已是 fail-closed 兜底；改成 `__canEdit !== true` 会破坏旧节点兼容。
- useNodeAlignment：codex 没读到该文件就提出，**误报**——闭包内已有二次校验。

**Low（与本任务无关）**

- GroupNode handleCollapseToggle 死代码 `childIds`。

**修复结果（commit 待提交）**

| 修复 | 位置 | 状态 |
|---|---|---|
| Critical replace 改用原节点 data 判权 | [canEditNode.ts](E:/业务全景图/src/auth/canEditNode.ts) `filterNodeChangesByPermission` | ✅ |
| High add 收紧到普通用户必须 __localNew=true | 同上 | ✅ |
| High handleDelete __canEdit all-or-nothing 早退 | [FlowCanvas/index.tsx](E:/业务全景图/src/components/FlowCanvas/index.tsx) `handleDelete` | ✅ |
| 单测：4 个伪造测试（forge replace creator_id / forge replace __localNew / forge add creator_id / admin add 任意） | [canEditNode.test.ts](E:/业务全景图/src/auth/canEditNode.test.ts) | ✅ 29/29 全过 |

tsc 干净；lint 77 problems（与改前一致，全预存在）；npm test 43/43 全过。

**结论**

进入四审。
