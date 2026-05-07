# 10-阶段 C 取舍审 — saveCanvas 接合并算法 11 个判断点

## 元信息

- **审查日期**：2026-05-07（追加段）
- **审查范围**：阶段 5 Day 2 阶段 C（saveCanvas 分支 2 接 tryMerge + 写主表/canvas_versions/nodes_meta/annotations 同事务）
- **codex 模式**：stdin 注入 / 185KB / MaxContextChars=240000 / 实读 8 文件（canvases.ts / canvases-merge-helpers.ts / merge/types.ts / merge/computeDelta.ts / merge/applyDelta.ts / merge/detector.ts / merge/tryMerge.ts / routes/canvases.ts / schemas/canvas.ts）
- **codex 版本**：codex-cli 0.128.0 / Windows sandbox 1326 + ARG_MAX 32KB 双坑根治写法
- **判定结论**：`canEnterImpl: true`（confidence=high；2 项推荐被戳穿要修订；1 high 风险必须吸收）
- **codex 自我盲区声明**：实读全部 8 文件 + 拍板记录已嵌入 prompt；无遗漏
- **基于 codex 协作模式**："翻译报告（不下结论），分 severity 排列，不替用户做采纳/不采纳"

## Claude 拍板记录

### 11 项判断点逐条拍板

| ID | Claude 初版推荐 | codex 推荐 | Claude 最终拍板 | 处置 |
|---|---|---|---|---|
| **1** 三方数据预处理 | X 不预 strip | X | **X** | ✅ 采纳 — computeDelta 白名单已排除归属字段，预 strip 反而引入差异源 |
| **2** DetectContext.userA 来源 | X canvases.updated_by | **Y canvas_versions.saved_by** | **Y** | ❌ 改用 canvas_versions.saved_by — codex 戳穿：patchCanvasMeta/publish/archive 会改主表 updated_by 但不写 version，会误指向最后改元信息的人 |
| **3** mergedFromUsername 取法 | B1 JOIN canvases.users | **JOIN canvas_versions.saved_by + users** | **改为 JOIN canvas_versions** | ❌ 同 #2 —— 一条 SELECT cv LEFT JOIN users ON u.id=cv.saved_by WHERE cv.canvas_id=? AND cv.version=? |
| **4** 合并路径 incomingData | (待拍) | Y 复用 incomingProject | **Y** | ✅ 采纳 — 快速路径已构造 incomingProject，合并/快速共用一份；少一次适配 |
| **5** DataIntegrityError catch 边界 | (待拍) | X tx 内不吞 | **X** | ✅ 采纳 — 与快速路径一致，tx 内不 catch，让事务回滚后透传给 route 层映射 500 + data_integrity_error |
| **6** conflicts 路径 SaveCanvasResult 形状 | (待拍) | X 复用 'conflict' | **X** | ✅ 采纳 — route 层已就位（line 262-291），最少改动；填 conflicts 数组 |
| **7** debugDelta 是否带 | (待拍) | X 阶段 C 不带 | **X** | ✅ 采纳 — `includeDebugDelta:false`；Day 3 conflict_logs 实施时改 true，含 Map 结构需专门序列化 |
| **8** updated_by null 兜底（→ saved_by null 兜底） | (待拍) | X fallback user.id | **X 但语义改** | ✅ 采纳并更新：canvas_versions.saved_by 是 NOT NULL（migration 0001 锁），实际不会 null；当前版本快照 SELECT 不到时（极端 DB 损坏）按 DataIntegrityError 走 500，不再 fallback |
| **9** mergedData 写主表前是否再跑 assertProjectIntegrity | (待拍) | X 信任 applyDelta | **X** | ✅ 采纳 — applyDelta step 7 已复跑 |
| **10** 合并路径是否走 rewriteNodesFromMeta | (待拍) | X 跑 rewrite(mergedData, deltaB, ...) | **X** | ✅ 采纳 — 与快速路径一致，B 的 deltaB 驱动归属写入 |
| **11** 合并路径写 canvas_versions.saved_by | (待拍) | X = user.id（B） | **X** | ✅ 采纳 — 触发保存的人是 B；A 单独记 mergeReport.mergedFromUserId |

### codex 揪出的 2 项错误推荐

#### 错误 1（判断点 2）—— canvases.updated_by 不等于当前 data version 保存者

**codex 原文**：
> canvases.updated_by 不等价于当前 data version 的保存者；patchCanvasMeta/archiveCanvas/publish/unpublish 都会更新它但不写 canvas_versions。

**Claude 复核**：codex 对。已读 canvases.ts:695-731 patchCanvasMeta + 782-818 publishCanvas + archiveCanvas + unpublishCanvas，确认这 4 个 UPDATE 主表 updated_by 但不 INSERT canvas_versions。如果 A 上次保存后被 admin 改了 name，B 触发合并时"对方"会被误指向 admin。

**修订方案**：合并路径独立 `SELECT cv.saved_by FROM canvas_versions cv WHERE cv.canvas_id=? AND cv.version=row.version`。

#### 错误 2（判断点 3）—— mergedFromUsername JOIN 锚点错误

**codex 原文**：
> 同 #2，mergedFromUsername 若 JOIN canvases.updated_by 会在元信息更新后误指向最后改元信息的人。建议 JOIN canvas_versions.saved_by + users。

**修订方案**：与 #2 合并为一条 SELECT：
```sql
SELECT cv.saved_by, u.username
FROM canvas_versions cv
LEFT JOIN users u ON u.id = cv.saved_by
WHERE cv.canvas_id = ? AND cv.version = ?
```

### 4 项风险吸收

| 等级 | 风险 | 处置 |
|---|---|---|
| **high** | deltaB 未暴露导致副作用可能漂移 | ✅ saveCanvas 合并路径**自己再 computeDelta(baseData, incomingData) 一次**拿独立 deltaB 给 helper 用；tryMerge 内部仍计算自己的 deltaB（不外传）。代价：computeDelta 跑两次（saveCanvas + tryMerge 内部各一），5 人内网项目可接受 |
| medium | canvases.updated_by 误报合并来源 | ✅ 同判断点 2/3 修订（改 JOIN canvas_versions） |
| medium | 权限与冲突返回优先级 | ✅ 实施流程锁定顺序：computeDelta → validateDeltaBPermissions → tryMerge → rewrite → UPDATE → INSERT → syncMeta；403 越权先于 409 冲突返回 |
| low | E7 dropped edge 计数 toast 偏乐观 | ✅ 阶段 C 不改，记入 Day 3-4 客户端实施时 toast 文案需明确"已合并 X 条边 + 丢弃 Y 条悬空边" |

### 10 项隐藏判断点

全部采纳（与上面的实施流程锁定一致）：

1. ✅ 合并分支全程在同一 `tx.immediate()` 内
2. ✅ deltaB 来源定死 — saveCanvas 持有，tryMerge 内部不外传
3. ✅ 权限校验优先级 — computeDelta + validateDeltaBPermissions 先于 tryMerge
4. ✅ currentVersion saved_by/username 一条 SELECT JOIN
5. ✅ merged=true 返回客户端的 mergedData 必须是 rewriteNodesFromMeta 后版本
6. ✅ metaIndex 读取在权限校验后、rewrite 前、同事务内（与快速路径同款时机）
7. ✅ active_sheet_missing 由 applyDelta 产 conflicts，saveCanvas 透传 error='conflict' + conflicts
8. ✅ syncNodesMetaFromDeltaB 在合并成功路径复用
9. ✅ E7 warnings 只进 mergeReport；阶段 C 不写 conflict_logs，也不在冲突路径携带 warnings
10. ✅ debugDelta 含 Map，不直接 JSON 返回或落库；阶段 C 不开

---

## 阶段 C 实施流程（吸收 codex 后定稿）

```
saveCanvas 分支 2（baseVersion < currentVersion）：
  1. SELECT canvases (含 row.version, row.data, row.visibility, row.owner_id)  ← 已存在
  2. SELECT canvas_versions WHERE version=baseVersion → baseData
       (404 → return base_version_expired)                                       ← 已存在
  3. NEW: SELECT cv.saved_by, u.username
            FROM canvas_versions cv LEFT JOIN users u ON u.id=cv.saved_by
            WHERE cv.canvas_id=? AND cv.version=row.version
          → currentVersionAuthor = { userId, username }
          (查不到则按 DataIntegrityError 抛 — canvas_versions.saved_by NOT NULL)
  4. baseProject = asProjectShape(JSON.parse(baseSnapshot.data))
     currentProject = asProjectShape(JSON.parse(row.data))
     incomingProject = asProjectShape(data)  ← 与快速路径共用一份
  5. deltaB = computeDelta(baseProject, incomingProject)  ← saveCanvas 独立持有（高风险吸收）
  6. validateDeltaBPermissions(db, id, deltaB, user, visibility, owner_id)
     ← 先权限（403/409 节点级先于 409 合并冲突；medium 风险吸收）
  7. mergeResult = tryMerge({
       baseData: baseProject,
       currentData: currentProject,
       incomingData: incomingProject,
       ctx: { userA: currentVersionAuthor.userId, userB: user.id, visibility },
       currentVersion: row.version,
       mergedFromUserId: currentVersionAuthor.userId,
       mergedFromUsername: currentVersionAuthor.username,
       includeDebugDelta: false,
     })
  8. !mergeResult.ok →
       return { ok:false, status:409, error:'conflict',
                currentVersion: row.version,
                conflicts: mergeResult.conflicts }
  9. mergeResult.ok →
       metaIndex = SELECT nodes_meta WHERE canvas_id=?
                   (与快速路径同款；权限校验后、rewrite 前)
       rewrittenData = rewriteNodesFromMeta(mergeResult.mergedData, deltaB,
                                             metaIndex, user, now)
       dataJson = JSON.stringify(rewrittenData)
       newVersion = row.version + 1
       UPDATE canvases SET data, version, updated_by, updated_at WHERE id=?
       INSERT canvas_versions (canvas_id, version, data, saved_by=user.id, saved_at=now)
       syncNodesMetaFromDeltaB(db, id, deltaB, user, now)
       return { ok:true, version:newVersion, merged:true,
                mergedData: rewrittenData,
                mergedFromVersion: row.version,
                report: mergeResult.report }
 10. DataIntegrityError 不 catch（透传，route 层 catch 映射 500 + 'data_integrity_error'）
```

## 阶段 C 验收清单（必修）

继承 B-4 复审 H1 + 本次取舍审 4 项风险：

1. **DataIntegrityError 端到端映射验证**：
   - 历史脏 currentData → tryMerge 内 computeDelta 抛 → tx 回滚 → route 层映射 500 + data_integrity_error（不退化为 save_failed）
   - 测试构造：直接写脏 canvases.data（如 duplicate node id），baseVersion=row.version-1 触发合并路径
2. **三种合并结果端到端**：
   - 真合并成功（A 改不同字段 + B 改不同字段）→ ok:true / merged:true / mergedData 持久化与 select 一致
   - 真冲突（A B 改同节点同字段）→ ok:false / status:409 / error:'conflict' / conflicts 数组非空
   - active_sheet_missing 透传（A 删 sheet1 + B activeSheetId=sheet1）→ ok:false / status:409 / error:'conflict' / conflicts 含 active_sheet_missing
3. **权限优先级**：B 越权改别人节点（content）+ B 也改自己节点（产真合并）→ 必须返 403 forbidden_modify_others_node 而非 409 conflict
4. **mergedFromUserId/Username 取自 canvas_versions 不是 canvases**：用例 — A 保存 v=2 后 admin 改 name（updated_by=admin）→ B 触发合并 → mergedFromUserId 必须是 A 不是 admin

## 与既往判断的衔接

- **D5 helper 提取**（Day 2 取舍审 v2 阶段 A 已落地）：合并路径 step 9 的 rewrite + sync 完全复用 `canvases-merge-helpers.ts` 三 helper，与快速路径同款代码路径，符合 D5 决策"避免两套副作用永久漂移"
- **B-4 H1 复审**（09-阶段B-4-代码审查-tryMerge.md）：阶段 C 验收清单 #1 兑现 codex L1' 登记的"DataIntegrityError 测试覆盖"
- **B-2.5 M2 + B-3**（07/08 归档）：active_sheet_missing 由 applyDelta 产 conflicts，本流程 step 8 直接透传符合分层职责

## codex 原始报告

完整 JSON 报告（实读 confidence=high）：

```json
{
  "decisions": [
    { "id": 1, "recommend": "X", "reason": "不预 strip；computeDelta 白名单排除归属字段，is_deprecated 仍需保留。", "claude_recommendation_correct": true },
    { "id": 2, "recommend": "Y", "reason": "用 canvas_versions.saved_by；canvases.updated_by 会被 PATCH/发布/归档改脏。", "claude_recommendation_correct": false },
    { "id": 3, "recommend": "Z", "reason": "username 必须随 canvas_versions.saved_by 取，不应 JOIN canvases.updated_by。", "claude_recommendation_correct": false },
    { "id": 4, "recommend": "Y", "reason": "复用 incomingProject，少一次适配且保留 is_deprecated 信号。", "claude_recommendation_correct": true },
    { "id": 5, "recommend": "X", "reason": "tx 内不吞 DataIntegrityError；抛出后事务回滚，route 统一映射 500。", "claude_recommendation_correct": true },
    { "id": 6, "recommend": "X", "reason": "复用 conflict 并带 conflicts;route 已支持，避免阶段 C 扩错误码。", "claude_recommendation_correct": true },
    { "id": 7, "recommend": "X", "reason": "阶段 C 不外带 debugDelta；Map 结构等 Day 3 日志序列化时再处理。", "claude_recommendation_correct": true },
    { "id": 8, "recommend": "X", "reason": "ctx.userA 可 fallback user.id；但 report 的 mergedFromUserId 应保留 null。", "claude_recommendation_correct": true },
    { "id": 9, "recommend": "X", "reason": "applyDelta 已复跑完整性；rewrite 只改归属字段，不再重复扫描。", "claude_recommendation_correct": true },
    { "id": 10, "recommend": "X", "reason": "必须 rewrite mergedData；B 的 deltaB 驱动 updated/deprecated 归属写入。", "claude_recommendation_correct": true },
    { "id": 11, "recommend": "X", "reason": "版本是 B 触发保存；A 放 mergeReport.mergedFromUserId 即可。", "claude_recommendation_correct": true }
  ],
  "wrong_recommendations": [
    {
      "id": 2,
      "why": "canvases.updated_by 不等价于当前 data version 的保存者；patchCanvasMeta/archiveCanvas/publish/unpublish 都会更新它但不写 canvas_versions。"
    },
    {
      "id": 3,
      "why": "同 #2，mergedFromUsername 若 JOIN canvases.updated_by 会在元信息更新后误指向最后改元信息的人。建议 JOIN canvas_versions.saved_by + users。"
    }
  ],
  "hidden_decisions": [
    "合并分支必须在同一个 tx.immediate() 内完成：读 row/base/currentVersion 保存者、tryMerge、rewrite、UPDATE、INSERT version、sync meta/annotations。",
    "deltaB 的来源要定死：validate/rewrite/sync 必须使用同一 baseData→incomingData 语义。tryMerge 默认不暴露 deltaB，阶段 C 需预先 compute 一次或内部取 debugDelta 后不外传。",
    "权限校验优先级要定死：建议先 compute deltaB 并 validateDeltaBPermissions，再 tryMerge；避免用 409 冲突掩盖 403/409 权限类错误。",
    "currentVersion 的 saved_by/username 建议用一条 SELECT canvas_versions LEFT JOIN users 获取；若当前版本快照缺失，应按数据完整性错误处理或显式降级为 null。",
    "merged=true 返回给客户端的 mergedData 应是 rewriteNodesFromMeta 后、与主表持久化完全一致的数据。",
    "metaIndex 读取时机应在权限校验后、rewrite 前、同事务内；不要用事务外缓存。",
    "active_sheet_missing 由 applyDelta 产 conflicts，saveCanvas 应透传为 error='conflict' + conflicts 数组。",
    "syncNodesMetaFromDeltaB 必须在合并成功路径复用，确保 B 删除节点/sheet 时 annotations 同事务清理。",
    "E7 warnings 只进 mergeReport；阶段 C 不写 conflict_logs，也不在冲突路径携带 warnings。",
    "debugDelta 含 Map，不应直接 JSON 返回或直接落库；Day 3 需要专门序列化。"
  ],
  "risks": [
    {
      "severity": "high",
      "title": "deltaB 未暴露导致副作用可能漂移",
      "detail": "tryMerge 内部计算 deltaB，但 saveCanvas 的权限、rewrite、nodes_meta 同步都依赖 deltaB；若另用 mergedData 推导会破坏 G4。"
    },
    {
      "severity": "medium",
      "title": "canvases.updated_by 会误报合并来源",
      "detail": "元信息 PATCH、发布、撤回、归档会更新主表 updated_by 但不产生 data version；用它取 userA/username 会错。"
    },
    {
      "severity": "medium",
      "title": "权限与冲突的返回优先级需固定",
      "detail": "若先 tryMerge 后 validate，越权修改可能被普通 merge conflict 掩盖；建议先 validate deltaB。"
    },
    {
      "severity": "low",
      "title": "E7 dropped edge 计数可能让 toast 偏乐观",
      "detail": "mergeReport 当前按 deltaB 计 edgesAdded，但 E7 会丢弃悬空边；需要靠 warnings 明确展示。"
    }
  ],
  "confidence": "high",
  "notes_for_claude_code": "关键定位：saveCanvas 当前 baseVersion<currentVersion 仍是 stub；快速路径已在 computeDelta 后 validateDeltaBPermissions、rewriteNodesFromMeta、UPDATE canvases、INSERT canvas_versions、syncNodesMetaFromDeltaB。tryMerge 会 computeDelta 两次、detect 四段、applyDelta，并只在 includeDebugDelta=true 时返回 deltaA/deltaB。applyDelta 已处理 active_sheet_missing 和 E7 warnings。routes/canvases.ts 已把 DataIntegrityError 映射为 500 data_integrity_error。"
}
```

## 调用细节

- **prompt 大小**：185538 字节（含 8 文件源码 + 11 判断点 brief + 项目语境）
- **stdin 注入**：`codex exec --skip-git-repo-check --sandbox read-only -c MaxContextChars=240000 -o /tmp/codex-p5c-result.md - < /tmp/codex-p5c-prompt.txt`
- **exit code**：0
- **后台模式**：是（运行时间 ~270s）
- **Windows 双坑根治**：stdin 注入避开 ARG_MAX 32KB；不让 codex 子进程 spawn 读文件避开 sandbox 1326

## 进入实施

`canEnterImpl: true`。saveCanvas 分支 2 实施按本归档"阶段 C 实施流程"段执行，验收清单 4 项全过后进阶段 D（codex 末尾审 + bump v1.13.0）。
