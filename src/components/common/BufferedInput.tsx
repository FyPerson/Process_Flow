import React, { useState, useEffect, useRef } from 'react';

interface BufferedInputProps
    extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'onChange'> {
    value: string;
    onCommit: (value: string) => void;
    className?: string;
    placeholder?: string;
}

export const BufferedInput: React.FC<BufferedInputProps> = ({
    value: initialValue,
    onCommit,
    className,
    placeholder,
    ...props
}) => {
    const [value, setValue] = useState(initialValue);
    const [isComposing, setIsComposing] = useState(false);
    const isDirty = useRef(false);

    useEffect(() => {
        // Only update local value from props if we are NOT currently editing (focused) ?
        // Actually, usually we want to sync if external source changes.
        // But for a buffered input, if the user is typing, we might not want to overwrite their work.
        // However, if the user switches tables, we MUST update.
        // Let's assume controlled component behavior: sync on prop change.
        setValue(initialValue);
        isDirty.current = false;
    }, [initialValue]);

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        setValue(e.target.value);
        isDirty.current = true;
    };

    const handleBlur = () => {
        if (isDirty.current) {
            onCommit(value);
            isDirty.current = false;
        }
    };

    const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'Enter' && !isComposing) {
            // Prevent form submission if any
            e.preventDefault();
            e.currentTarget.blur(); // This will trigger handleBlur
        }
        if (props.onKeyDown) {
            props.onKeyDown(e);
        }
    };

    const handleCompositionStart = () => {
        setIsComposing(true);
    };

    const handleCompositionEnd = () => {
        setIsComposing(false);
    };

    return (
        <input
            {...props}
            className={className}
            value={value}
            onChange={handleChange}
            onBlur={handleBlur}
            onKeyDown={handleKeyDown}
            onCompositionStart={handleCompositionStart}
            onCompositionEnd={handleCompositionEnd}
            placeholder={placeholder}
        />
    );
};
