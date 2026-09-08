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

/**
 * FlClash 手机端极简版覆写脚本
 * ------------------------------------------------------------------
 * 核心设计：
 * 1. 采用三个极简策略组（全部 / AI / 广告拦截）
 * 2. 节点纳入方式采用内核 include-all + exclude-filter，订阅更新无需重新执行脚本
 * 3. 完美兼容 proxy-providers 与普通 proxies 订阅
 * 4. 适配 QuickJS 单参数 main(config) 运行时
 */

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

/**
 * include-all 组的空成员兜底（empty-fallback）。
 * 过滤后空组显式回退至 DIRECT，避免 UI 显示含混的 COMPATIBLE。
 */
const EMPTY_FALLBACK = { "empty-fallback": "DIRECT" };

// --- 策略组构建 ---

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
  // 内核侧的 empty-fallback 如今也能得到等价结果，但这里仍在脚本侧显式
  // 回退：一是产物在 v1.19.27 之前的旧内核上照样正确，二是 App 的策略组
  // 列表里直接看得到 DIRECT，不用去猜空组会落到哪。
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
        ...EMPTY_FALLBACK,
      },
      EXCLUDE_COMMON,
    ),
    withExclude(
      {
        name: GROUPS.ALL,
        type: "select",
        proxies: [AUTO.ALL],
        "include-all": true,
        // 默认选中自动测速。此前靠「排在 proxies[0]」隐式生效
        // （内核 selectedProxy 找不到选中项时返回第一个成员），
        // 写成 default-selected 后语义明确，也不受成员顺序变化影响。
        "default-selected": AUTO.ALL,
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
        ...EMPTY_FALLBACK,
      },
      EXCLUDE_AI,
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
