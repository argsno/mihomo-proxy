import { defineConfig } from "vite";
import { resolve } from "node:path";

/**
 * 打包目标：
 *  - 桌面（Sparkle / Clash Verge Rev）：boa_engine 运行时
 *  - 手机（FlClash）：flutter_js → QuickJS 运行时
 * 两者的调用约定一致（脚本被求值后调用顶层 main），差别仅在
 * FlClash 只传 1 个参数（`main(config)`），profileName 为 undefined 不影响。
 *
 * 约束：
 *  - 产物必须是单文件普通脚本（非 ESM，宿主以 `{script}; main(...)` 求值）
 *  - 顶层作用域必须存在可调用的 `main` → 用 IIFE + footer 桥接
 *  - boa / QuickJS 均支持 90%+ 最新 ES 规范，target es2020 安全
 *
 * 四产物：默认 mode 构建完整版，`--mode simple` 极简版，
 * `--mode flclash` 手机极简版，`--mode bettbox` Bettbox 专属版。
 * （Vite 库模式的 IIFE 不支持多 entry，故用 mode 区分、分次构建。）
 */

const FULL = {
  entry: "src/index.ts",
  name: "__mihomoProxy",
  fileName: "mihomo-proxy.js",
  banner: `/**
 * mihomo-proxy — Ultimate Stable Edition v3.0
 * ------------------------------------------------------------------
 * 面向 Sparkle / 最新 Mihomo(Clash.Meta) 内核的配置增强脚本。
 * 本文件由 vite build 自动生成，请勿手改；源码见 src/ 目录。
 *
 * 仓库地址：https://github.com/wchiway/mihomo-proxy
 * 脚本链接：https://raw.githubusercontent.com/wchiway/mihomo-proxy/refs/heads/main/mihomo-proxy.js
 * 客户端推荐：https://github.com/xishang0128/sparkle
 * 提醒：使用系统代理时 fake-ip 不会生效，建议使用 TUN 模式。
 */`,
};

const SIMPLE = {
  entry: "src/simple.ts",
  name: "__mihomoSimple",
  fileName: "simple-mihomo.js",
  banner: `/**
 * simple-mihomo — 极简业务分流版 v3.0
 * ------------------------------------------------------------------
 * mihomo-proxy.js 的极简姊妹版：保留全部业务分流与 DNS/TUN 优化，
 * 但策略组只有三个，节点不做地区分组，简洁好理解：
 *
 *   全部     —— 所有节点（内置自动测速，默认自动选优）
 *   AI       —— 可访问 AI 服务的纯净节点（自动剔除香港）
 *   广告拦截 —— REJECT（默认拦截）/ DIRECT / 全部 三选一
 *
 * 业务分流规则与 mihomo-proxy.js 共享同一份源码模块（src/），
 * 构建期即保证两版规则/DNS 架构一致，不再手工同步。
 * 本文件由 vite build 自动生成，请勿手改；源码见 src/ 目录。
 *
 * 仓库地址：https://github.com/wchiway/mihomo-proxy
 * 脚本链接：https://raw.githubusercontent.com/wchiway/mihomo-proxy/refs/heads/main/simple-mihomo.js
 * 提醒：使用系统代理时 fake-ip 不会生效，建议使用 TUN 模式。
 */`,
};

const BETTBOX = {
  entry: "src/bettbox.ts",
  name: "__mihomoBettbox",
  fileName: "bettbox-flclash.js",
  banner: `/**
 * bettbox-flclash — Bettbox / FlClash 系列专属覆写脚本 v3.0
 * ------------------------------------------------------------------
 * 面向 Bettbox 与 FlClash 系列客户端的完整分流覆写脚本。
 * 集成 Compatible_With_Bettbox 可视化开关适配、include-all 运行时
 * 节点纳入、完整分流策略组（Google/YouTube/AI/Telegram/Steam/Apple/
 * Microsoft）、以及按地区自动分组（HK/TW/JP/SG/KR/US/EU/AU/AS）。
 *
 * ── Bettbox 可视化开关 ───────────────────────────────────────────
 * 本脚本首行的 Compatible_With_Bettbox 声明会被 Bettbox（v1.18.8+）
 * 自动识别，在客户端 UI 中渲染可视化配置面板，用户可直接通过开关
 * 控制各分流策略组和地区分组的启用/禁用。
 *
 * ── 用法 ──────────────────────────────────────────────────────────
 * 设置 → 高级设置 → 脚本 → 添加 →（右上角可远程下载本脚本链接）→
 * 保存；再到 配置 → 对应订阅 → 覆写 → 模式选「脚本」→ 勾选本脚本。
 *
 * ── 必须在 App 内正确的设置（脚本无法覆盖，会被 App 强制改写）────
 *  1. 设置 → 网络 →「覆写 DNS」保持【关闭】
 *  2. 设置 → 网络 →「追加系统 DNS」保持【关闭】
 *  3. 出站模式选「规则」；TUN 栈选 mixed；
 *     「查找进程」建议设为 off
 *
 * 本文件由 vite build 自动生成，请勿手改；源码见 src/ 目录。
 *
 * 仓库地址：https://github.com/wchiway/mihomo-proxy
 * 脚本链接：https://raw.githubusercontent.com/wchiway/mihomo-proxy/refs/heads/main/bettbox-flclash.js
 * 客户端：https://github.com/appshubcc/Bettbox | https://github.com/chen08209/FlClash
 */
const Compatible_With_Bettbox = { ruleOptionsEnable: true };`,
};

const FLCLASH = {
  entry: "src/flclash.ts",
  name: "__mihomoFlClash",
  fileName: "flclash-mobile.js",
  banner: `/**
 * flclash-mobile — FlClash（手机端）覆写脚本 v3.0
 * ------------------------------------------------------------------
 * 与 simple-mihomo 同样的三个策略组、同一套业务分流 / DNS 防泄露 /
 * Sniffer 源码，但节点改由内核 include-all + 正则过滤在运行时纳入：
 * 订阅更新、机场加减节点后无需重新应用脚本，proxy-providers 型订阅
 * 也能正确分组，生成的配置不含几百行节点名，手机上加载更快。
 *
 *   全部     —— 全部节点（自动测速打头，默认自动选优）
 *   AI       —— 排除香港的纯净节点池（OpenAI/Claude 常封锁 HK 出口）
 *   广告拦截 —— REJECT（默认拦截）/ DIRECT / 全部 三选一
 *
 * ── 用法 ──────────────────────────────────────────────────────────
 * 设置 → 高级设置 → 脚本 → 添加 →（右上角可远程下载本脚本链接）→
 * 保存；再到 配置 → 对应订阅 → 覆写 → 模式选「脚本」→ 勾选本脚本。
 *
 * ── 必须在 App 内核对的设置（脚本无法覆盖，会被 App 强制改写）──────
 *  1. 设置 → 网络 →「覆写 DNS」保持【关闭】
 *     （打开会用 App 默认 DNS 整块替换本脚本的防泄露 DNS 架构）
 *  2. 设置 → 网络 →「追加系统 DNS」保持【关闭】
 *     （打开会向 nameserver 注入 system://，直接构成 DNS 泄露）
 *  3. 出站模式选「规则」；TUN 栈选 mixed；
 *     「查找进程」建议设为 off（手机上无进程规则，开启徒增开销）
 *  4. 上述之外，log-level / ipv6 / 各端口 / tcp-concurrent /
 *     unified-delay / keep-alive-interval / 记住选择 等，
 *     同样由 App 设置决定，脚本内的对应值不会生效。
 *
 * 本文件由 vite build 自动生成，请勿手改；源码见 src/ 目录。
 *
 * 仓库地址：https://github.com/wchiway/mihomo-proxy
 * 脚本链接：https://raw.githubusercontent.com/wchiway/mihomo-proxy/refs/heads/main/flclash-mobile.js
 * 客户端：https://github.com/chen08209/FlClash
 */`,
};

export default defineConfig(({ mode }) => {
  const variant =
    mode === "simple"
      ? SIMPLE
      : mode === "flclash"
        ? FLCLASH
        : mode === "bettbox"
          ? BETTBOX
          : FULL;
  return {
    build: {
      lib: {
        entry: resolve(__dirname, variant.entry),
        name: variant.name,
        formats: ["iife"],
        fileName: () => variant.fileName,
      },
      target: "es2020",
      minify: false, // 保持产物可读、便于用户审计
      outDir: "dist",
      // 完整版先构建并清空 dist，极简版 / 手机版随后追加
      emptyOutDir: mode !== "simple" && mode !== "flclash" && mode !== "bettbox",
      rolldownOptions: {
        output: {
          banner: variant.banner,
          footer: `
// 宿主入口桥接：脚本被求值后直接调用顶层 main
// （Sparkle / Clash Verge Rev 传 (config, profileName)，FlClash 只传 config）
function main(config, profileName) {
  return ${variant.name}.main(config, profileName);
}`,
        },
      },
    },
  };
});
