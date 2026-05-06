// Zod schemas for /api/canvases/:cid/draft（阶段 4 P4B）
//
// data 字段为 JSON 字符串（客户端先 JSON.stringify 整个 FlowDefinition / MultiCanvasProject）
// 服务端不再校验 data 内部 schema（避免双倍 zod 成本，且 PUT canvases 时会再校验）。
//
// 大小限制走两层：
// 1. express.json({ limit: '2mb' }) 全局拦截过大 body
// 2. service 层 putDraft 再查 Buffer.byteLength 兜底（防绕过）

import { z } from 'zod';

export const PutDraftRequestSchema = z
  .object({
    data: z.string().min(1), // JSON 字符串，至少 1 字节
    baseVersion: z.number().int().nonnegative(),
  })
  .strict();

export type PutDraftRequest = z.infer<typeof PutDraftRequestSchema>;
