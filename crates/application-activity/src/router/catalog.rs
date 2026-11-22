use vrcx_0_contracts::activity::ActivityKind;

use super::definitions;
use super::types::{ActivityCategory, ActivityTypeDefinition};

pub fn activity_type_definitions() -> Vec<ActivityTypeDefinition> {
    definitions::activity_type_definitions()
}

/// 一种活动类型在 catalog 里的定义。
///
/// 给「手里只有一个 `ActivityKind`、要问它归哪一档」的调用方用。
pub fn activity_type_definition(kind: ActivityKind) -> ActivityTypeDefinition {
    definitions::activity_type_definition(kind)
}

/// 一种活动类型属于哪个大类。
///
/// 投递方（例如星遇提醒的 `ActivityDelivery`）用它取 category，而不是自己
/// 再写一份：catalog 改了这里就跟着改，不会出现「设置页归 A、投递归 B」。
pub fn activity_category(kind: ActivityKind) -> ActivityCategory {
    activity_type_definition(kind).category
}
