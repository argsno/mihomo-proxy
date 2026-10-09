import { CUSTOM_FILTER, POLICY_PRIORITY } from "./user-config";
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

/**
 * Bettbox 智能选路版覆写脚本（bettbox-smart）
 * ------------------------------------------------------------------
 * 布局与 flclash-mobile 完全一致（三个极简策略组 + include-all 运行时
 * 纳入节点），仅两个隐藏自动组改用 Bettbox 内核的 smart 类型：
 *
 *   smart 组按真实连接质量打分选路 —— 首响应延迟 EWMA + 重传惩罚
 *   （1% ≈ 50ms）+ 失败降权 + 按站点记忆，失败时按优选集合 / 健康节点 /
 *   失败节点的顺序自动回退；内核固定每 5 分钟重测一轮。
 *   url-test 只看周期性测速延迟，感知不到真实连接质量，这是二者的核心差异。
 *
 *   智能选路    —— 全部节点（默认选优，后台按真实连接自动打分）
 *   全部        —— 智能选路打头，可手动切任意节点
 *   AI 智能选路 —— 排除香港的纯净节点池（OpenAI/Claude 常封锁 HK 出口）
 *   AI          —— AI 智能选路打头，可手动切换
 *   广告拦截    —— REJECT（默认拦截）/ DIRECT / 全部 三选一
 *
 * 注意：smart 组是 Bettbox 内核专属能力，上游 mihomo 内核（FlClash /
 * Sparkle / Clash Verge Rev 等）会因 `unsupported type: smart` 校验失败。
 */

/** 三个策略组的名称（规则出口统一引用这里，避免魔法字符串） */
const GROUPS = {
  ALL: "全部",
  AI: "AI",
  ADBLOCK: "广告拦截",
};

/** 两个隐藏的自动选路组（供上面的 select 组引用） */
const AUTO = {
  ALL: "智能选路",
  AI: "AI 智能选路",
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

// --- 节点过滤器（RegExp → dlclark/regexp2 正则转换） ---

/**
 * 取正则源码，空正则返回 ""。
 * 空 RegExp 的 source 是 "(?:)"，直接拼进过滤器会匹配空串导致所有节点被排除。
 */
const filterSource = (re: RegExp): string => {
  const src = re && re.source ? String(re.source) : "";
  return !src || src === "(?:)" ? "" : src;
};

/**
 * 合并多个正则为一条 exclude-filter。
 * 统一包装进非捕获组 `(?i)(?:...)`，确保对全部分支生效。
 */
const buildExcludeFilter = (...regexps: RegExp[]): string => {
  const parts = regexps.map(filterSource).filter(Boolean);
  return parts.length ? `(?i)(?:${parts.join("|")})` : "";
};

/** 通用排除：机场信息类节点 + 用户自定义过滤 */
const EXCLUDE_COMMON = buildExcludeFilter(SETTINGS.INFO_FILTER, CUSTOM_FILTER);
/** AI 组排除：通用排除 + 香港节点 */
const EXCLUDE_AI = buildExcludeFilter(
  SETTINGS.INFO_FILTER,
  CUSTOM_FILTER,
  HK_FILTER,
);

/** 仅在过滤器非空时写入字段，避免下发空字符串 */
const withExclude = (group: ProxyGroup, filter: string): ProxyGroup =>
  filter ? { ...group, "exclude-filter": filter } : group;

/** 仅在用户配置了 policy-priority 时写入字段（空字符串会被内核判为非法值） */
const withPolicyPriority = (
  group: ProxyGroup,
  policyPriority: string,
): ProxyGroup =>
  policyPriority.trim()
    ? { ...group, "policy-priority": policyPriority }
    : group;

/**
 * include-all 组的空成员兜底（empty-fallback）。
 * 过滤后空组显式回退至 DIRECT，避免 UI 显示含混的 COMPATIBLE。
 */
const EMPTY_FALLBACK = { "empty-fallback": "DIRECT" };

/**
 * 订阅是否提供了节点来源。
 * proxies 与 proxy-providers 任一非空即可 —— provider 为 http 类型时
 * 配置校验阶段尚未下载，节点数为 0 属正常，不能据此判空。
 * 注：Bettbox / FlClash 在调用脚本前会把缺失的 proxy-providers 补成 {}，
 * 所以这里必须判 key 数量而不是判是否存在。
 */
export const hasProxySource = (cfg: ClashConfig): boolean => {
  const proxies = Array.isArray(cfg.proxies) ? cfg.proxies : [];
  const providers = cfg["proxy-providers"];
  const providerCount =
    providers && typeof providers === "object"
      ? Object.keys(providers).length
      : 0;
  return proxies.length > 0 || providerCount > 0;
};

/**
 * 构建策略组（导出供单测直接断言）。
 *
 * include-all 的内核语义与过滤时机同 flclash-mobile：
 * 组成员由内核在 GroupBase.GetProxies 里按 exclude-filter 过滤后得到，
 * 这里只声明空成员兜底与默认选中项。
 */
export const buildSmartProxyGroups = (
  hasNodes: boolean,
  policyPriority: string = "",
): ProxyGroup[] => {
  const icon = (f: string) => SETTINGS.ICON_BASE + f;

  // 无节点来源（空订阅 / 拉取失败）：业务组回退 DIRECT，
  // 保证配置可用且仍能上网（对齐 flclash-mobile / simple-mihomo 的既有行为）。
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
    // 智能选路：真实连接质量打分自动选优，其后由内核追加所有节点
    withPolicyPriority(
      withExclude(
        {
          name: AUTO.ALL,
          type: "smart",
          proxies: [],
          "include-all": true,
          icon: icon("Auto.png"),
          ...SETTINGS.SMART_EXTRA,
          ...EMPTY_FALLBACK,
        },
        EXCLUDE_COMMON,
      ),
      policyPriority,
    ),
    withExclude(
      {
        name: GROUPS.ALL,
        type: "select",
        proxies: [AUTO.ALL],
        "include-all": true,
        "default-selected": AUTO.ALL,
        icon: icon("Global.png"),
      },
      EXCLUDE_COMMON,
    ),
    // AI：纯净节点池（排除香港），同样智能选路打头
    withPolicyPriority(
      withExclude(
        {
          name: AUTO.AI,
          type: "smart",
          proxies: [],
          "include-all": true,
          icon: icon("ChatGPT.png"),
          ...SETTINGS.SMART_EXTRA,
          ...EMPTY_FALLBACK,
        },
        EXCLUDE_AI,
      ),
      policyPriority,
    ),
    withExclude(
      {
        name: GROUPS.AI,
        type: "select",
        proxies: [AUTO.AI],
        "include-all": true,
        "default-selected": AUTO.AI,
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

// --- 主入口 ---

export function smartMain(config: ClashConfig): ClashConfig {
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

  config["proxy-groups"] = buildSmartProxyGroups(
    hasProxySource(config),
    POLICY_PRIORITY,
  );

  applyRuntime(config);
  applySniffer(config);
  applyTun(config);
  applyDns(config);

  return config;
}
