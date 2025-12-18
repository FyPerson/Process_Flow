import './styles.css';

export function ContractTightThumbnail() {
  return (
    <div className="contract-tight-thumbnail">
      <div className="thumbnail-header">
        <div className="thumbnail-title">（紧密型单项）收入合同起拟</div>
        <div className="thumbnail-actions">
          <div className="thumbnail-btn">保存</div>
          <div className="thumbnail-btn primary">提交</div>
        </div>
      </div>
      <div className="thumbnail-content">
        <div className="thumbnail-section">
          <div className="thumbnail-section-title">合同信息</div>
          <div className="thumbnail-form-preview">
            <div className="thumbnail-form-row">
              <div className="thumbnail-field"></div>
              <div className="thumbnail-field"></div>
              <div className="thumbnail-field"></div>
            </div>
            <div className="thumbnail-form-row">
              <div className="thumbnail-field"></div>
              <div className="thumbnail-field"></div>
            </div>
          </div>
        </div>
        <div className="thumbnail-section">
          <div className="thumbnail-section-title">客户信息</div>
          <div className="thumbnail-form-preview">
            <div className="thumbnail-form-row">
              <div className="thumbnail-field"></div>
              <div className="thumbnail-field"></div>
            </div>
            <div className="thumbnail-form-row">
              <div className="thumbnail-field"></div>
              <div className="thumbnail-field"></div>
            </div>
          </div>
        </div>
        <div className="thumbnail-section">
          <div className="thumbnail-section-title">合同内容</div>
          <div className="thumbnail-form-preview">
            <div className="thumbnail-form-row">
              <div className="thumbnail-field"></div>
              <div className="thumbnail-field"></div>
              <div className="thumbnail-field"></div>
            </div>
          </div>
        </div>
        <div className="thumbnail-section">
          <div className="thumbnail-section-title">交付信息（紧密型）</div>
          <div className="thumbnail-form-preview">
            <div className="thumbnail-form-row">
              <div className="thumbnail-field"></div>
              <div className="thumbnail-field"></div>
            </div>
          </div>
        </div>
        <div className="thumbnail-section">
          <div className="thumbnail-section-title">其他</div>
          <div className="thumbnail-form-preview">
            <div className="thumbnail-form-row">
              <div className="thumbnail-field"></div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
