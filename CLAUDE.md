# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Git 核心规则（强制）

任何涉及文件修改的实现任务，在给出最终回复之前，都必须先执行一次 Git 提交。

- 在编辑前检查 `git status`，并将已存在的或并发的改动视为用户所有。
- 在提交前仔细审查最终的差异，并进行相应的验证。
- 仅暂存属于当前任务的文件或代码块。除非用户明确要求，否则绝不可将无关的改动一并提交。
- 在 main 分支上使用简洁的描述性提交信息，并附上提交哈希值；未经允许，不得推送、修改或重写提交历史。
- 只读任务以及未涉及任何文件变更的任务不会产生空提交。

## 构建与测试命令

```bash
pnpm install                  # Node 20+ / pnpm 11+
pnpm typecheck                # tsc 类型检查
pnpm test                     # vitest 单元测试（36 项）
pnpm test -- -t "关键词"       # 运行匹配的单测
pnpm build                    # 三产物构建 → node:vm 冒烟断言 → 同步到仓库根目录
pnpm verify:kernel            # 真实 mihomo 内核 -t 校验（需 MIHOMO_BIN 或本地内核）
pnpm verify:runtime           # 启动内核查 /proxies API，验 include-all/exclude-filter 实际生效
```

`pnpm build` 完整流程：`vite build`（默认完整版）→ `vite build --mode simple`（极简版）→ `vite build --mode flclash`（手机版）→ `node scripts/verify.mjs`（vm 断言 + 产物同步）。

**产物提交由 CI 自动完成**：`pnpm build` 会在本地生成/更新 `mihomo-proxy.js`、`simple-mihomo.js`、`flclash-mobile.js` 三个产物文件，但这些不需要手动 `git add` / `git push`。GitHub Actions 在 main 分支 push 时，三级校验全部通过后会自动执行 `git commit -m "chore: 同步构建产物 [skip ci]"` 并 push。本地 build 后的产物改动可以直接 discard。

## 核心架构：三产物、同一源码

项目从一份 `src/` TypeScript 源码产出三个独立的 JavaScript 覆写脚本，由 Vite 8 IIFE 库模式分三次构建（通过 `--mode` 区分入口）：

| 入口 | 产物 | 运行时 | 差异 |
|------|------|--------|------|
| `src/index.ts` | `mihomo-proxy.js` | Sparkle / Clash Verge Rev (boa_engine) | 20+ 策略组，地区分组 |
| `src/simple.ts` | `simple-mihomo.js` | 同上 | 3 组（全部/AI/广告拦截） |
| `src/flclash.ts` | `flclash-mobile.js` | FlClash (flutter_js → QuickJS) | 同 3 组，节点走 `include-all` + `exclude-filter` |

**共享模块**（三版完全相同）：`settings.ts`、`utils.ts`、`rule-providers.ts`、`rules.ts`、`dns.ts`、`runtime.ts`、`user-config.ts`。差异仅在各版自己的 `*-main.ts` 中注入不同的 `RuleTargets` 出口目标名和策略组生成逻辑。构建期即保证分流规则骨架、DNS、TUN 三版一致。

产物格式约束：单文件普通脚本（非 ESM），IIFE 打包 + `vite.config.ts` footer 注入顶层 `function main(config, profileName)`，满足宿主 `{script}; main(...)` 的求值约定。`target: es2020`，`minify: false` 保留中文注释。

## 三级校验流水线（CI 对每次 push 全量执行）

1. **`scripts/verify.mjs`** — `node:vm` 裸沙箱模拟宿主调用，断言 DNS 防泄露铁律、规则集引用一致、三版规则骨架相同、策略组存在性、零节点回退、`exclude-filter` 匹配行为（不匹配空串/不误伤测速组名/正确排除香港和信息节点）。通过后导出 `dist/test-*.yaml` 供下一级、同步产物到仓库根目录。

2. **`scripts/verify-kernel.mjs`** — 用真实 mihomo 内核 `-t -d dist -f test-*.yaml` 跑配置测试，抓 V8 抓不到的内核 schema 错误（字段拼写、`nameserver-policy` 语法、rule-set 引用缺失）。找不到内核则跳过（退出码 0）。

3. **`scripts/verify-runtime.mjs`** — 实际启动内核（关 TUN 免管理员权限），等就绪后查 `/proxies` API，断言 `include-all` 确实纳入订阅节点、不含 DIRECT/REJECT（否则自动测速会把直连接管）、信息类节点与香港节点被正确排除。这是 `-t` 的盲区。

## 关键设计决策与踩坑结论

### DNS 防泄露架构（`src/dns.ts`）
- **默认 `nameserver` = 国际 DoH**（`https://1.1.1.1/dns-query`，IP 直连免 bootstrap），配合 `respect-rules: true` 经代理出站——境外域名（含浏览器 TYPE65 查询）绝不落到国内解析商。
- **`proxy-server-nameserver` = 国内加密 DoH**（AliDNS + DNSPod）：节点服务器域名必须在直连状态可解析，国内网络访问 1.1.1.1:443 常被阻断。
- **`direct-nameserver` = system + 国内 DoH，且 `direct-nameserver-follow-policy: true`**：命中 DIRECT 出口的连接（用户 `BYPASS_DOMAINS`、`DOMAIN-KEYWORD,wegame`、`connectivity-check` 等不在 policy 白名单里的域名）不再绕到国际 DoH 解析。follow-policy 必须开——否则 google/gfw/AI 族一旦被用户规则改判直连，就会退化成被污染的国内解析结果。
- **`nameserver-policy` 语法陷阱**：多规则集合并到一个 key 时，`rule-set:` 前缀只写一次，后接逗号分隔。写成 `"rule-set:a","rule-set:b"` 会导致内核把第二个 key 解析为名为 `"rule-set"` 的规则集而报 `not found rule-set`。
- **`respect-rules` 与 `prefer-h3` 不能同时开启**（官方明确）。
- **域名通配语法自 v1.19.30 起严格校验**（`component/trie/domain.go` 的 `ValidAndSplitDomain`）：`+` 只能是多段域名的第一个完整段，`*` 只能是完整的一段（`*a` / `a*b` 被拒），且拒绝尾点、首尾空白、空段。写错直接 `invalid domain`。`fake-ip-filter`、`nameserver-policy` 的键、`hosts` 的键、`sniffer.skip-domain` 都受此约束，`scripts/verify.mjs` 里有等价实现做回归。

### 规则顺序依赖（`src/rules.ts`）
- **`google` 必须在 `google-cn` 之前**：google-cn 列表混有 `connectivitycheck.gstatic.com`、`fonts.googleapis.com` 等全球关键域名（其国内 CDN 已失效）。若 google-cn 先匹配，这些域名被直连 → YouTube 报「未联网」、Chrome 商店卡死。
- **Steam 下载 CDN 直连必须前置**：`steamcontent.com`/`steamserver.net`/`steampipe.akamaized.net` 在 geosite:steam 集合内，不前置会被送进代理组。
- **MATCH 兜底必须在末位**，用户自定义 DIRECT 规则合并到 MATCH 之前。

### 策略组字段（`src/settings.ts`、`src/proxy-groups.ts`、各版 `*-main.ts`）
- **`expected-status: 204`**：测速地址是 `generate_204`，而内核默认 `expected-status` 为 `*`（任何响应都算通过）。酒店/校园网门户劫持返回 200 页面时节点会被误判为可用，显式锁定 204 才能正确计入失败。
- **`default-selected`**（内核 v1.19.28+）：把「默认选中自动测速组」写成显式语义，不再依赖内核 `selectedProxy()` 找不到选中项时返回 `proxies[0]` 的隐式行为。值必须是该组的既有成员，否则内核静默回落首位。
- **`empty-fallback: DIRECT`**（内核 v1.19.27+，仅手机版的 include-all 测速组）：`include-all` 过滤后一个成员都不剩时（`CUSTOM_FILTER` 写太宽），内核会把组成员置成 `empty-fallback`，默认 `COMPATIBLE`。注意 **COMPATIBLE 实为 `outbound.NewCompatible()` 返回的 `Direct`，行为等同直连而非失败**——显式写 DIRECT 只是让这个兜底在 App 里可见并与零节点分支一致。该字段只接受 proxy 名，填策略组会被内核直接判错。
- 这三个字段旧内核都会**静默忽略且 `-t` 照样通过**，只有查 `/proxies` API 才能区分"写了"和"生效了"，故断言放在第 3 级 `verify-runtime.mjs` 并按内核版本 gate。

### Google 系稳定性（`src/rules.ts`、`src/settings.ts`、`src/user-config.ts`）
- **共享域出口收敛**：`googleapis.com` / `gstatic.com` 的子域同时散落在 geosite 的 `youtube` 与 `google` 集合里，完整版会把它们分派到两个可独立切换的策略组。后果不是某域名不通，而是同一 Google 账号的请求从多个出口 IP 发出，触发 Google 侧会话风控（插入验证 / 401 / 静默降速）。现用 `DOMAIN-SUFFIX` 在 `youtube` 规则前把这两个共享域钉到 `t.google`；`YouTube` 组也加了 `default-selected: "Google"`。AI 族规则排在更前，`generativelanguage.googleapis.com` 仍归 AI 组——那是刻意的避港设计，不在收敛范围。
- **QUIC 阻断**（`BLOCK_GOOGLE_QUIC`，默认 true）：Google 系几乎全量 HTTP/3，节点不转发 UDP 时 QUIC 进黑洞，浏览器要等自己超时才回落 TCP，表现为「时不时卡几秒」而非明确报错。用 `AND,((NETWORK,udp),(DST-PORT,443),(OR,(...)))` 逻辑规则 REJECT（不是 REJECT-DROP——静默丢弃反而让客户端继续等）。逻辑规则内**不嵌 RULE-SET**，用显式 `DOMAIN-SUFFIX` 列举。该规则必须排在 AI/Google/YouTube 之前。
- **`GLOBAL_DOH` 不含 8.8.8.8**：`respect-rules: true` 下 DoH 连接自身要过规则，8.8.8.8 会命中 `RULE-SET,google-ip,<Google 组>,no-resolve`，把 DNS 上游绑死在 Google 出口——Google 组一抖，Google 域名的解析跟着抖，单点故障放大成双重超时。改用 Quad9（9.9.9.9）解耦。
- **桌面 `URL_TEST_EXTRA` 放宽到 600s / 100ms**：原 300/50 在跨境抖动下几乎每轮重选节点，长会话（Drive 上传、Gmail 长轮询、AI 流式响应）被反复打断，且出口 IP 变化又回头喂风控。

### Sniffer 端口区间（`src/runtime.ts`）
HTTP 与 TLS 同为 TCP，端口区间**必须互斥**：原先 HTTP 的 `8080-8880` 覆盖了 TLS 的 `8443`，而两者 `override-destination` 取值相反，重叠即行为不确定（内核 v1.19.30 的 `coordinate TCP sniffers on overlapping ports` 才把这类冲突理顺）。现拆成 `8080-8442` + `8444-8880`。QUIC 走 UDP，与 TLS 同端口无妨。HTTP sniffer 自 v1.19.30 起顺带覆盖 H2C，QUIC 覆盖 QUICv2，均无需改配置。

### FlClash 运行时约束（`src/flclash-main.ts` 头注释）
- **引擎**：flutter_js → QuickJS，调用形式 `main(config)` 只传 1 个参数，非 boa_engine 的 `main(config, profileName)`。
- **App 强制改写字段**（脚本写入无效）：`mode`、`log-level`、`ipv6`、`find-process-mode`、`tcp-concurrent`、`unified-delay`、`keep-alive-interval`、各端口、`profile.store-selected`、`tun.enable/device/stack/dns-hijack/auto-route/route-address`。保留生效：`rules`、`proxy-groups`、`rule-providers`、`dns`、`sniffer`、`hosts`。
- **DNS 泄露首要排查项**：App 设置中「覆写 DNS」和「追加系统 DNS」必须关闭，否则会在脚本执行后改写 DNS 配置。
- **调用前 `proxy-providers` 被补成 `{}`**：`hasProxySource` 必须判 key 数量而非判字段存在。

### exclude-filter 正则陷阱（`src/flclash-main.ts`）
- mihomo 的 `filter`/`exclude-filter` 由 **dlclark/regexp2**（.NET 风格，非 Go RE2）编译，支持 `(?i)` 内联选项。
- 空 `RegExp` 的 `source` 是 `"(?:)"`，直接拼进过滤器会匹配空串 → 命中每个节点名 → 策略组被清空。`filterSource()` 负责拦截这个情况。
- `(?i)(?:a|b)` 优于 `(?i)a|b`：后者内联标志作用域随实现可能产生歧义。

### 用户自定义区（`src/user-config.ts`）
- `BYPASS_DOMAINS`：后缀匹配，走 DIRECT
- `FORCE_PROXY_DOMAINS`：精确匹配，走主代理组
- `CUSTOM_FILTER`：节点名过滤器正则，手机版会被编译进 `exclude-filter`，注意别让它命中「自动测速」「AI 自动测速」这两个组名
- 推荐改源码后 `pnpm build` 重新生成，而非直接编辑产物
