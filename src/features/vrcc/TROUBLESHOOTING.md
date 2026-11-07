<!-- SPDX-License-Identifier: MPL-2.0 -->

# 星遇同频（vrcc）排查指南

给帮忙复现问题的人看。目标是：**只靠日志，能判断问题出在哪一层。**

## 一、先拿日志

错误日志在应用数据目录：

```
%APPDATA%\VRCX-0\error-log.txt
```

完整路径通常是：

```
C:\Users\<你的用户名>\AppData\Roaming\VRCX-0\error-log.txt
```

在文件管理器地址栏粘 `%APPDATA%\VRCX-0` 就能直接打开。

**这个文件只装 `ERROR` 级别的事件**，所以它回答的是「出过什么错」，不是
「一切正常时走到哪一步了」。要看后者，见下一节的 `RUST_LOG`。

> 早先这里还有一个 `diagnostic-log.txt`（收 debug 及以上的完整时间线）。
> 合并上游时已移除：那一层把整个应用所有 crate 的 DEBUG 都写盘，每条都要
> 在全局日志锁下同步打开并追加文件；文件超过 10MB 后几乎每条都要读写整个
> 文件做裁剪，而且都发生在 tokio worker 线程上。为了排查一个功能而持续
> 拖慢整个应用不划算。需要同样效果时请显式设 `RUST_LOG`。

## 二、想要更详细的日志

默认级别是 `info`。要看每一轮轮询的细节（包括请求耗时、跳过原因），用环境变量启动：

```powershell
$env:RUST_LOG = "vrcx_0=debug"
& "路径\vrcx-0.exe"
```

改完记得新开终端，或 `Remove-Item Env:RUST_LOG` 复位。

## 三、日志怎么看

### 启动阶段（正常应该看到这些）

```
vrcc: background poll scheduled  owner=usr_…
vrcc: background poll task started  interval_secs=60 jitter_secs=20 owner=usr_…
```

轮询按 VRChat 登录账号起一个任务：**没登录不会起**，换号时旧任务自行退出、新任务另起。
`error-log.txt` 里没有这两行是正常的（它们是 `info` 级）；要看就按上一节设 `RUST_LOG`。

**如果这两行都没有**，说明轮询根本没起来——检查日志里有没有 `background poll not scheduled`（任务被拒绝）。

### 运行阶段（每轮一条，需 debug 级）

每轮先问 `me/notifications?since=`（新提醒，没有每天上限），再问 `me/unread`（几处未读数，每天 1500 次）。

```
vrcc: background poll round finished  fresh=1 persisted=1 unread=Some(3) toast_attempted=1 changed=true
vrcc: background poll skipped (not connected)
vrcc: background poll skipped (token lacks notifications)
vrcc: background poll sleeping  delay_ms=71234
```

`unread=None` 表示服务器还没有 `me/unread`（旧版接口），这时只在刚连上或来了新提醒时拉一次「最近的提醒」。

### 拿到提醒时

```
vrcc: fetched new notices      fresh=1
vrcc: notice handed to the notification dispatcher  notice_id=1026 body_len=42 icon=true
```

「handed to the dispatcher」只表示**交给了通知分发器**，不等于系统通知已经弹出来了——免打扰、隐私锁、通道偏好还可能把它拦下，没挂通知桥时 `show()` 也可能静默成功。别拿这行当「通知已送达」的证据。

每条提醒只弹一次：`me/notifications` 只给游标之后的。刚连上（或刚启动）的第一轮服务器只告诉「现在到哪了」，不给旧提醒，所以启动时不会把旧提醒再弹一遍——它们在「提醒」页里看得到。

### 通知没弹出去时

先按上一节开 `RUST_LOG=debug` 看 `round finished` 里的 `toast_attempted`：

| 现象                             | 排查方向                                                     |
| -------------------------------- | ------------------------------------------------------------ |
| `toast_attempted=0` 且 `fresh>0` | 分发器之前的筛选：免打扰、隐私锁、声音/通道偏好              |
| `toast_attempted>0` 但没弹       | 系统侧：Windows 通知开关、应用未注册到通知中心、窗口处于后台 |
| 连续 `background poll failed`    | 网络或服务端；注意 `error-log.txt` 只收 ERROR，这类是 `warn` |

### 超过每轮上限时

```
vrcc: new notices exceed per-poll toast limit; older ones not toasted  fresh=5 limit=3 skipped=2
```

一轮来了太多，只弹最新的三条，其余的在「提醒」页里看。**不是错误**，但连续出现说明轮询被中断过。

### 连接失效时

```
vrcc: token is invalid (disconnected on the site, re-authorized elsewhere, client mismatch, or unused for 90 days); dropping it
vrcc: token invalid, background poll idle until reconnect
```

服务器回了 `404 gone`、`403 client_mismatch` 或 `401 token`：令牌已被服务器判作废。本地令牌已经清掉，轮询会停下，「我的」页会提示重新连接。注意 `403 scope`（缺权限）**不在此列**——令牌仍有效，重新授权只是为了多要一项权限。

## 四、前端侧的对应证据

前端日志**不写进 `error-log.txt`**：`ERROR` 级别的 `console.error` 会由应用统一写入 `error-log.txt`，而下面这些 `[vrcc]` 前缀的 `console.info` 只出现在浏览器 DevTools（Tauri 里开 devtools 后可见）。排查时请同时看 DevTools 控制台，别只翻错误日志就下结论。

| 日志                                                  | 含义                                           |
| ----------------------------------------------------- | ---------------------------------------------- |
| `[vrcc] vrccNoticesChanged event subscribed`          | 事件订阅成功。**没有这行，界面就不会自动刷新** |
| `[vrcc] notices changed event received`               | 后端推来了信号                                 |
| `[vrcc] connection changed event received`            | 后端发现令牌失效，界面改显示「请重新连接」     |
| `[vrcc] events unsubscribed`                          | 页面切走或连接断开，正常退订                   |
| `[vrcc] subscribe vrccNoticesChanged event failed: …` | 订阅失败，界面只能手动刷新                     |
| `[vrcc] load failed: ...`                             | 首屏加载失败                                   |

**关键判断**：如果 `round finished` 里 `toast_attempted > 0`（后端已交给分发器）但 DevTools 里**没有** `notices changed event received`（前端没收到），问题在事件通道；如果两者都有但界面没变，问题在前端刷新逻辑。注意 `round finished` 需 `RUST_LOG=vrcx_0=debug`。

## 五、常见症状对照

### 症状：通知完全不来

按顺序核对：

1. `background poll scheduled` / `background poll task started` 有没有出现？没有 → 轮询没起（多半是 VRChat 还没登录）
2. 有没有 `background poll skipped (not connected)`？有 → 没连星遇同频
3. `round finished` 的 `fresh` 是 0 吗？是 → 这段时间确实没有新提醒
4. `fresh > 0` 但 `toast_attempted=0` → 看免打扰 / 隐私锁 / 通道偏好
5. 以上都正常 → 检查 Windows 系统通知设置，以及「专注助手」是否开启

### 症状：网页上有提醒，但没弹系统通知

提醒是在应用关着的时候来的：启动后的第一轮只记下「现在到哪了」，不补弹旧提醒。它们在「提醒」页里，页签上有未读数。这是按官方的轮询设计来的，不是 bug。

### 症状：界面显示「未连接」但后台轮询仍在跑

前端 `connection` 状态没刷到。看 DevTools 里的 `[vrcc] load failed`。

### 症状：`403 scope` / `scope_unreviewed`

`dev-` 标识只能要普通权限。`mutuals`、`today`、`crossings` 等敏感权限需要
应用登记并通过审核后，换成 `app_…` 标识才能用。**这是预期行为，不是缺陷。**

用 `app_…` 标识、「我的」里权限只有 `profile`：这是旧版本连上的令牌。旧版本
申请连接码时没带 `scope`，服务器对自助登记的应用默认只给 `profile`。更新后在
「我的」里重新连接一次就好。同意页没有勾选框，玩家只能全部同意或取消，所以要哪些
权限只取决于客户端发的 `scope`（见 `device_auth_scope`）。

### 症状：`接口暂时不可用` / `error sending request`

网络层。检查：

1. 应用设置里的代理是否填对（本机需要代理才能访问 `vrcc.cc`）
2. 日志里有没有 `vrcc: no proxy configured, connecting directly`
3. 有没有 `vrcc: invalid proxy url, using direct`（代理串写错）

## 六、手工验证网络

不依赖应用，直接测接口：

```powershell
# 不走代理
curl.exe -sS -o NUL -w "%{http_code}`n" https://vrcc.cc/api/v1/status

# 走代理（按你实际的代理端口改）
curl.exe -sS -o NUL -w "%{http_code}`n" --ssl-no-revoke -x http://127.0.0.1:7890 https://vrcc.cc/api/v1/status
```

返回 `200` 说明网络通。两个都通说明代理不是必需的；只有走代理才通，就要在应用里配代理。

## 七、报告问题时请附上

1. `error-log.txt`，以及按上一节设 `RUST_LOG=vrcx_0=debug` 之后的完整输出
   （**建议先搜 `vrcc` 只贴相关行**，其余内容可能含个人信息）
2. 上面「手工验证网络」两条命令的输出
3. `background poll scheduled` 与 `round finished` 两行的实际值
4. 系统版本（Win10 / Win11），以及是否开了专注助手

---

## 附：探针清单（给开发者）

| 位置                                   | 级别  | 内容                                      |
| -------------------------------------- | ----- | ----------------------------------------- |
| `state.rs::start_vrcc_background_poll` | info  | 任务已调度（按账号幂等）                  |
| `vrcc.rs::spawn_background_poll`       | info  | 任务启动、停止请求、令牌失效              |
| 同上                                   | debug | 每轮结果、跳过原因、休眠时长              |
| 同上                                   | warn  | 轮询失败                                  |
| `poll_once` / `handle_recent_notices`  | debug | 新提醒条数、交给分发器的通知（id + 长度） |
| 同上                                   | warn  | 超每轮上限、未读数拿不到                  |
| 应用层 `VrccService::settle`           | info  | 令牌失效（`404 gone`），已清掉            |
| 前端 `useVrccController`               | info  | 订阅、收事件、退订（DevTools 控制台）     |
| 前端 `useVrccController`               | error | 订阅失败、加载失败、跳转失败              |

「交给分发器」不等于「已弹出」：免打扰、隐私锁、通道偏好、通知桥是否挂载都会影响结果。
**正文内容从不进日志**，只记 `body_len` 与 `notice_id`——提醒正文属于玩家数据。
