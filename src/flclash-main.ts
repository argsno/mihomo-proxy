import { CUSTOM_FILTER } from "./user-config";
import { SETTINGS } from "./settings";
import { buildRuleProviders } from "./rule-providers";
import {
  buildStaticRules,
  mergeRules,
  pickDirectRules,
  type RuleTargets,
} from "./rules";
import { applyDns } from "./dns";
import { applyRuntime, applySniffer, applyTun } from "./runtime";
import { makeProxyNamesUnique } from "./proxies";
import type { ClashConfig, Proxy, ProxyGroup } from "./types";

// ============================================================
// flclash-mobile —— FlClash（手机端）专用覆写脚本
// ------------------------------------------------------------
// 与 simple-mihomo 同样的三个策略组、同一套业务分流 / DNS / TUN 源码，
// 但节点纳入方式改为内核侧 include-all + 正则过滤：
//
//   - 订阅更新、机场加减节点后无需重新应用脚本，策略组自动跟随
//   - 同时支持 proxies 与 proxy-providers 两种订阅形态
//     （手机端订阅常为 proxy-providers，逐个枚举节点名的写法会分组为空）
//   - 生成的配置不再内联几百行节点名，手机上加载/切换更快
//
// FlClash 运行时约定（lib/common/javascript.dart）：
//   引擎为 flutter_js → QuickJS（非 Sparkle 的 boa_engine），
//   调用形式 `{脚本}\nmain({配置JSON})`，只传 1 个参数，返回值须可 JSON 序列化。
//
// FlClash 会在本脚本执行完毕后再打一层补丁（lib/common/task.dart
// _makeRealProfileTask），以下字段一律由 App 设置覆盖，脚本写入无效：
//   mode / log-level / ipv6 / find-process-mode / tcp-concurrent /
//   unified-delay / keep-alive-interval / 各端口 / allow-lan /
//   geodata-loader / geox-url / global-ua / profile.store-selected，
//   以及 tun 的 enable / device / stack / dns-hijack / auto-route /
//   route-address（tun 的 mtu / strict-route 等其余字段仍保留）。
// 因此这些项需要在 App 内自行设置，对应指引见产物文件头部注释。
// 保留生效的部分：rules / proxy-groups / rule-providers / dns / sniffer /
// hosts —— 也就是本脚本的核心价值所在。
// ============================================================

/** 三个策略组的名称（规则出口统一引用这里，避免魔法字符串） */
const GROUPS = {
  ALL: "全部",
  AI: "AI",
  ADBLOCK: "广告拦截",
};

/** 两个隐藏的自动测速组（供上面的 select 组引用） */
const AUTO = {
  ALL: "自动测速",
  AI: "AI 自动测速",
};

/** 香港节点识别（AI 组需剔除，OpenAI/Claude 等常封锁 HK 出口） */
const HK_FILTER = /香港|HK|HKG|HONGKONG|HONG KONG|🇭🇰/i;

/** 极简版分流出口：广告独立成组可切换，其余全部收敛到「全部/AI」 */
const MOBILE_RULE_TARGETS: RuleTargets = {
  adblock: GROUPS.ADBLOCK,
  ai: GROUPS.AI,
  google: GROUPS.ALL,
  youtube: GROUPS.ALL,
  telegram: GROUPS.ALL,
  steam: GROUPS.ALL,
  apple: GROUPS.ALL,
  microsoft: GROUPS.ALL,
  proxy: GROUPS.ALL,
};

const STATIC_RULES = buildStaticRules(MOBILE_RULE_TARGETS);

// ============================================================
// 节点过滤器 —— JS RegExp → mihomo filter 字符串
// ============================================================

/**
 * 取正则源码，空正则返回 ""。
 * 空 RegExp 的 source 是 "(?:)"，直接拼进过滤器会匹配空串，
 * 导致 exclude-filter 命中每一个节点名（组被清空）。
 */
const filterSource = (re: RegExp): string => {
  const src = re && re.source ? String(re.source) : "";
  return !src || src === "(?:)" ? "" : src;
};

/**
 * 合并多个正则为一条 exclude-filter。
 *
 * mihomo 的 filter / exclude-filter 由 dlclark/regexp2 编译（.NET 风格，
 * 非 Go RE2），支持 `(?i)` 内联选项。这里统一包进非捕获组再前置 `(?i)`：
 * 若写成 `(?i)a|b`，内联标志的作用域容易随实现产生歧义，
 * `(?i)(?:a|b)` 则明确对全部分支生效。
 * 返回空串表示不设置该字段（不能下发空字符串，会被当成匹配空串）。
 */
const buildExcludeFilter = (...regexps: RegExp[]): string => {
  const parts = regexps.map(filterSource).filter(Boolean);
  return parts.length ? `(?i)(?:${parts.join("|")})` : "";
};

/** 通用排除：机场信息类节点（到期/流量/官网）+ 用户自定义过滤 */
const EXCLUDE_COMMON = buildExcludeFilter(SETTINGS.INFO_FILTER, CUSTOM_FILTER);
/** AI 组排除：在通用排除基础上再剔除香港 */
const EXCLUDE_AI = buildExcludeFilter(
  SETTINGS.INFO_FILTER,
  CUSTOM_FILTER,
  HK_FILTER,
);

/** 仅在过滤器非空时写入字段，避免下发 `exclude-filter: ""` */
const withExclude = (group: ProxyGroup, filter: string): ProxyGroup =>
  filter ? { ...group, "exclude-filter": filter } : group;

// ============================================================
// ProxyGroups —— 三个策略组（节点由内核 include-all 运行时纳入）
// ============================================================

/**
 * 订阅是否提供了节点来源。
 * proxies 与 proxy-providers 任一非空即可 —— provider 为 http 类型时
 * 配置校验阶段尚未下载，节点数为 0 属正常，不能据此判空。
 * 注：FlClash 在调用脚本前会把缺失的 proxy-providers 补成 {}，
 * 所以这里必须判 key 数量而不是判是否存在。
 */
const hasProxySource = (cfg: ClashConfig): boolean => {
  const proxies = Array.isArray(cfg.proxies) ? cfg.proxies : [];
  const providers = cfg["proxy-providers"];
  const providerCount =
    providers && typeof providers === "object"
      ? Object.keys(providers).length
      : 0;
  return proxies.length > 0 || providerCount > 0;
};

/**
 * 构建策略组。
 *
 * include-all 的内核语义（adapter/outboundgroup/parser.go）：
 *   include-all = include-all-proxies + include-all-providers，
 *   前者把 AllProxies 追加到 proxies 之后，后者把全部 proxy-providers
 *   填进 use。AllProxies 只含订阅节点，不含 DIRECT / REJECT / 策略组名，
 *   所以自动测速组不会把 DIRECT 当成"最快节点"选中。
 *   过滤在 GroupBase.GetProxies 里做，对 proxies 与 providers 均生效。
 */
const buildMobileProxyGroups = (hasNodes: boolean): ProxyGroup[] => {
  const icon = (f: string) => SETTINGS.ICON_BASE + f;

  // 无节点来源（空订阅 / 拉取失败）：业务组回退 DIRECT，
  // 保证配置可用且仍能上网（对齐 simple-mihomo 的既有行为）。
  // 此处不能依赖内核对空组的 COMPATIBLE 回退——那会让命中规则的流量
  // 直接失败，而不是放行直连。
  if (!hasNodes) {
    return [
      {
        name: GROUPS.ALL,
        type: "select",
        proxies: ["DIRECT"],
        icon: icon("Global.png"),
      },
      {
        name: GROUPS.AI,
        type: "select",
        proxies: [GROUPS.ALL],
        icon: icon("ChatGPT.png"),
      },
      {
        name: GROUPS.ADBLOCK,
        type: "select",
        proxies: ["REJECT", "DIRECT", GROUPS.ALL],
        icon: icon("AdBlack.png"),
      },
    ];
  }

  return [
    // 全部：自动测速打头（默认选它即自动选优），其后由内核追加所有节点
    withExclude(
      {
        name: AUTO.ALL,
        type: "url-test",
        proxies: [],
        "include-all": true,
        icon: icon("Auto.png"),
        ...SETTINGS.MOBILE_URL_TEST_EXTRA,
      },
      EXCLUDE_COMMON,
    ),
    withExclude(
      {
        name: GROUPS.ALL,
        type: "select",
        proxies: [AUTO.ALL],
        "include-all": true,
        icon: icon("Global.png"),
      },
      EXCLUDE_COMMON,
    ),
    // AI：纯净节点池（排除香港），同样自动测速打头
    withExclude(
      {
        name: AUTO.AI,
        type: "url-test",
        proxies: [],
        "include-all": true,
        icon: icon("ChatGPT.png"),
        ...SETTINGS.MOBILE_URL_TEST_EXTRA,
      },
      EXCLUDE_AI,
    ),
    withExclude(
      {
        name: GROUPS.AI,
        type: "select",
        proxies: [AUTO.AI],
        "include-all": true,
        icon: icon("ChatGPT.png"),
      },
      EXCLUDE_AI,
    ),
    // 广告拦截：默认 REJECT；误杀时可切 DIRECT（直连放行）或 全部（代理放行）
    {
      name: GROUPS.ADBLOCK,
      type: "select",
      proxies: ["REJECT", "DIRECT", GROUPS.ALL],
      icon: icon("AdBlack.png"),
    },
  ];
};

// ============================================================
// Main
// ============================================================

export function flclashMain(config: ClashConfig): ClashConfig {
  config = config && typeof config === "object" ? config : {};
  const originalProxies: Proxy[] = Array.isArray(config.proxies)
    ? config.proxies
    : [];
  const existingRules: string[] = Array.isArray(config.rules)
    ? config.rules
    : [];

  // 清理旧版 geodata 字段（统一走 rule-providers）
  delete config["geodata-mode"];
  delete config["geo-auto-update"];
  delete config["geo-update-interval"];
  delete config["geox-url"];

  config["rule-providers"] = {
    ...(config["rule-providers"] || {}),
    ...buildRuleProviders(),
  };
  config.rules = mergeRules(STATIC_RULES, pickDirectRules(existingRules));

  // 重名去冲突：内核在解析阶段遇到同名节点会直接报错，必须先处理。
  // 除此之外不改写 config.proxies —— 节点由内核按 include-all 在运行时
  // 纳入策略组，脚本无需（也不应该）枚举节点名。
  makeProxyNamesUnique(originalProxies);
  if (originalProxies.length) config.proxies = originalProxies;

  config["proxy-groups"] = buildMobileProxyGroups(hasProxySource(config));

  applyRuntime(config);
  applySniffer(config);
  applyTun(config);
  applyDns(config);

  return config;
}
