// /api/canvases/:cid/heartbeat 路由（阶段 4 P4A，方案 §4.5）
//
// 鉴权：requireAuth（游客不能发心跳，因为没有"在编辑"语义）
// 权限：canRead（用户至少能看到此画布才算"在场"；canWrite 太严会让 admin 在 archived 画布心跳也通过）
// 响应：{ otherEditors: [{ userId, username, lastSeenAt }, ...] }
//
// 客户端约定（判断点 6）：
// - 30s 一次 setInterval；document.hidden 时暂停；visibilitychange to visible 立即补发
// - 同用户多 tab 由 PRIMARY KEY (user_id, canvas_id) 自动去重，不影响正确性

import { Router, type Request, type Response } from 'express';
import { requireAuth } from '../middleware/auth.ts';
import { validateBody } from '../middleware/validate.ts';
import { HeartbeatRequestSchema } from '../schemas/heartbeat.ts';
import { canRead, getCanvasRow } from '../services/canvases.ts';
import { upsertHeartbeat } from '../services/heartbeats.ts';

export const heartbeatsRouter: Router = Router();

heartbeatsRouter.post(
  '/api/canvases/:cid/heartbeat',
  requireAuth,
  validateBody(HeartbeatRequestSchema),
  (req: Request, res: Response) => {
    const cid = Number(req.params.cid);
    if (!Number.isInteger(cid) || cid <= 0) {
      res.status(400).json({ error: 'invalid_id' });
      return;
    }

    const row = getCanvasRow(cid);
    if (!row) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    const user = req.user!;
    if (!canRead(row, user)) {
      res.status(403).json({ error: 'forbidden' });
      return;
    }

    try {
      const otherEditors = upsertHeartbeat({
        userId: user.id,
        canvasId: cid,
      });
      res.json({ otherEditors });
    } catch (err) {
      res.status(500).json({ error: 'heartbeat_failed', message: (err as Error).message });
    }
  }
);
