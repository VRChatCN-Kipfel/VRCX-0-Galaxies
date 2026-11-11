// SPDX-License-Identifier: MPL-2.0

//! 最小示例：只用 `vrcx-0-vrcc-client` 向 vrcc.cc 发一次请求。
//!
//! ```text
//! cargo run -p vrcx-0-vrcc-client --example fetch_boards
//! ```
//!
//! 这条命令**不引入 VRCX-0 的其它 crate**：编译这个 example 所需的依赖闭包只有
//! 本 crate 与 `vrcx-0-vrcc-contracts`，加上 serde / reqwest / tokio 这些公开库。
//! 这正是 issue #12 要的效果——外部消费者拿到 MPL 授权后，不需要任何 GPL 代码
//! 就能自己发请求。
//!
//! 地图榜是**开放数据**：不需要令牌、不需要审核、也不需要 `client` 之外的任何
//! 东西，所以它是最适合当「装好了吗」自测的接口。
//!
//! 传代理时把 `proxy_url` 换成自己的；不给就走直连。

use std::sync::Arc;

use vrcx_0_vrcc_client::{VrccBoardSort, VrccClient};

#[tokio::main(flavor = "current_thread")]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    // 令牌回调返回 `None`：公开接口不读它。
    let token: Arc<dyn Fn() -> Option<String> + Send + Sync> = Arc::new(|| None);
    let proxy = std::env::var("VRCC_PROXY").ok();
    // `X-Client` 只认两种前缀：登记过的 `app_…`（要审核）与 `dev-…`（只要普通
    // 权限）。随便写一串会得到 `403 client_unknown`——这不是网络问题。
    let client = VrccClient::new("dev-vrcc-client-example", token, proxy.as_deref());

    let board = client.boards(5, VrccBoardSort::Top).await?;
    println!("榜单：{} 张", board.maps.len());
    for map in &board.maps {
        println!(
            "{:<44} {:<24} 均分={:?} 名次={:?}",
            map.world,
            map.name.as_deref().unwrap_or("(无名)"),
            map.avg,
            map.rank
        );
    }
    Ok(())
}
