import React, { useState, useMemo, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Node as FlowNode } from '@xyflow/react';
import { FlowNodeData } from '../../types/flow';

interface NodeSelectorProps {
    currentNodeId: string;
    allNodes: FlowNode<FlowNodeData>[];
    onSelect: (nodeId: string) => void;
    excludeIds?: string[]; // IDs to exclude from the list (e.g. already related nodes)
}

export function NodeSelector({ currentNodeId, allNodes, onSelect, excludeIds = [] }: NodeSelectorProps) {
    const [isOpen, setIsOpen] = useState(false);
    const [searchTerm, setSearchTerm] = useState('');
    const wrapperRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLInputElement>(null);
    const [position, setPosition] = useState<{ top: number, left: number, width: number } | null>(null);

    // Calculate position
    const updatePosition = () => {
        if (wrapperRef.current) {
            const rect = wrapperRef.current.getBoundingClientRect();
            // Position below the button
            setPosition({
                top: rect.bottom + window.scrollY + 4, // 4px gap
                left: rect.left + window.scrollX,
                width: rect.width
            });
        }
    };

    // Close when clicking outside
    useEffect(() => {
        function handleClickOutside(event: MouseEvent) {
            // Check if click is on the button wrapper
            if (wrapperRef.current && wrapperRef.current.contains(event.target as globalThis.Node)) {
                return;
            }

            // Check if click is inside the portal dropdown
            // Note: The portal content is not inside wrapperRef in DOM structure but we can check target
            const dropdown = document.querySelector('.selector-dropdown-portal');
            if (dropdown && dropdown.contains(event.target as globalThis.Node)) {
                return;
            }

            setIsOpen(false);
        }

        if (isOpen) {
            document.addEventListener("mousedown", handleClickOutside);
            window.addEventListener('resize', updatePosition);
            window.addEventListener('scroll', updatePosition, true); // Capture scroll to handle parent scrolling
        }

        return () => {
            document.removeEventListener("mousedown", handleClickOutside);
            window.removeEventListener('resize', updatePosition);
            window.removeEventListener('scroll', updatePosition, true);
        };
    }, [isOpen]);

    // Update position when opening
    useEffect(() => {
        if (isOpen) {
            updatePosition();
            // Auto-focus input when opened
            setTimeout(() => inputRef.current?.focus(), 50);
        }
    }, [isOpen]);

    const availableNodes = useMemo(() => {
        return allNodes.filter(node =>
            node.id !== currentNodeId &&
            !excludeIds.includes(node.id) &&
            node.type !== 'group' &&
            String(node.data.label || node.data.name || node.id).toLowerCase().includes(searchTerm.toLowerCase())
        );
    }, [allNodes, currentNodeId, excludeIds, searchTerm]);

    return (
        <div className="node-selector-wrapper" ref={wrapperRef}>
            <button
                className="add-relation-btn"
                onClick={() => setIsOpen(!isOpen)}
            >
                <span style={{ marginRight: '4px', fontSize: '16px', lineHeight: '1' }}>+</span> 添加关联节点
            </button>

            {isOpen && position && createPortal(
                <div
                    className="selector-dropdown selector-dropdown-portal"
                    style={{
                        position: 'fixed', // Use fixed to stick to viewport, avoiding parent overflow clipping
                        top: position.top - window.scrollY, // Adjust if using fixed
                        left: position.left - window.scrollX,
                        width: position.width,
                        zIndex: 9999, // Ensure it's on top of everything
                        // Keep other styles from CSS class
                    }}
                >
                    <input
                        ref={inputRef}
                        type="text"
                        className="selector-search-input"
                        placeholder="搜索节点名称..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                    />
                    <div className="nodes-list">
                        {availableNodes.length === 0 ? (
                            <div className="nodes-list-empty">无匹配节点</div>
                        ) : (
                            availableNodes.map(node => (
                                <div
                                    key={node.id}
                                    className="nodes-list-item"
                                    onClick={() => {
                                        onSelect(node.id);
                                        setIsOpen(false);
                                        setSearchTerm('');
                                    }}
                                >
                                    {String(node.data.label || node.data.name || node.id)}
                                </div>
                            ))
                        )}
                    </div>
                </div>,
                document.body
            )}
        </div>
    );
}
