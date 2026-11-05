import {
    isAnnouncementCacheFresh,
    useVrccAnnouncementCache
} from './vrccAnnouncementCache';
import type { VrccAnnouncements } from './vrccApi';
import { vrccApi } from './vrccApi';

/**
 * 拉公告，**带缓存与并发去重**。
 *
 * 两个消费点（登录后的全局 `force`、进页面时的 `pop`/`bar`）都调这里，
 * 所以同一次启动最多发一次请求。
 *
 * ## 三种情况
 *
 * | 情况 | 行为 |
 * |---|---|
 * | 缓存新鲜（1 分钟内） | 直接返回缓存，**不发请求** |
 * | 已有一个请求在飞 | 等那一个，**不再发** |
 * | 缓存过期/没有 | 发请求，成功后写缓存 |
 *
 * ## 返回 `null` 的语义
 *
 * 服务端旧版本没有这个接口时返回 `null`（Rust 侧把 404 归成 `None`），
 * 表示「这个服务器没有公告功能」，**不是失败**。所以 `null` 也要写进缓存
 * ——否则每次进页面都会重试一个永远 404 的接口。
 *
 * ## 失败时怎么办
 *
 * 抛出去，让调用方自己决定（两边都只 `console.error`：公告是附加信息，
 * 不该在启动阶段报错）。**失败不写缓存**：写一个空结果进去等于把「拉失败」
 * 记成「没有公告」，接下来一分钟内的第二个消费点会以为真的没有。
 */
export async function loadAnnouncements(options?: {
    /** 无视缓存强制重新拉（`force` 确认后用它）。 */
    force?: boolean;
}): Promise<VrccAnnouncements | null> {
    const store = useVrccAnnouncementCache.getState();

    if (!options?.force) {
        // 注意判的是 `fetchedAt`，不是 `data`：`null`（接口不存在）也是
        // 一份有效结论，同样可以复用。
        if (isAnnouncementCacheFresh(store.fetchedAt)) {
            return store.data;
        }
        // 已有请求在飞：复用它。这是「一次启动只发一次请求」的关键——
        // 登录后的宿主和页面几乎同时挂载，没有这一步它们会各发一次。
        if (store.inFlight) return store.inFlight;
    }

    const request = vrccApi.announcements();
    store.setInFlight(request);

    try {
        const data = await request;
        // 写在 await 之后：失败时不写缓存（见上）。
        useVrccAnnouncementCache.getState().setData(data, Date.now());
        return data;
    } finally {
        // 无论成败都要清掉 inFlight，否则一次失败会让后续调用永远等一个
        // 已经结束的 promise。
        useVrccAnnouncementCache.getState().setInFlight(null);
    }
}
