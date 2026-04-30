-- 0002_backfill_nodes_meta：幂等防御性 backfill
--
-- 背景（P3D-1 codex 一审必修 2）：
-- P3A 落地之前的旧画布可能有 storage 节点没在 nodes_meta 里登记 → P3D 前端
-- canEditNode() 拿不到 creator_id → 用户保存时服务端 409 node_meta_missing。
--
-- 本 migration 把所有 storage 里出现但 nodes_meta 没记录的 (canvas_id, sheet_id,
-- node_id) 三元组补进去，creator/updated 元字段从 canvases 表读。
--
-- 实测 2026-04-30 生产数据库：storage 节点 247 行 / nodes_meta 247 行 /
-- missing_meta = 0。本 migration 在生产是**零增量**，纯防御 —— 万一以后有边
-- 界把节点漏写 meta，重启时能自动补。
--
-- 不依赖客户端或 service 层，纯 SQL 完成。

INSERT INTO nodes_meta
  (canvas_id, sheet_id, node_id,
   creator_id, created_at,
   updated_by, updated_at,
   is_deprecated, deprecated_by, deprecated_at)
SELECT
  c.id AS canvas_id,
  json_extract(s.value, '$.id') AS sheet_id,
  json_extract(n.value, '$.id') AS node_id,
  -- creator/created_at：用画布的 created_by/at 作为兜底归属
  -- 转手画布（owner_id != created_by）按 codex 取舍意见仍用 created_by
  -- 实测生产此值 = 0，无影响
  c.created_by,
  c.created_at,
  -- updated_by/updated_at：同 created_by/at（节点没单独的修改记录可继承）
  c.created_by,
  c.created_at,
  -- is_deprecated：从 storage node 的 $.is_deprecated 继承（codex 必修 2）
  -- 防止已废弃历史节点被覆盖回未废弃；缺省 false
  COALESCE(json_extract(n.value, '$.is_deprecated'), 0),
  -- deprecated_by/at：storage 里有合法值就继承，否则 NULL
  json_extract(n.value, '$.deprecated_by'),
  json_extract(n.value, '$.deprecated_at')
FROM canvases c
JOIN json_each(c.data, '$.sheets') s
JOIN json_each(s.value, '$.nodes') n
WHERE NOT EXISTS (
  SELECT 1 FROM nodes_meta m
  WHERE m.canvas_id = c.id
    AND m.sheet_id = json_extract(s.value, '$.id')
    AND m.node_id = json_extract(n.value, '$.id')
);
