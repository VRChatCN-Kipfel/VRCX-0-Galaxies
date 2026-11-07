//! 把 vrcc 后台轮询绑定到「VRCX 账号登录状态」上的装配。
//!
//! 它跟的是「谁登录了 VRCX」，不是「VRChat 游戏进程在不在」：令牌属于账号，
//! 与游戏状态无关，所以只有登出（或换号）才停任务。理由见
//! `DesktopVrccRuntime::spawn_background_poll` 的「为什么不看游戏是否在运行」。
//!
//! 登录就绪时起一个属于该账号的任务；账号变化或登出时把上一代的 stop 置位，
//! 让它在下一次醒来时自行退出。旧任务不立即中止而是「下次醒来退出」，是因为
//! `TaskSupervisor` 不对外暴露单个任务的句柄——只能靠任务自己看信号。

use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Mutex,
};

use vrcx_0_application_core::{
    RuntimeAuthScope, RuntimeAuthScopeObserver, RuntimeAuthScopeSnapshot, RuntimeEventSink,
    TaskSpawnOutcome, TaskSupervisor,
};
use vrcx_0_core::OwnerId;

use crate::notification::NotificationDispatcher;
use crate::vrcc::DesktopVrccRuntime;

/// 「当前登录状态 × 是否已有任务」应当触发的动作。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum VrccPollAction {
    /// 已登录且已有任务：重起一次。
    Restart,
    /// 已登录但没有任务：起一个。
    Start,
    /// 未登录但有任务：停掉。
    Stop,
    /// 两边都空：不动。
    Idle,
}

/// 纯函数：把登录状态与「当前是否有任务」映射成要执行的动作。
///
/// 抽成纯函数只为可单测：四个分支互斥且无副作用，`reconcile` 只负责执行。
/// 空字符串与纯空白都按「未登录」处理，与调用方传 `None` 等价。
pub(crate) fn decide(signed_in_as: Option<&str>, has_active: bool) -> VrccPollAction {
    let signed_in = matches!(signed_in_as.map(str::trim), Some(id) if !id.is_empty());
    match (signed_in, has_active) {
        (true, true) => VrccPollAction::Restart,
        (true, false) => VrccPollAction::Start,
        (false, true) => VrccPollAction::Stop,
        (false, false) => VrccPollAction::Idle,
    }
}

pub(crate) struct VrccPollBinding {
    runtime: Arc<DesktopVrccRuntime>,
    /// 站外提醒走通知分发器，和 VRChat 活动同一条投递链。
    ///
    /// 早先这里放的是 `DesktopNotifier`，直接调 `show()`——那等于绕过了
    /// 免打扰、隐私锁、通道偏好、图标解析和有序投递。现在没有第二条路径。
    dispatcher: Arc<NotificationDispatcher>,
    event_sink: Arc<dyn RuntimeEventSink>,
    supervisor: TaskSupervisor,
    /// 起任务时用它读出当前登录账号。
    auth_scope: RuntimeAuthScope,
    /// 当前那代任务的停止开关；`None` 表示没有任务在跑。
    active: Mutex<Option<Arc<AtomicBool>>>,
}

impl VrccPollBinding {
    /// 按当前登录状态对齐：该起就起，该停就停。
    fn reconcile(&self, signed_in_as: Option<&str>) {
        let mut active = match self.active.lock() {
            Ok(active) => active,
            Err(error) => error.into_inner(),
        };

        match decide(signed_in_as, active.is_some()) {
            // 已登录且已有任务：重起一次。任务本身很轻，而跨代复用会让
            // owner 与令牌的一致性难以推理。
            VrccPollAction::Restart => {
                self.stop(&mut active);
                drop(active);
                self.spawn();
            }
            VrccPollAction::Start => {
                drop(active);
                self.spawn();
            }
            VrccPollAction::Stop => {
                self.stop(&mut active);
            }
            VrccPollAction::Idle => {}
        }
    }

    fn spawn(&self) {
        let Some(owner) = self.current_owner() else {
            return;
        };
        let stop = Arc::new(AtomicBool::new(false));
        let outcome = self.runtime.spawn_background_poll(
            &self.supervisor,
            Arc::clone(&self.dispatcher),
            Arc::clone(&self.event_sink),
            owner.clone(),
            Arc::clone(&stop),
        );
        match outcome {
            TaskSpawnOutcome::Scheduled => {
                tracing::info!(owner = %owner.as_str(), "vrcc: background poll scheduled");
                if let Ok(mut active) = self.active.lock() {
                    *active = Some(stop);
                }
            }
            other => {
                tracing::warn!(?other, "vrcc: background poll not scheduled");
            }
        }
    }

    fn stop(&self, active: &mut Option<Arc<AtomicBool>>) {
        if let Some(stop) = active.take() {
            stop.store(true, Ordering::Release);
            tracing::info!("vrcc: background poll asked to stop (account change)");
        }
    }

    fn current_owner(&self) -> Option<OwnerId> {
        let snapshot = self.auth_scope.snapshot();
        snapshot
            .active
            .then(|| OwnerId::new(snapshot.current_user_id))
    }
}

/// 登录状态变化的观察者：转给 `VrccPollBinding` 对齐任务。
struct VrccPollObserver {
    binding: Arc<VrccPollBinding>,
}

impl RuntimeAuthScopeObserver for VrccPollObserver {
    fn runtime_auth_scope_changed(&self, snapshot: &RuntimeAuthScopeSnapshot) {
        let user = snapshot.active.then_some(snapshot.current_user_id.as_str());
        self.binding.reconcile(user);
    }
}

/// 装配：建立绑定并挂到登录状态上。
///
/// `add_observer` 会立刻按当前状态回调一次：已登录时任务这时就起来了。
pub(crate) fn install<E>(
    runtime: Arc<DesktopVrccRuntime>,
    dispatcher: Arc<NotificationDispatcher>,
    supervisor: TaskSupervisor,
    auth_scope: RuntimeAuthScope,
    event_sink: Arc<E>,
) where
    E: RuntimeEventSink + 'static,
{
    let binding = Arc::new(VrccPollBinding {
        runtime,
        dispatcher,
        event_sink,
        supervisor,
        // 当前这一代任务：换账号时把上一代的 stop 置位，让它自行退出。
        active: Mutex::new(None),
        auth_scope: auth_scope.clone(),
    });
    auth_scope.add_observer(Arc::new(VrccPollObserver { binding }));
}

#[cfg(test)]
mod tests {
    use super::{decide, VrccPollAction};

    #[test]
    fn signed_in_with_existing_task_restarts() {
        assert_eq!(decide(Some("usr_1"), true), VrccPollAction::Restart);
    }

    #[test]
    fn signed_in_without_task_starts() {
        assert_eq!(decide(Some("usr_1"), false), VrccPollAction::Start);
    }

    #[test]
    fn signed_out_with_task_stops() {
        assert_eq!(decide(None, true), VrccPollAction::Stop);
    }

    #[test]
    fn signed_out_without_task_is_idle() {
        assert_eq!(decide(None, false), VrccPollAction::Idle);
    }

    #[test]
    fn blank_identity_is_treated_as_signed_out() {
        assert_eq!(decide(Some("   "), true), VrccPollAction::Stop);
        assert_eq!(decide(Some(""), false), VrccPollAction::Idle);
        assert_eq!(decide(Some("  "), false), VrccPollAction::Idle);
    }

    #[test]
    fn surrounding_whitespace_still_counts_as_signed_in() {
        assert_eq!(decide(Some(" usr_1 "), false), VrccPollAction::Start);
    }
}
