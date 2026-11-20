use std::sync::Arc;

use vrcx_0_application_activity::{
    ActivityActorRelation, ActivityCategory, ActivityContent, ActivityDelivery, ActivityEntry,
};
use vrcx_0_application_core::{
    ConfigStore, HostSessionGameProcessStatus, HostSessionRuntime, RuntimeEventBus, TaskSupervisor,
};
use vrcx_0_contracts::activity::ActivityKind;

use super::LocalNotificationPolicy;
use crate::game_isolation::GameIsolationRuntime;
use crate::notification::test_support::{test_local_config, TestDir};
use crate::notification::{
    NotificationDeliveryPlan, NotificationDoNotDisturbMode, NotificationDoNotDisturbRuntime,
};
use crate::privacy_lock::PrivacyLockRuntime;
use crate::RuntimeHost;

fn policy(name: &str) -> (TestDir, Arc<dyn ConfigStore>, LocalNotificationPolicy) {
    let (dir, config, policy, _isolation) = policy_with_isolation(name);
    (dir, config, policy)
}

fn policy_with_isolation(
    name: &str,
) -> (
    TestDir,
    Arc<dyn ConfigStore>,
    LocalNotificationPolicy,
    GameIsolationRuntime,
) {
    let (dir, local_config) = test_local_config(name);
    let config: Arc<dyn ConfigStore> = local_config.clone();
    let session = HostSessionRuntime::new();
    session.apply_game_process_status(HostSessionGameProcessStatus {
        is_game_running: true,
        is_steamvr_running: true,
        changed_at: "2026-10-02T00:00:00Z".into(),
    });
    let do_not_disturb = NotificationDoNotDisturbRuntime::new(
        config.clone(),
        RuntimeEventBus::new(),
        RuntimeHost::new(),
        TaskSupervisor::new(),
    )
    .unwrap();
    let privacy_lock =
        Arc::new(PrivacyLockRuntime::new(local_config, RuntimeEventBus::new(), None).unwrap());
    let isolation =
        GameIsolationRuntime::new(config.clone(), RuntimeEventBus::new(), RuntimeHost::new())
            .unwrap();
    let policy = LocalNotificationPolicy::new(
        config.clone(),
        session,
        do_not_disturb,
        privacy_lock,
        isolation.clone(),
    );
    (dir, config, policy, isolation)
}

fn desktop_delivery() -> ActivityDelivery {
    ActivityDelivery {
        entry: ActivityEntry {
            sequence: 1,
            source_id: "game-log:join".into(),
            kind: ActivityKind::OnPlayerJoined,
            category: ActivityCategory::CurrentInstance,
            created_at: "2026-10-02T00:00:00.000Z".into(),
            actor_user_id: "usr_traveler".into(),
            actor_display_name: "Traveler".into(),
            content: ActivityContent::default(),
            actor_relation: ActivityActorRelation::None,
        },
        desktop: true,
        vr: false,
        hmd: false,
        webhook: false,
        tts: false,
        widget: false,
    }
}

#[test]
fn settings_follow_config_writes() {
    let (_dir, config, policy) = policy("policy-settings");

    assert!(policy.settings().preferences.image_notifications);
    config.set_bool("imageNotifications", false).unwrap();
    assert!(!policy.settings().preferences.image_notifications);
}

#[test]
fn the_hmd_condition_follows_the_overlay_toast_setting() {
    let (_dir, config, policy) = policy("policy-hmd-condition");

    assert!(policy.hmd_allowed());
    config.set_string("overlayToast", "Game Closed").unwrap();
    assert!(!policy.hmd_allowed());
    config.set_string("overlayToast", "Always").unwrap();
    assert!(policy.hmd_allowed());
}

#[test]
fn game_isolation_keeps_desktop_toasts_but_closes_the_headset() {
    let (_dir, config, policy, isolation) = policy_with_isolation("policy-game-isolation");
    config.set_string("desktopToast", "Always").unwrap();
    config.set_string("overlayToast", "Always").unwrap();
    let delivery = ActivityDelivery {
        vr: true,
        tts: true,
        ..desktop_delivery()
    };
    config.set_bool("xsNotifications", true).unwrap();
    config.set_string("notificationTTS", "Always").unwrap();

    isolation.set_enabled(true).unwrap();
    let plan = policy.plan(&delivery, &policy.settings());

    assert!(plan.desktop);
    assert!(!plan.xs && !plan.ovrt && !plan.tts);
    assert!(!policy.hmd_allowed());
    isolation.set_enabled(false).unwrap();
    assert!(policy.hmd_allowed());
}

#[test]
fn do_not_disturb_pauses_every_local_surface() {
    let (_dir, config, policy) = policy("policy-dnd");
    config.set_string("desktopToast", "Always").unwrap();
    config.set_string("overlayToast", "Always").unwrap();

    assert!(policy.plan(&desktop_delivery(), &policy.settings()).desktop);
    policy
        .do_not_disturb
        .set_mode(NotificationDoNotDisturbMode::UntilStopped)
        .unwrap();
    assert!(!policy
        .plan(&desktop_delivery(), &policy.settings())
        .has_local_transport());
    assert!(!policy.hmd_allowed());
}

#[test]
fn game_isolation_also_narrows_plans_built_outside_the_policy() {
    // 星遇同频的站外提醒自己算计划（不看游戏状态），再交给这一步收窄。
    let (_dir, _config, policy, isolation) = policy_with_isolation("policy-isolation-external");

    let external = NotificationDeliveryPlan {
        desktop: true,
        xs: true,
        ovrt: true,
        ovrt_hud: true,
        ovrt_wrist: false,
        tts: true,
    };
    assert!(external.has_local_transport());

    // 没有隔离时原样放行——同一个计划原封不动返回。
    assert_eq!(policy.restrict_for_game_isolation(external), external);

    isolation.set_enabled(true).unwrap();
    let narrowed = policy.restrict_for_game_isolation(external);
    // 整份计划相等 = 六列全部钉住：桌面留着，xs/ovrt/ovrt_hud/ovrt_wrist/tts 全关。
    // `NotificationDeliveryPlan` 的 `Default` 是六列全 false（`delivery.rs:88`），
    // 所以这条同时蕴含上游那版逐列写的四个 `!` 断言，且多钉一个 `ovrt_wrist`。
    assert_eq!(
        narrowed,
        NotificationDeliveryPlan {
            desktop: true,
            ..NotificationDeliveryPlan::default()
        },
        "隔离时站外提醒只留桌面一路"
    );
    // 桌面这一路必须还在，否则站外提醒会整条消失。
    assert!(narrowed.has_local_transport());

    isolation.set_enabled(false).unwrap();
    assert_eq!(policy.restrict_for_game_isolation(external), external);
}
