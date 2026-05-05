// Zod schemas for annotation API（方案 §4.4，2026-05-05 P3E 一审产品规则）
//
// 关键容量限制（与方案 §1.4 "容量限制"段一致）：
// - content trim 后 1-2000 字符
// - 单节点 unresolved ≤ 100；单节点全部 ≤ 500（在 service 层校验，不在 zod 层）

import { z } from 'zod';
import { ShortIdSchema } from './canvas.ts';

// 内容长度上限（与方案 §1.4 一致）
export const ANNOTATION_CONTENT_MIN = 1;
export const ANNOTATION_CONTENT_MAX = 2000;

// 单节点批注数量上限（service 层校验）
export const ANNOTATION_UNRESOLVED_MAX_PER_NODE = 100;
export const ANNOTATION_TOTAL_MAX_PER_NODE = 500;

// 内容字符串：先 trim，再校验 trim 后长度 1-2000 字符
// （codex 02-审 medium 1：之前 .max(2000) 校验原始长度会拒"1999 字 + 前后空格"这类合法输入；
//  改为 transform→pipe，让下游直接拿到清洗后的值，路由层不需再次 trim）
const AnnotationContentSchema = z
  .string()
  .max(ANNOTATION_CONTENT_MAX + 100) // 防御：拒过分超长（攻击者塞 1MB 空格也走不到 trim）
  .transform((s) => s.trim())
  .pipe(z.string().min(ANNOTATION_CONTENT_MIN).max(ANNOTATION_CONTENT_MAX));

// 整数 ID 路径参数（codex 02-审 low 1：抽出复用，避免 route 内手写 Number(req.params.x) + isInteger 校验）
export const PositiveIntegerIdSchema = z.coerce
  .number()
  .int()
  .positive();

// POST /api/canvases/:cid/annotations
export const CreateAnnotationRequestSchema = z
  .object({
    sheetId: ShortIdSchema,
    nodeId: ShortIdSchema,
    content: AnnotationContentSchema,
  })
  .strict();

export type CreateAnnotationRequest = z.infer<typeof CreateAnnotationRequestSchema>;

// 响应中的 Annotation 形状（GET / POST 返回）
// 注意：为前端方便派生计数，这里不嵌套 author/resolver 对象，而是平铺
// 用户名 hydrate（author_username / resolved_by_username）由 service 层 JOIN users 填入
export interface AnnotationResponse {
  id: number;
  canvas_id: number;
  sheet_id: string;
  node_id: string;
  author_id: number;
  author_username: string | null; // null = 用户已删（fallback "用户 #N"）
  content: string;
  status: 'unresolved' | 'resolved';
  resolved_by: number | null;
  resolved_by_username: string | null;
  resolved_at: number | null;
  created_at: number;
}
