// Zod schemas for /api/canvases/:cid/heartbeat（阶段 4 P4A）
//
// 当前 POST heartbeat 不接受 body 参数（cid 走 path）；保留空 schema 占位以备未来扩展
// （如 sheetId 多 sheet 编辑细粒度心跳）

import { z } from 'zod';

export const HeartbeatRequestSchema = z.object({}).strict();

export type HeartbeatRequest = z.infer<typeof HeartbeatRequestSchema>;
