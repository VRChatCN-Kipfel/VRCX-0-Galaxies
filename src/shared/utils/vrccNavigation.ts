import { publishNavNavigateRequested } from '@/shared/events/navLayoutEvents';

/**
 * 星遇同频页签的路由与页签名。
 *
 * 与 `navMenuModel.ts` 的 `routePathByName.vrcc`、`useVrccController` 的
 * `VrccTab` 是同一组值。放在 `shared` 而不是某个 feature 里：调用方既有
 * 页面（首连引导要跳「我的」），也有后台服务（通知中心要跳「提醒」），
 * 而 `services` 不该反向依赖 `features`。
 */
const VRCC_ROUTE = '/vrcc';

/**
 * 可跳转的页签名。
 *
 * 必须和 `useVrccController` 的 `VrccTab` 完全一致——少一个（例如 `crossings`）
 * 不会在别处报错，只会在真正要跳过去的时候才发现跳不了。导览会依次跳到
 * 每一个页签，所以这里必须是全集。
 */
export type VrccTabTarget =
    | 'maps'
    | 'notifications'
    | 'mutuals'
    | 'crossings'
    | 'me';

/**
 * 跳到星遇同频的某个页签。
 *
 * 页签通过查询参数传，不另开事件：跳转本来就带 search，页面自己读它即可，
 * 少一条跨模块的事件契约。
 */
export function openVrccTab(tab: VrccTabTarget): void {
    publishNavNavigateRequested(`${VRCC_ROUTE}?tab=${tab}`);
}
