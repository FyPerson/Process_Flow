import { memo } from 'react';

export interface Screenshot {
  id: string;
  title?: string;
  description?: string;
  url: string;
  pageName?: string;
  isComponent?: boolean; // If true, renders as iframe/component preview
  locked?: boolean; // If true, cannot be deleted/edited easily
}

interface ScreenshotManagerProps {
  screenshots: Screenshot[];
  onScreenshotsChange: (screenshots: Screenshot[]) => void;
  onViewScreenshot: (screenshot: Screenshot) => void;
  onOpenPageSelector?: () => void;

  // Mapping function for component URLs (externalized logic)
  getComponentUrl?: (componentId: string) => string;
}

export const ScreenshotManager = memo(function ScreenshotManager({
  screenshots,
  onScreenshotsChange,
  onViewScreenshot,
  onOpenPageSelector,
  getComponentUrl,
}: ScreenshotManagerProps) {

  const handleAddScreenshot = () => {
    const newScreenshot: Screenshot = {
      id: `screenshot_${Date.now()}`,
      title: '',
      description: '',
      url: '',
      pageName: '',
    };
    onScreenshotsChange([...screenshots, newScreenshot]);
  };

  const handleRemoveScreenshot = (index: number) => {
    if (screenshots[index].locked) {
      alert('此截图已锁定，无法删除');
      return;
    }
    if (!window.confirm('确认删除此截图吗？')) return;

    const newScreenshots = screenshots.filter((_, i) => i !== index);
    onScreenshotsChange(newScreenshots);
  };

  const handleUpdateScreenshot = (index: number, field: keyof Screenshot, value: any) => {
    if (screenshots[index].locked && field !== 'locked') return; // Prevent editing if locked

    const newScreenshots = [...screenshots];
    newScreenshots[index] = { ...newScreenshots[index], [field]: value };
    onScreenshotsChange(newScreenshots);
  };

  const toggleLock = (index: number, e: React.MouseEvent) => {
    e.stopPropagation();
    const newLocked = !screenshots[index].locked;
    handleUpdateScreenshot(index, 'locked', newLocked);
  };

  // Helper to resolve iframe source
  const getPreviewSrc = (screenshot: Screenshot) => {
    if (screenshot.url.startsWith('component:') && getComponentUrl) {
      return getComponentUrl(screenshot.url);
    }
    return screenshot.url;
  };

  return (
    <div className="section">
      <div className="section-title" style={{ justifyContent: 'space-between' }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <span className="icon">📸</span> 关联页面截图
        </span>
        <div style={{ display: 'flex', gap: '8px' }}>
          {onOpenPageSelector && (
            <button
              className="btn-add"
              onClick={onOpenPageSelector}
              title="从系统页面库中选择"
              style={{
                background: '#e0e7ff',
                color: '#4338ca',
                border: '1px solid #c7d2fe'
              }}
            >
              📑 选择页面
            </button>
          )}
          <button className="btn-add" onClick={handleAddScreenshot} title="手动添加截图URL">
            + 添加截图
          </button>
        </div>
      </div>

      {screenshots.length === 0 ? (
        <div className="empty-hint" style={{ padding: '24px' }}>
          <div className="hint-text">暂无关联的页面截图</div>
        </div>
      ) : (
        <div className={`screenshots-grid ${screenshots.length === 1 ? 'single-item' : ''}`}>
          {screenshots.map((screenshot, index) => {
            const isLocked = screenshot.locked;
            return (
              <div
                key={screenshot.id}
                className={`screenshot-item ${isLocked ? 'locked' : ''}`}
                //   title={screenshot.title || screenshot.description || '点击查看大图'}
                onClick={(e) => {
                  // Ignore clicks on inputs/buttons
                  if ((e.target as HTMLElement).tagName.match(/INPUT|TEXTAREA|BUTTON/)) return;
                  onViewScreenshot(screenshot);
                }}
                style={{
                  cursor: 'pointer',
                  border: isLocked ? '2px solid #cbd5e1' : '1px solid #e2e8f0',
                  opacity: isLocked ? 0.9 : 1
                }}
              >
                <div className="screenshot-actions">
                  {/* Lock Button */}
                  <button
                    onClick={(e) => toggleLock(index, e)}
                    className="screenshot-action-btn"
                    title={isLocked ? "解锁" : "锁定"}
                    style={{ color: isLocked ? '#d97706' : '#64748b', borderColor: isLocked ? '#fcd34d' : 'transparent', background: isLocked ? '#fffbeb' : 'rgba(255,255,255,0.9)' }}
                  >
                    {isLocked ? '🔒' : '🔓'}
                  </button>

                  {/* Delete Button */}
                  {!isLocked && (
                    <button
                      className="screenshot-action-btn"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleRemoveScreenshot(index);
                      }}
                      title="删除截图"
                      style={{ color: '#ef4444' }}
                    >
                      ×
                    </button>
                  )}
                </div>

                {/* Preview Area */}
                <div className="screenshot-preview" style={{ height: '120px', overflow: 'hidden', background: '#f8fafc', position: 'relative' }}>
                  {screenshot.url ? (
                    screenshot.url.startsWith('component:') || screenshot.isComponent ? (
                      <div className="screenshot-thumbnail-page" style={{ width: '100%', height: '100%' }}>
                        <iframe
                          src={getPreviewSrc(screenshot)}
                          className="screenshot-thumbnail-iframe"
                          style={{
                            width: '400%', height: '400%',
                            transform: 'scale(0.25)', transformOrigin: '0 0',
                            border: 'none', pointerEvents: 'none'
                          }}
                          title="Preview"
                          scrolling="no"
                        />
                        {/* Overlay to catch clicks */}
                        <div style={{ position: 'absolute', inset: 0, zIndex: 10 }}></div>
                      </div>
                    ) : (
                      <img
                        src={screenshot.url}
                        alt={screenshot.title || '截图'}
                        style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                        onError={(e) => {
                          (e.target as HTMLImageElement).src =
                            'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="200" height="150"><rect fill="%23f0f0f0" width="200" height="150"/><text x="50%" y="50%" text-anchor="middle" fill="%23999">图片加载失败</text></svg>';
                        }}
                      />
                    )
                  ) : (
                    <div className="screenshot-placeholder">
                      <span style={{ fontSize: '24px' }}>📷</span>
                      <p>暂无图片</p>
                    </div>
                  )}
                </div>

                {/* Info Inputs */}
                <div className="screenshot-info" style={{ padding: '8px' }}>
                  {screenshot.pageName && (
                    <div className="screenshot-page-name" style={{ fontSize: '12px', color: '#64748b', marginBottom: '4px' }}>
                      📄 {screenshot.pageName}
                    </div>
                  )}

                  <input
                    type="text"
                    className="screenshot-title"
                    value={screenshot.title || ''}
                    onChange={(e) => handleUpdateScreenshot(index, 'title', e.target.value)}
                    placeholder="截图标题"
                    disabled={isLocked}
                    style={{ fontWeight: 600, width: '100%', marginBottom: '4px', border: 'none', background: 'transparent' }}
                  />
                  {!screenshot.url.startsWith('component:') && (
                    <input
                      type="text"
                      className="screenshot-url"
                      value={screenshot.url}
                      onChange={(e) => handleUpdateScreenshot(index, 'url', e.target.value)}
                      placeholder="图片URL"
                      disabled={isLocked}
                      style={{ fontSize: '11px', color: '#94a3b8', width: '100%', marginBottom: '4px', border: 'none', background: 'transparent' }}
                    />
                  )}
                  <textarea
                    className="screenshot-description"
                    value={screenshot.description || ''}
                    onChange={(e) => handleUpdateScreenshot(index, 'description', e.target.value)}
                    placeholder="添加描述..."
                    rows={2}
                    disabled={isLocked}
                    style={{ fontSize: '12px', width: '100%', resize: 'none', border: 'none', background: 'transparent', color: '#64748b' }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
});
