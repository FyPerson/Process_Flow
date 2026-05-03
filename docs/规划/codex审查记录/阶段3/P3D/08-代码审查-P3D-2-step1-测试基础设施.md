**总结**
这次改动本身不改业务逻辑，运行时风险低；测试框架选择也合理。需要补强的是 removed 集成测试：当前还没真正锁住“private owner 可删除任意节点”的 v5 核心语义，后续 mutation gate 可能出现假绿。补 2-3 个低成本用例后，可以作为 P3D-2 后续步骤地基。

**必修项**

1. [server/services/canvases.removed.test.ts](<E:/业务全景图/server/services/canvases.removed.test.ts:90>) 的 `seedCanvas()` 把 `createdBy` 同时用于 canvas 创建者和 `nodes_meta.creator_id`；第 3 分支又用 `seedCanvas('private', OWNER.id, OWNER.id)`。
   这导致 “private owner 删除成功” 实际测的是 “owner 也是 node creator”。如果未来实现回退成“creator 能删”，这个测试仍会通过，没锁住 [server/services/canvases.ts](<E:/业务全景图/server/services/canvases.ts:681>) 的 `isPrivateOwner` 规则。建议把 helper 拆成 `canvasCreatedBy` / `nodeCreatedBy`，至少让 private owner 删除一个非自己创建的节点。

2. 同理，第 4 分支建议补一个 “private + 非 owner 普通用户 + 该用户是 node creator → 403”。现在 STRANGER 既不是 owner 也不是 creator，只覆盖了最弱的拒绝场景。

**建议项**

- [server/services/canvases.ts](<E:/业务全景图/server/services/canvases.ts:853>) 明确删除 `annotations + nodes_meta`，但测试只在 [server/services/canvases.removed.test.ts](<E:/业务全景图/server/services/canvases.removed.test.ts:292>) 断言 `nodes_meta`。建议在同一个边界测试里插一条 annotation，并断言删除后 annotation count 为 0。

- 建议补 1-2 个混合 delta：`removed + modified`、`removed + deprecated_changed`。真实保存 payload 很可能混合操作；测试应断言 forbidden_remove_node 时版本不增加、其他改动也没有落库。

- `setDbForTesting()` 当前只靠注释约束，短期可接受，且 `rg` 只看到测试引用。但如果要加 runtime 防御，不要只改函数：当前 [package.json](<E:/业务全景图/package.json:15>) 没设置 `NODE_ENV=test`。推荐同时改成 `cross-env NODE_ENV=test node --import tsx --test ...`，再让 [server/db/index.ts](<E:/业务全景图/server/db/index.ts:143>) 在非 test 时拒绝；或者更宽松地只在 `NODE_ENV === 'production'` 时拒绝。

**逐项判断**

- `node --test + tsx`：适合当前阶段。已依赖 `tsx`，没有必要为了纯函数和少量 service 集成测试引 Vitest。Vitest 的优势主要是 watch、mock、coverage、jsdom/React 测试 ergonomics，后面做 React 交互测试时再引不迟。

- `canEditNodeData`：6 分支覆盖完整；`admin + canvasWritable=false` 已在第 2 分支覆盖，不必单独拆，除非为了可读性。

- DB 每个 it 跑 migration：当前规模完全可以接受，且能尽早发现 schema drift。

- 覆盖率脚本：不是 step 1 必需。后续接 CI 时可加 `test:coverage`，但 mutation gate 更应依赖这些行为测试，而不是覆盖率数字。

- 测试文件 co-located：可以。等测试继续增加时，在 README/SKILL 里写一句约定即可。

**验证**
`git diff --check HEAD` 通过。`npm test` 和等价 `node --import tsx --test ...` 在本会话被执行策略拦截，未能实际运行。