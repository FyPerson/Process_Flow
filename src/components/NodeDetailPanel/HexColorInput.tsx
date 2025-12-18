import { memo, useState, useEffect, useCallback } from 'react';

interface HexColorInputProps {
    value: string;
    onChange: (color: string) => void;
    fontSize?: string;
}

/**
 * 十六进制颜色输入组件
 * - 显示锁定的 # 前缀
 * - 用户只需输入 6 位十六进制颜色值
 * - 支持颜色选择器和手动输入
 */
export const HexColorInput = memo(function HexColorInput({
    value,
    onChange,
    fontSize = '13px',
}: HexColorInputProps) {
    // 移除 # 号，只保留颜色值部分
    const getColorValue = (color: string) => color.replace('#', '').toUpperCase();

    const [inputValue, setInputValue] = useState(() => getColorValue(value));

    // 当外部 value 改变时同步
    useEffect(() => {
        setInputValue(getColorValue(value));
    }, [value]);

    // 验证并格式化颜色值
    const normalizeHexColor = useCallback((hex: string): string => {
        // 移除所有非十六进制字符
        const cleaned = hex.replace(/[^0-9A-Fa-f]/g, '').toUpperCase();

        // 限制最多 6 个字符
        const truncated = cleaned.slice(0, 6);

        return truncated;
    }, []);

    // 处理输入变化
    const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const newValue = normalizeHexColor(e.target.value);
        setInputValue(newValue);

        // 只有当输入完整的 6 位颜色值时才触发 onChange
        if (newValue.length === 6) {
            onChange(`#${newValue}`);
        }
    };

    // 处理失焦 - 补全颜色值
    const handleBlur = () => {
        let finalValue = inputValue;

        // 如果长度不足 6 位，用 0 补全
        if (finalValue.length < 6) {
            finalValue = finalValue.padEnd(6, '0');
            setInputValue(finalValue);
            onChange(`#${finalValue}`);
        }
    };

    // 处理颜色选择器变化
    const handleColorPickerChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const newColor = e.target.value;
        onChange(newColor);
    };

    return (
        <div className="color-picker-container">
            <input
                type="color"
                value={value}
                onChange={handleColorPickerChange}
            />
            <div
                style={{
                    display: 'flex',
                    alignItems: 'center',
                    backgroundColor: '#ffffff',
                    border: '1px solid #e2e8f0',
                    borderRadius: '4px',
                    overflow: 'hidden',
                    flex: 1,
                }}
            >
                {/* 锁定的 # 前缀 */}
                <span
                    style={{
                        fontSize,
                        color: '#64748b',
                        fontFamily: 'monospace',
                        fontWeight: 600,
                        userSelect: 'none',
                        backgroundColor: '#f1f5f9',
                        padding: '4px 6px',
                        borderRight: '1px solid #e2e8f0',
                    }}
                >
                    #
                </span>
                {/* 颜色值输入框 */}
                <input
                    type="text"
                    value={inputValue}
                    onChange={handleInputChange}
                    onBlur={handleBlur}
                    maxLength={6}
                    style={{
                        fontSize,
                        color: '#1e293b',
                        fontFamily: 'monospace',
                        fontWeight: 500,
                        border: 'none',
                        background: 'transparent',
                        outline: 'none',
                        width: '55px',
                        padding: '4px 6px',
                        textTransform: 'uppercase',
                        letterSpacing: '0.5px',
                    }}
                    placeholder="FFFFFF"
                />
            </div>
        </div>
    );
});

export default HexColorInput;
