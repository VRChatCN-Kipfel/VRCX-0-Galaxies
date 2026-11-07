// SPDX-License-Identifier: MPL-2.0

import { useCallback, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { openExternalLink } from '@/services/shellIntegrationService';
import { toast } from '@/services/toastService';

/**
 * 打开外链，并给出**可感知的反馈**。
 *
 * ## 为什么需要它
 *
 * 原来的写法是这样的（vrcc 里有 6 处）：
 * ```js
 * void openExternalLink(href).catch((error) => {
 *     console.error('vrcc: failed to open notice link', error);
 * });
 * ```
 * 成功时**什么都不做**，失败时只写控制台。玩家看到的唯一信号是浏览器自己
 * 跳出来——那要几百毫秒到一两秒，浏览器已在后台或开在新标签页时甚至完全
 * 察觉不到。
 *
 * 反馈里那句「拿触摸板抖了一下，给俺弹了几个窗口」就是从这里来的：点下去
 * 没有任何回应，玩家无法判断是没点上还是已经打开了，只能再点一次。
 *
 * ## 两件一起做
 *
 * 1. **即时状态**：点下去立刻 `pending`，按钮据此显示 spinner 或禁用。
 *    这解决「我到底点上没点上」。
 * 2. **结果反馈**：成功给一条轻提示，失败给出可读的错误。
 *
 * 只做第 1 件也能缓解，但「已经交给浏览器了」这个结论玩家仍然看不到；
 * 只做第 2 件又会有几百毫秒的空窗。两件一起才完整。
 *
 * ## 关于「成功」的措辞
 *
 * `openExternalLink` 内部是 `await commands.appOpenLink(url)`，**resolve 只
 * 代表已经交给系统**，不代表浏览器真的把页面打开了。所以文案写「已在浏览器
 * 打开」而非「已打开」——承诺界面做不到的事，后面要还的。
 *
 * ## 并发
 *
 * 用 ref 计数而不是布尔：同一组件里可能有多个链接（比如公告里连着几个），
 * 一个还在飞时另一个点击不该被吞掉，但按钮状态要能正确回到 idle。
 */
export function useOpenExternalLink() {
    const { t } = useTranslation();
    const [pending, setPending] = useState(false);
    // 用计数而不是布尔：多个链接同时点开时，最后一个结束才回到 idle。
    const inFlight = useRef(0);

    const open = useCallback(
        (href: string) => {
            inFlight.current += 1;
            setPending(true);

            void openExternalLink(href)
                .then(() => {
                    toast.add({
                        type: 'success',
                        title: t('vrcc.open_link.opened'),
                        // 轻提示：这是一次成功的副作用，不需要玩家处理任何东西。
                        timeout: 2000
                    });
                })
                .catch((error: unknown) => {
                    console.error(
                        '[vrcc] failed to open external link:',
                        error
                    );
                    // 以前这条只写控制台，玩家完全不知道链接没打开。
                    toast.add({
                        type: 'error',
                        title: t('vrcc.open_link.failed')
                    });
                })
                .finally(() => {
                    inFlight.current -= 1;
                    if (inFlight.current <= 0) {
                        inFlight.current = 0;
                        setPending(false);
                    }
                });
        },
        [t]
    );

    return { open, pending };
}
