import { customAlphabet } from 'nanoid';

// 字符集与服务端 ShortIdSchema /^[A-Za-z0-9_-]+$/ 对齐
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-';
const RANDOM_LEN = 10;

const randomShortId = customAlphabet(ALPHABET, RANDOM_LEN);

export const newNodeId = () => `n_${randomShortId()}`;
export const newGroupId = () => `g_${randomShortId()}`;
export const newEdgeId = () => `e_${randomShortId()}`;
