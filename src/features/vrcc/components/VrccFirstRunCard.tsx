import { useTranslation } from 'react-i18next';

import { Button } from '@/ui/shadcn/button';
import { Dialog, DialogContent, DialogTitle } from '@/ui/shadcn/dialog';

/**
 * 首连引导卡片。
 *
 * 只讲三件玩家不看就猜不到的事：星遇同频是什么、连接才能看到什么、
 * 以及**同意发生在官网**——我们只是把玩家送过去，条款与授权都在那边完成。
 *
 * 刻意不写「连接即表示同意」：那句话不成立，同意是在 vrcc.cc 的同意页上
 * 点的。也不承诺连接之后能看到什么具体内容——服务端版本不同，能给的字段
 * 也不一样。
 */
export function VrccFirstRunCard({
    open,
    onStart,
    onDismiss
}: {
    open: boolean;
    /** 「现在连接」：记为看过，并跳到「我的」页。 */
    onStart: () => void;
    /** 「稍后」/ 关闭 / Esc：记为延后，不再自动弹。 */
    onDismiss: () => void;
}) {
    const { t } = useTranslation();

    return (
        <Dialog
            open={open}
            onOpenChange={(next) => {
                if (!next) onDismiss();
            }}
        >
            <DialogContent showCloseButton={false} className="sm:max-w-md">
                <div className="flex flex-col gap-3">
                    <DialogTitle className="text-base leading-snug font-semibold">
                        {t('vrcc.first_run.title')}
                    </DialogTitle>

                    <div className="text-muted-foreground flex flex-col gap-2 text-xs leading-relaxed">
                        <p>{t('vrcc.first_run.what')}</p>
                        <p>{t('vrcc.first_run.why')}</p>
                        {/* 同意在官网完成，这一句必须说在前面：不能让人以为
                            点了「现在连接」就等于同意了什么。 */}
                        <p>{t('vrcc.first_run.consent')}</p>
                    </div>

                    <div className="mt-1 flex items-center justify-end gap-2">
                        <Button variant="ghost" size="sm" onClick={onDismiss}>
                            {t('vrcc.first_run.later')}
                        </Button>
                        <Button size="sm" onClick={onStart}>
                            {t('vrcc.first_run.start')}
                        </Button>
                    </div>
                </div>
            </DialogContent>
        </Dialog>
    );
}
