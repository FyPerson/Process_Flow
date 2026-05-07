# 阶段 5 合并算法 4 天 MVP

| Day | 主题 | 状态 | 版本 | 归档 |
|---|---|---|---|---|
| Day 1 | 基建（类型 + computeDelta + schema parentId 真校验） | ✅ 完工 2026-05-06 | v1.12.0 | [Day1-基建/](Day1-基建/) |
| Day 2 | 合并算法（detector + applyDelta + tryMerge + saveCanvas 接合并） | 🔄 进行中（阶段 A + B 系列已完工 / C + D 待启动） | - | [Day2-合并算法/](Day2-合并算法/) |
| Day 3 | 客户端（merged 响应 + 状态替换 + conflict_logs 写入） | ⏳ 待启动 | - | - |
| Day 4 | 真冲突 UI + Playwright + 部署 | ⏳ 待启动 | - | - |

## Day 2 子阶段进度

| 子阶段 | 主题 | 状态 |
|---|---|---|
| **A** | saveCanvas 快速路径迁移到 Delta 形态 + 提取 3 helper（validateDeltaBPermissions / rewriteNodesFromMeta / syncNodesMetaFromDeltaB）+ DataIntegrityError 路由映射 | ✅ 完工 2026-05-07（commit `14e41c8` + `5d75e99`，未 bump） |
| **B-1** | detectNodeConflicts（N4/N6/N7/N8 + node_removed_deprecated；14 case） | ✅ 完工 2026-05-07（commit `60d4f26`；codex 两轮审 canEnterB2: true） |
| **B-2** | detectEdgeConflicts（E4/E5/N9 + edge_id_collision + edge_semantic_conflict 3 子场景；H1 修法 SEMANTIC_CONNECTOR_FIELDS + M1 deepEqualJsonShape；14 case） | ✅ 完工 2026-05-07（commit `60d4f26`；codex 两轮审 canEnterB25: true） |
| **B-2.5** | detectSheetConflicts + detectProjectConflicts（sheet_id_collision / sheet_removed_modified 双向 / *_meta_conflict G3 保守；13 case） | ✅ 完工 2026-05-07（commit `60d4f26`；codex 一轮审 canEnterB3: true） |
| **B-3** | applyDelta（纯函数字段补丁 + E7 dangling endpoint warning + active_sheet_missing 内部映射 + R-Day2-2 复跑 assertProjectIntegrity；E2 防御抛 DataIntegrityError；18 case） | ✅ 完工 2026-05-07（commit `60d4f26`；codex 一轮审 canEnterB4: true） |
| **B-4** | tryMerge 编排（computeDelta×2 + 四段 detect 全收集 + applyDelta + mergeReport 计数 + debugDelta?；ok:false 不携带 warnings；11 case） | ✅ 完工 2026-05-07（commit `60d4f26`；codex 两轮审 canEnterC: true） |
| **C** | saveCanvas 接合并算法 + 端到端（**codex H1 验收必修**：DataIntegrityError catch 映射 500 + data_integrity_error，覆盖 currentData 历史脏数据路径） | ⏳ 待启动 |
| **D** | Day 2 末尾 codex 审 + bump v1.13.0 | ⏳ 待启动 |

## 关键决策快速索引

- [Day 1 11 项决策（取舍审）](Day1-基建/02-拍板记录.md)
- [Day 1 99-收尾](Day1-基建/99-收尾.md)
- [Day 2 11 项决策（7 判断点 X + 4 新增风险）](Day2-合并算法/03-拍板记录.md)
- [阶段 A 代码审查 + Claude 拍板](Day2-合并算法/04-阶段A-代码审查-helper提取.md)
- [B-1 detector 节点段代码审查（两轮）](Day2-合并算法/05-阶段B-1-代码审查-detector节点段.md)
- [B-2 detector 边段代码审查（两轮 + H1/M1/M2 真 bug 修法）](Day2-合并算法/06-阶段B-2-代码审查-detector边段.md)
- [B-2.5 detector sheet/project 段代码审查](Day2-合并算法/07-阶段B-2.5-代码审查-detector-sheet-project段.md)
- [B-3 applyDelta 代码审查（含路径 b 不可达性后续修正）](Day2-合并算法/08-阶段B-3-代码审查-applyDelta.md)
- [B-4 tryMerge 代码审查（两轮 + 阶段 C 验收清单）](Day2-合并算法/09-阶段B-4-代码审查-tryMerge.md)

## codex 协作模式（Windows sandbox 1326 解决方案）

阶段 5 Day 2 取舍审实战发现 `codex exec --sandbox read-only` 在 Windows 上启 PowerShell 子进程一律 1326（CreateProcessWithLogonW failed）。

**根治写法**：

```bash
# ❌ 错误：codex 自己 spawn 读文件——sandbox 1326
codex exec --skip-git-repo-check --sandbox read-only \
  -o /tmp/codex-result.md \
  "$(cat /tmp/codex-prompt.txt)"  # 仅 brief + 文件路径

# ✅ 正确：本地 cat 文件内容前置到 prompt + stdin 注入避开 ARG_MAX
codex exec --skip-git-repo-check --sandbox read-only \
  -c MaxContextChars=180000 \
  -o /tmp/codex-result.md - \
  < /tmp/codex-prompt-with-files.txt  # 含全部所需文件内容
```

详见 [Day2-合并算法/03-拍板记录.md § codex 协作模式沉淀](Day2-合并算法/03-拍板记录.md#codex-协作模式沉淀应用到-codex-cli-bridge-skill)。
