import { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { CanvasSheet } from '../../types/flow';
import './styles.css';

interface CanvasTabBarProps {
  sheets: CanvasSheet[];
  activeSheetId: string;
  onSheetChange: (sheetId: string) => void;
  onAddSheet: () => void;
  onDeleteSheet: (sheetId: string) => void;
  onRenameSheet: (sheetId: string, newName: string) => void;
  onDuplicateSheet?: (sheetId: string) => void;
}

// 右键菜单状态
interface ContextMenuState {
  visible: boolean;
  x: number;
  y: number;
  sheetId: string | null;
}

export function CanvasTabBar({
  sheets,
  activeSheetId,
  onSheetChange,
  onAddSheet,
  onDeleteSheet,
  onRenameSheet,
  onDuplicateSheet,
}: CanvasTabBarProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const [showScrollButtons, setShowScrollButtons] = useState(false);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);
  const [contextMenu, setContextMenu] = useState<ContextMenuState>({
    visible: false,
    x: 0,
    y: 0,
    sheetId: null,
  });

  const tabsContainerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const contextMenuRef = useRef<HTMLDivElement>(null);

  // 检查是否需要显示滚动按钮
  const checkScrollButtons = useCallback(() => {
    const container = tabsContainerRef.current;
    if (!container) return;

    const hasOverflow = container.scrollWidth > container.clientWidth;
    setShowScrollButtons(hasOverflow);
    setCanScrollLeft(container.scrollLeft > 0);
    setCanScrollRight(
      container.scrollLeft < container.scrollWidth - container.clientWidth - 1
    );
  }, []);

  // 监听容器大小变化
  useEffect(() => {
    const container = tabsContainerRef.current;
    if (!container) return;

    checkScrollButtons();

    const resizeObserver = new ResizeObserver(checkScrollButtons);
    resizeObserver.observe(container);

    container.addEventListener('scroll', checkScrollButtons);

    return () => {
      resizeObserver.disconnect();
      container.removeEventListener('scroll', checkScrollButtons);
    };
  }, [checkScrollButtons, sheets.length]);

  // 滚动到指定方向
  const scroll = (direction: 'left' | 'right') => {
    const container = tabsContainerRef.current;
    if (!container) return;

    const scrollAmount = 150;
    container.scrollBy({
      left: direction === 'left' ? -scrollAmount : scrollAmount,
      behavior: 'smooth',
    });
  };

  // 开始编辑
  const startEditing = (sheet: CanvasSheet) => {
    setEditingId(sheet.id);
    setEditValue(sheet.name);
  };

  // 完成编辑
  const finishEditing = () => {
    if (editingId && editValue.trim()) {
      onRenameSheet(editingId, editValue.trim());
    }
    setEditingId(null);
    setEditValue('');
  };

  // 取消编辑
  const cancelEditing = () => {
    setEditingId(null);
    setEditValue('');
  };

  // 处理键盘事件
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      finishEditing();
    } else if (e.key === 'Escape') {
      cancelEditing();
    }
  };

  // 处理标签点击
  const handleTabClick = (sheetId: string) => {
    if (editingId !== sheetId) {
      onSheetChange(sheetId);
    }
  };

  // 处理双击编辑
  const handleDoubleClick = (sheet: CanvasSheet) => {
    startEditing(sheet);
  };

  // 处理删除
  const handleDelete = (e: React.MouseEvent, sheetId: string) => {
    e.stopPropagation();
    if (sheets.length > 1) {
      if (window.confirm('确定要删除这个画布吗？')) {
        onDeleteSheet(sheetId);
      }
    }
  };

  // 处理右键菜单
  const handleContextMenu = useCallback((e: React.MouseEvent, sheetId: string) => {
    e.preventDefault();
    e.stopPropagation();

    // 计算菜单位置，确保不超出视口
    const menuWidth = 160;
    const menuHeight = 140;
    let x = e.clientX;
    let y = e.clientY;

    // 如果右边空间不够，向左偏移
    if (x + menuWidth > window.innerWidth) {
      x = window.innerWidth - menuWidth - 10;
    }
    // 如果下方空间不够，菜单显示在点击位置上方
    if (y + menuHeight > window.innerHeight) {
      y = y - menuHeight - 10;
    }
    // 确保菜单不会超出顶部
    if (y < 10) {
      y = 10;
    }

    setContextMenu({
      visible: true,
      x,
      y,
      sheetId,
    });
  }, []);

  // 关闭右键菜单
  const closeContextMenu = useCallback(() => {
    setContextMenu((prev) => ({ ...prev, visible: false }));
  }, []);

  // 处理右键菜单操作
  const handleContextMenuAction = (action: 'duplicate' | 'rename' | 'delete') => {
    const sheetId = contextMenu.sheetId;
    if (!sheetId) return;

    switch (action) {
      case 'duplicate':
        if (onDuplicateSheet) {
          onDuplicateSheet(sheetId);
        }
        break;
      case 'rename':
        const sheet = sheets.find((s) => s.id === sheetId);
        if (sheet) {
          startEditing(sheet);
        }
        break;
      case 'delete':
        if (sheets.length > 1) {
          if (window.confirm('确定要删除这个画布吗？')) {
            onDeleteSheet(sheetId);
          }
        }
        break;
    }
    closeContextMenu();
  };

  // 点击外部关闭右键菜单
  useEffect(() => {
    if (!contextMenu.visible) return;

    const handleClickOutside = (e: MouseEvent) => {
      if (
        contextMenuRef.current &&
        !contextMenuRef.current.contains(e.target as Node)
      ) {
        closeContextMenu();
      }
    };

    const handleContextMenuOutside = (e: MouseEvent) => {
      // 如果右键点击不在菜单内，关闭菜单
      if (
        contextMenuRef.current &&
        !contextMenuRef.current.contains(e.target as Node)
      ) {
        closeContextMenu();
      }
    };

    // 使用 setTimeout 延迟添加监听器，避免当前事件触发关闭
    const timeoutId = setTimeout(() => {
      document.addEventListener('mousedown', handleClickOutside);
      document.addEventListener('contextmenu', handleContextMenuOutside);
    }, 0);

    return () => {
      clearTimeout(timeoutId);
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('contextmenu', handleContextMenuOutside);
    };
  }, [contextMenu.visible, closeContextMenu]);

  // 聚焦输入框
  useEffect(() => {
    if (editingId && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editingId]);

  return (
    <div
      className="canvas-tab-bar"
      onContextMenu={(e) => {
        // 在标签栏区域内阻止默认右键菜单
        // 只有在标签上的右键点击会显示自定义菜单
        e.preventDefault();
      }}
    >
      {/* 左滚动按钮 */}
      {showScrollButtons && (
        <button
          className={`canvas-tab-scroll-btn left ${!canScrollLeft ? 'disabled' : ''}`}
          onClick={() => scroll('left')}
          disabled={!canScrollLeft}
          title="向左滚动"
        >
          ◀
        </button>
      )}

      {/* 标签容器 */}
      <div className="canvas-tabs-container" ref={tabsContainerRef}>
        {sheets.map((sheet) => (
          <div
            key={sheet.id}
            className={`canvas-tab ${activeSheetId === sheet.id ? 'active' : ''}`}
            onClick={() => handleTabClick(sheet.id)}
            onDoubleClick={() => handleDoubleClick(sheet)}
            onContextMenu={(e) => handleContextMenu(e, sheet.id)}
          >
            {editingId === sheet.id ? (
              <input
                ref={inputRef}
                type="text"
                className="canvas-tab-input"
                value={editValue}
                onChange={(e) => setEditValue(e.target.value)}
                onBlur={finishEditing}
                onKeyDown={handleKeyDown}
                onClick={(e) => e.stopPropagation()}
              />
            ) : (
              <>
                <span className="canvas-tab-name" title={sheet.name}>
                  {sheet.name}
                </span>
                {sheets.length > 1 && (
                  <button
                    className="canvas-tab-close"
                    onClick={(e) => handleDelete(e, sheet.id)}
                    title="删除画布"
                  >
                    ×
                  </button>
                )}
              </>
            )}
          </div>
        ))}

        {/* 添加按钮 - 放在标签容器内，紧跟在标签后面 */}
        <button
          className="canvas-tab-add"
          onClick={onAddSheet}
          title="新建画布"
        >
          +
        </button>
      </div>

      {/* 右滚动按钮 */}
      {showScrollButtons && (
        <button
          className={`canvas-tab-scroll-btn right ${!canScrollRight ? 'disabled' : ''}`}
          onClick={() => scroll('right')}
          disabled={!canScrollRight}
          title="向右滚动"
        >
          ▶
        </button>
      )}

      {/* 右键菜单 - 使用 Portal 渲染到 body，避免被父元素裁剪 */}
      {contextMenu.visible && createPortal(
        <div
          ref={contextMenuRef}
          className="canvas-tab-context-menu"
          style={{
            position: 'fixed',
            left: contextMenu.x,
            top: contextMenu.y,
          }}
        >
          <button
            className="context-menu-item"
            onClick={() => handleContextMenuAction('duplicate')}
          >
            <span className="context-menu-icon">📋</span>
            复制画布
          </button>
          <button
            className="context-menu-item"
            onClick={() => handleContextMenuAction('rename')}
          >
            <span className="context-menu-icon">✏️</span>
            重命名
          </button>
          <div className="context-menu-divider" />
          <button
            className="context-menu-item danger"
            onClick={() => handleContextMenuAction('delete')}
            disabled={sheets.length <= 1}
          >
            <span className="context-menu-icon">🗑️</span>
            删除画布
          </button>
        </div>,
        document.body
      )}
    </div>
  );
}
