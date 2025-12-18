/**
 * 安全的深拷贝函数
 * 处理循环引用和不可序列化的对象
 */

type SerializableValue = string | number | boolean | null | Date | SerializableObject | SerializableArray;
type SerializableObject = Record<string, unknown>;
type SerializableArray = unknown[];

export function safeDeepCopy<T>(
  obj: T,
  seen = new WeakMap<object, unknown>(),
  filter?: (key: string, value: unknown) => boolean,
): T {
  // 处理基本类型和 null
  if (obj === null || typeof obj !== 'object') {
    return obj;
  }

  // 检测循环引用
  if (seen.has(obj as object)) {
    return seen.get(obj as object) as T;
  }

  // 处理日期对象
  if (obj instanceof Date) {
    const dateCopy = new Date(obj.getTime());
    seen.set(obj, dateCopy);
    return dateCopy as T;
  }

  // 处理数组
  if (Array.isArray(obj)) {
    const arrCopy: unknown[] = [];
    seen.set(obj, arrCopy);
    obj.forEach((item) => {
      arrCopy.push(safeDeepCopy(item, seen, filter));
    });
    return arrCopy as T;
  }

  // 处理普通对象
  const objCopy: Record<string, unknown> = {};
  seen.set(obj as object, objCopy);

  Object.keys(obj).forEach((key) => {
    try {
      const objRecord = obj as Record<string, unknown>;
      const value = objRecord[key];
      
      // 跳过函数和 undefined
      if (typeof value === 'function' || value === undefined) {
        return;
      }

      // 使用自定义过滤器
      if (filter && !filter(key, value)) {
        return;
      }

      // 跳过不可序列化的对象（如 DOM 元素、Symbol 等）
      if (typeof value === 'object' && value !== null) {
        // 检测是否为内置对象的实例（如 HTMLElement, Map, Set 等）
        const proto = Object.getPrototypeOf(value);
        if (
          proto &&
          proto.constructor &&
          proto.constructor.name !== 'Object' &&
          proto.constructor.name !== 'Array'
        ) {
          // 跳过内置对象实例
          return;
        }
      }
      
      // 确保值是可序列化的
      if (value !== null && typeof value === 'object') {
        objCopy[key] = safeDeepCopy(value, seen, filter);
      } else if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' || value === null) {
        objCopy[key] = value;
      }
    } catch (e) {
      // 如果某个属性无法访问或拷贝，跳过它
    }
  });

  return objCopy as T;
}
