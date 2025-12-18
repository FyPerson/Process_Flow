/**
 * IndexedDB 存储工具 - 管理流程图版本
 * 最多保存 10 个版本，超出时自动删除最旧的版本
 */

const DB_NAME = 'flow-versions-db';
const DB_VERSION = 1;
const STORE_NAME = 'versions';
const MAX_VERSIONS = 10;

import { FlowDefinition } from '../types/flow';

export interface FlowVersion {
  id?: number;
  timestamp: number;
  name: string;
  data: FlowDefinition;
}

export interface SaveResult {
  id: number;
  timestamp: number;
  name: string;
  currentCount: number;
  maxVersions: number;
}

// 打开数据库
function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => {
      reject(new Error('无法打开 IndexedDB 数据库'));
    };

    request.onsuccess = () => {
      resolve(request.result);
    };

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, {
          keyPath: 'id',
          autoIncrement: true,
        });
        store.createIndex('timestamp', 'timestamp', { unique: false });
      }
    };
  });
}

// 保存新版本
export async function saveVersion(data: FlowDefinition, name?: string): Promise<SaveResult> {
  const db = await openDB();
  const timestamp = Date.now();
  const versionName = name || `版本 ${new Date(timestamp).toLocaleString()}`;

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readwrite');
    const store = transaction.objectStore(STORE_NAME);

    // 添加新版本
    const version: FlowVersion = {
      timestamp,
      name: versionName,
      data,
    };

    const addRequest = store.add(version);

    addRequest.onsuccess = () => {
      const newId = addRequest.result as number;

      // 检查并删除超出限制的旧版本
      const countRequest = store.count();
      countRequest.onsuccess = () => {
        const count = countRequest.result;
        const finalCount = Math.min(count, MAX_VERSIONS);

        if (count > MAX_VERSIONS) {
          // 获取所有版本按时间排序，删除最旧的
          const index = store.index('timestamp');
          const cursorRequest = index.openCursor();
          let deleted = 0;
          const toDelete = count - MAX_VERSIONS;

          cursorRequest.onsuccess = (event) => {
            const cursor = (event.target as IDBRequest<IDBCursorWithValue>).result;
            if (cursor && deleted < toDelete) {
              store.delete(cursor.primaryKey);
              deleted++;
              cursor.continue();
            }
          };
        }

        resolve({
          id: newId,
          timestamp,
          name: versionName,
          currentCount: finalCount,
          maxVersions: MAX_VERSIONS,
        });
      };
    };

    addRequest.onerror = () => {
      reject(new Error('保存版本失败'));
    };

    transaction.oncomplete = () => {
      db.close();
    };
  });
}

// 获取所有版本列表
export async function getAllVersions(): Promise<FlowVersion[]> {
  const db = await openDB();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readonly');
    const store = transaction.objectStore(STORE_NAME);
    const index = store.index('timestamp');

    // 按时间倒序获取
    const versions: FlowVersion[] = [];
    const cursorRequest = index.openCursor(null, 'prev');

    cursorRequest.onsuccess = (event) => {
      const cursor = (event.target as IDBRequest<IDBCursorWithValue>).result;
      if (cursor) {
        versions.push(cursor.value);
        cursor.continue();
      } else {
        resolve(versions);
      }
    };

    cursorRequest.onerror = () => {
      reject(new Error('获取版本列表失败'));
    };

    transaction.oncomplete = () => {
      db.close();
    };
  });
}

// 获取指定版本
export async function getVersion(id: number): Promise<FlowVersion | null> {
  const db = await openDB();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readonly');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.get(id);

    request.onsuccess = () => {
      resolve(request.result || null);
    };

    request.onerror = () => {
      reject(new Error('获取版本失败'));
    };

    transaction.oncomplete = () => {
      db.close();
    };
  });
}

// 删除指定版本
export async function deleteVersion(id: number): Promise<void> {
  const db = await openDB();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.delete(id);

    request.onsuccess = () => {
      resolve();
    };

    request.onerror = () => {
      reject(new Error('删除版本失败'));
    };

    transaction.oncomplete = () => {
      db.close();
    };
  });
}

// 获取版本数量
export async function getVersionCount(): Promise<number> {
  const db = await openDB();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readonly');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.count();

    request.onsuccess = () => {
      resolve(request.result);
    };

    request.onerror = () => {
      reject(new Error('获取版本数量失败'));
    };

    transaction.oncomplete = () => {
      db.close();
    };
  });
}

// 导出 JSON 文件
export function exportToFile(data: FlowDefinition, filename?: string): void {
  const jsonStr = JSON.stringify(data, null, 2);
  const blob = new Blob([jsonStr], { type: 'application/json' });
  const url = URL.createObjectURL(blob);

  const a = document.createElement('a');
  a.href = url;
  a.download = filename || `flow-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// 从文件导入
export function importFromFile(): Promise<FlowDefinition> {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';

    input.onchange = (event) => {
      const file = (event.target as HTMLInputElement).files?.[0];
      if (!file) {
        reject(new Error('未选择文件'));
        return;
      }

      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const data = JSON.parse(e.target?.result as string);
          resolve(data);
        } catch (error) {
          reject(new Error('JSON 解析失败'));
        }
      };
      reader.onerror = () => {
        reject(new Error('文件读取失败'));
      };
      reader.readAsText(file);
    };

    input.click();
  });
}

// ============================================================
// File System Access API - 本地文件夹保存
// ============================================================

// 存储目录句柄的键名
const DIR_HANDLE_KEY = 'flow-save-directory';

// 保存的文件信息
export interface LocalFileSaveResult {
  success: boolean;
  filename: string;
  folderName: string;
  timestamp: number;
  fileCount: number;
  message: string;
}

// 检查浏览器是否支持 File System Access API
export function isFileSystemAccessSupported(): boolean {
  return 'showDirectoryPicker' in window;
}

// 存储目录句柄到 IndexedDB（因为 FileSystemDirectoryHandle 不能存储到 localStorage）
let cachedDirectoryHandle: FileSystemDirectoryHandle | null = null;

// 请求用户选择保存目录
export async function selectSaveDirectory(): Promise<FileSystemDirectoryHandle | null> {
  if (!isFileSystemAccessSupported()) {
    return null;
  }

  try {
    const handle = await window.showDirectoryPicker({
      mode: 'readwrite',
      startIn: 'documents',
    });
    cachedDirectoryHandle = handle;
    return handle;
  } catch (error: any) {
    if (error.name === 'AbortError') {
      // 用户取消选择
      return null;
    }
    throw error;
  }
}

// 获取已保存的目录句柄
export function getSavedDirectoryHandle(): FileSystemDirectoryHandle | null {
  return cachedDirectoryHandle;
}

// 清除已保存的目录句柄
export function clearSavedDirectoryHandle(): void {
  cachedDirectoryHandle = null;
}

// 验证目录句柄是否仍然有效
async function verifyDirectoryHandle(handle: FileSystemDirectoryHandle): Promise<boolean> {
  try {
    // 尝试请求权限
    // 尝试请求权限
    const permission = await handle.requestPermission({ mode: 'readwrite' });
    return permission === 'granted';
  } catch {
    return false;
  }
}

// 生成文件名
function generateFilename(): string {
  const now = new Date();
  const dateStr = now.toISOString().slice(0, 10); // YYYY-MM-DD
  const timeStr = now.toTimeString().slice(0, 8).replace(/:/g, '-'); // HH-MM-SS
  return `flow-${dateStr}_${timeStr}.json`;
}

// 获取目录中的 flow 文件列表
async function getFlowFiles(handle: FileSystemDirectoryHandle): Promise<string[]> {
  const files: string[] = [];
  for await (const entry of handle.values()) {
    if (entry.kind === 'file' && entry.name.startsWith('flow-') && entry.name.endsWith('.json')) {
      files.push(entry.name);
    }
  }
  // 按文件名排序（时间顺序）
  return files.sort();
}

// 保存到本地文件夹
export async function saveToLocalFolder(data: FlowDefinition): Promise<LocalFileSaveResult> {
  // 检查是否已有目录句柄
  let handle = getSavedDirectoryHandle();

  // 如果没有或无效，请求用户选择
  if (!handle) {
    handle = await selectSaveDirectory();
    if (!handle) {
      throw new Error('未选择保存目录');
    }
  }

  // 验证权限
  const isValid = await verifyDirectoryHandle(handle);
  if (!isValid) {
    // 权限失效，重新请求
    handle = await selectSaveDirectory();
    if (!handle) {
      throw new Error('未选择保存目录');
    }
  }

  // 生成文件名并保存
  const filename = generateFilename();
  const jsonStr = JSON.stringify(data, null, 2);

  try {
    const fileHandle = await handle.getFileHandle(filename, { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(jsonStr);
    await writable.close();

    // 获取当前文件数量（不再自动清理，由用户手动管理）
    const files = await getFlowFiles(handle);

    return {
      success: true,
      filename,
      folderName: handle.name,
      timestamp: Date.now(),
      fileCount: files.length,
      message: `已保存到 ${handle.name}/${filename}`,
    };
  } catch (error: any) {
    throw new Error(`保存失败: ${error.message}`);
  }
}
