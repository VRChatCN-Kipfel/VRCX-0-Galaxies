// SPDX-License-Identifier: MPL-2.0

import { useLayoutEffect, useRef, useState } from 'react';

import { cn } from '@/lib/utils';

/** 通知中心的来源维度：VRChat 自己的通知，和站外（星遇同频）。 */
export type NotificationSourceKey = 'vrchat' | 'vrcc';

export type NotificationSourceOption = {
    key: NotificationSourceKey;
    /** 已经翻译好的标签（组件不认识 i18n）。 */
    label: string;
    /** 该来源的未读数；0 时不显示数字，只留标签。 */
    count: number;
};

type NotificationSourceCapsuleProps = {
    value: NotificationSourceKey;
    options: readonly NotificationSourceOption[];
    onChange(key: NotificationSourceKey): void;
    /** 屏幕阅读器用的组名（例如「通知来源」）。 */
    label: string;
    className?: string;
};

/**
 * 来源胶囊：两段式滑块。
 *
 * **为什么用实测几何而不是百分比**：两段的标签长度不同（「VRChat」vs
 * 「星遇同频」），按 `100% / 段数` 推滑块会在切换时对不齐，越长的标签误差
 * 越明显。这里量真实 `offsetLeft` / `offsetWidth`，标签怎么变都贴着走。
 *
 * 在 jsdom 里这两个值恒为 0，此时**不渲染滑块**——胶囊本身仍然是可点的
 * 两段按钮，只是少了动画层。
 */
export function NotificationSourceCapsule({
    value,
    options,
    onChange,
    label,
    className
}: NotificationSourceCapsuleProps) {
    const containerRef = useRef<HTMLDivElement>(null);
    const [indicator, setIndicator] = useState<{
        left: number;
        width: number;
    } | null>(null);
    const activeIndex = Math.max(
        0,
        options.findIndex((option) => option.key === value)
    );

    useLayoutEffect(() => {
        const container = containerRef.current;
        if (!container) {
            return;
        }
        const buttons = container.querySelectorAll<HTMLElement>('[role="tab"]');
        const button = buttons[activeIndex];
        if (!button) {
            setIndicator(null);
            return;
        }
        setIndicator({ left: button.offsetLeft, width: button.offsetWidth });
    }, [activeIndex, options.length]);

    return (
        <div
            ref={containerRef}
            role="tablist"
            aria-label={label}
            className={cn(
                'border-border/60 bg-muted/40 relative grid auto-cols-fr grid-flow-col gap-1 rounded-full border p-1',
                className
            )}
        >
            {indicator && indicator.width > 0 ? (
                <span
                    aria-hidden="true"
                    className="bg-background pointer-events-none absolute inset-y-1 rounded-full shadow-sm transition-[left,width] duration-200"
                    style={{ left: indicator.left, width: indicator.width }}
                />
            ) : null}
            {options.map((option) => {
                const selected = option.key === value;
                return (
                    <button
                        key={option.key}
                        type="button"
                        role="tab"
                        aria-selected={selected}
                        onClick={() => {
                            if (!selected) {
                                onChange(option.key);
                            }
                        }}
                        className={cn(
                            'relative z-10 flex items-center justify-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition-colors',
                            selected
                                ? 'text-foreground'
                                : 'text-muted-foreground hover:text-foreground'
                        )}
                    >
                        <span className="truncate">{option.label}</span>
                        {option.count > 0 ? (
                            <span className="text-[11px] tabular-nums opacity-80">
                                {option.count}
                            </span>
                        ) : null}
                    </button>
                );
            })}
        </div>
    );
}
