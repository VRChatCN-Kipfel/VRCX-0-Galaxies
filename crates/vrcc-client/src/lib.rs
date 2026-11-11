// SPDX-License-Identifier: MPL-2.0

//! 星遇同频（vrcc.cc）原生集成。
//!
//! 只使用官方开放的 `/api/v1/`，不复刻网页端的未公开接口。
//!
//! 分三层：
//! - `throttle`：限流窗口、每接口最小间隔（纯逻辑，可单测）
//! - `client`：唯一的网络出口，硬拦绝对路径，处理错误码与退避
//! - `session`：令牌与连接状态的持有者，跨命令共享
//!
//! **日配额一律以服务端的 `RateLimit-*` 为准，不落盘、不本地推算。**
//! 官方没有「查询额度」的接口，那组头只在你发请求的那一刻回一次；而它的时间
//! 基准是北京时间零点，本地只能拿到本机时区的自然日，两套时钟对非 UTC+8 的
//! 玩家必然错开。自己记账看着像兜底，实际是在编一个会误导人的数。
//!
//! # 为什么是独立 crate
//!
//! 这个 crate 连同 [`vrcx_0_vrcc_contracts`] 是给外部消费者复用的部分：
//! 整包 MPL-2.0，依赖闭包里**没有任何本仓库的 GPL-only crate**。在此之
//! 前它住在 `vrcx-0-integrations` 里，依赖 `vrcx-0-core`（为了一行
//! `with_remote_dns`）和 `vrcx-0-contracts`（它自己又依赖 `vrcx-0-core` 与
//! `vrcx-0-runtime-event`），所以外部即使拿到 MPL 授权也编不过。
//!
//! 现在只剩 std / reqwest / serde / serde_json / tokio / tracing / thiserror
//! 与上面那个契约 crate。宿主相关的东西（任务调度、登录身份、事件出口）不在
//! 这里，由调用方注入——本 crate 不认识 `OwnerId`，也不认识任何 Tauri 类型。

pub mod client;
pub mod session;
pub mod throttle;

pub use client::{
    QuotaBucket, RateHeaders, ServerQuota, VrccClient, VrccClientState, VrccError, VrccLocalUsage,
};
pub use session::{VrccSession, VrccSessionSnapshot};
pub use throttle::{
    backoff_for, now_millis, RateLimiter, DEVICE_CODE_DAILY_LIMIT, NOTIFICATIONS_MIN_GAP,
    PERSONAL_DAILY_LIMIT, WINDOW_LIMIT,
};
pub use vrcx_0_vrcc_contracts::{
    is_dev_client, resolve_client_id, ErrorDetail, ErrorLayer, HttpDetail, LocalThrottle,
    TransportKind, VRCC_API_BASE, VRCC_APP_NAME, VRCC_BUILD_CLIENT, VRCC_DEFAULT_CLIENT,
    VRCC_DEV_CLIENT,
};
