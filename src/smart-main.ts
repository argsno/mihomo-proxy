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
 * 与 bettbox-flclash 相同的完整分流布局（main / All / GLOBAL / 地区分组 /
 * 服务分流组 + Bettbox 可视化开关），唯一区别：所有自动选路组由
 * url-test 换成 Bettbox 内核的 smart 类型。
 *
 *   smart 组按真实连接质量打分选路 —— 首响应延迟 EWMA + 重传惩罚
 *   （1% ≈ 50ms）+ 失败降权 + 按站点记忆，失败时按优选集合 / 健康节点 /
 *   失败节点的顺序自动回退；内核固定每 5 分钟重测一轮。
 *   url-test 只看周期性测速延迟，感知不到真实连接质量，这是二者的核心差异。
 *
 *   「智能选路 - X」均为隐藏自动组，供对应 select 组打头：
 *     All / 各地区 / Other / AI（AI 组排除香港出口）
 *   其余分流与 Bettbox 完整版一致：Google / YouTube / Telegram / Steam /
 *   Apple / Microsoft / Spotify / 广告拦截，地区分组可在 Bettbox UI 中开关。
 *
 * 注意：smart 组是 Bettbox 内核专属能力，上游 mihomo 内核（FlClash /
 * Sparkle / Clash Verge Rev 等）会因 `unsupported type: smart` 校验失败。
 */

/**
 * Bettbox 可视化开关选项类型定义（与 bettbox-flclash 保持一致）
 */
export interface SmartRuleOptions {
  Google: boolean;
  YouTube: boolean;
  AI: boolean;
  Telegram: boolean;
  Steam: boolean;
  Apple: boolean;
  Microsoft: boolean;
  Spotify: boolean;
  广告拦截: boolean;
  地区分组: boolean;
  屏蔽QUIC: boolean;
}

/** 默认开关配置 */
export const DEFAULT_RULE_OPTIONS: SmartRuleOptions = {
  Google: true,
  YouTube: true,
  AI: true,
  Telegram: true,
  Steam: true,
  Apple: true,
  Microsoft: true,
  Spotify: true,
  广告拦截: true,
  地区分组: true,
  屏蔽QUIC: true,
};

/** 宿主/全局作用域中声明的 ruleOptionsEnable（由 Bettbox 注入或用户修改） */
declare const ruleOptionsEnable: Record<string, boolean> | undefined;

/**
 * 动态获取 Bettbox 规则开关配置。
 * 优先读取宿主环境中注入的词法/全局作用域 ruleOptionsEnable（经用户自定义设置覆盖后的值），
 * 未设置的项回退至 DEFAULT_RULE_OPTIONS。
 */
export function getRuleOptions(): SmartRuleOptions {
  let hostOptions: Record<string, boolean> | undefined;
  try {
    if (
      typeof ruleOptionsEnable !== "undefined" &&
      ruleOptionsEnable &&
      typeof ruleOptionsEnable === "object"
    ) {
      hostOptions = ruleOptionsEnable;
    }
  } catch {
    // 忽略未定义错误
  }
  if (!hostOptions && typeof globalThis !== "undefined") {
    const g = globalThis as Record<string, unknown>;
    if (g.ruleOptionsEnable && typeof g.ruleOptionsEnable === "object") {
      hostOptions = g.ruleOptionsEnable as Record<string, boolean>;
    }
  }
  return {
    ...DEFAULT_RULE_OPTIONS,
    ...(hostOptions || {}),
  };
}

// --- 策略组名称定义 ---

const GROUPS = {
  MAIN: "main",
  ALL: "All",
  AI: "AI",
  GOOGLE: "Google",
  YOUTUBE: "YouTube",
  TELEGRAM: "Telegram",
  STEAM: "Steam",
  APPLE: "Apple",
  MICROSOFT: "Microsoft",
  SPOTIFY: "Spotify",
  ADBLOCK: "广告拦截",
  GLOBAL: "GLOBAL",
  OTHER: "Other",
};

/** 隐藏智能选路组名前缀（对应 bettbox-flclash 的 "URL Test - "） */
const SMART_PREFIX = "智能选路 - ";

// --- 地区正则过滤规则定义 ---

interface RegionDef {
  name: string;
  /** include-all filter 正则（dlclark/regexp2 格式） */
  filter: string;
  icon: string;
}

/**
 * 地区定义与 filter 正则
 * 使用 (?i)(?:pattern1|pattern2) 语法统一包裹。
 */
const REGION_DEFS: RegionDef[] = [
  {
    name: "HK",
    filter: "(?i)(?:香港|HK|HKG|HONGKONG|HONG KONG|🇭🇰)",
    icon: "Hong_Kong.png",
  },
  {
    name: "TW",
    filter: "(?i)(?:台湾|台北|新北|TW|TWN|TAIWAN|TAIPEI|🇹🇼)",
    icon: "Taiwan.png",
  },
  {
    name: "JP",
    filter: "(?i)(?:日本|东京|大阪|JP|JPN|JAPAN|TOKYO|OSAKA|🇯🇵)",
    icon: "Japan.png",
  },
  {
    name: "SG",
    filter: "(?i)(?:新加坡|狮城|SG|SGP|SINGAPORE|🇸🇬)",
    icon: "Singapore.png",
  },
  {
    name: "KR",
    filter: "(?i)(?:韩国|首尔|KR|KOR|KOREA|SEOUL|🇰🇷)",
    icon: "Korea.png",
  },
  {
    name: "US",
    filter:
      "(?i)(?:美国|纽约|旧金山|洛杉矶|西雅图|芝加哥|US|USA|NEW YORK|SAN FRANCISCO|LOS ANGELES|SEATTLE|CHICAGO|🇺🇸)",
    icon: "United_States.png",
  },
  {
    name: "EU",
    filter:
      "(?i)(?:欧洲|德国|法国|英国|荷兰|俄罗斯|意大利|西班牙|瑞典|瑞士|波兰|芬兰|土耳其|爱尔兰|奥地利|法兰克福|伦敦|EU|DE|FR|UK|GB|NL|RU|IT|ES|SE|CH|PL|FI|TR|IE|AT|GERMANY|FRANCE|LONDON|FRANKFURT|🇪🇺|🇩🇪|🇫🇷|🇬🇧|🇳🇱|🇷🇺|🇮🇹|🇪🇸|🇸🇪|🇨🇭|🇵🇱|🇫🇮|🇹🇷|🇮🇪|🇦🇹|🇧🇪)",
    icon: "European_Union.png",
  },
  {
    name: "AU",
    filter:
      "(?i)(?:澳大利亚|澳洲|悉尼|墨尔本|AU|AUS|AUSTRALIA|SYDNEY|MELBOURNE|🇦🇺)",
    icon: "Australia.png",
  },
  {
    name: "AS",
    filter:
      "(?i)(?:越南|泰国|马来西亚|印尼|菲律宾|印度|VN|TH|MY|ID|PH|IN|VIETNAM|THAILAND|MALAYSIA|INDONESIA|PHILIPPINES|MANILA|🇻🇳|🇹🇭|🇲🇾|🇮🇩|🇵🇭|🇮🇳)",
    icon: "Asia_Map.png",
  },
];

/** 地区展示顺序（与 settings.ts REGION_ORDER 一致） */
const REGION_ORDER = ["HK", "TW", "JP", "SG", "KR", "US", "EU", "AU", "AS"];

// --- 节点过滤器（RegExp → dlclark/regexp2 正则转换） ---

/** 香港节点识别（AI 组需剔除香港出口） */
const HK_FILTER = /香港|HK|HKG|HONGKONG|HONG KONG|🇭🇰/i;

/**
 * 取正则源码，空正则返回 ""。
 * 空 RegExp 的 source 是 "(?:)"，直接拼入过滤器会匹配空串导致所有节点被排除。
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
 * 为 include-all 组同时设置 filter（地区白名单）和 exclude-filter（信息节点黑名单）。
 */
const withFilters = (
  group: ProxyGroup,
  includeFilter: string,
  excludeFilter: string,
): ProxyGroup => {
  const result = { ...group };
  if (includeFilter) result.filter = includeFilter;
  if (excludeFilter) result["exclude-filter"] = excludeFilter;
  return result;
};

/**
 * include-all 组的空成员兜底（empty-fallback）。
 * 过滤后空组显式回退至 DIRECT，避免 UI 显示含混的 COMPATIBLE。
 */
const EMPTY_FALLBACK = { "empty-fallback": "DIRECT" };

/**
 * 仅在用户配置了 policy-priority 时写入字段（空字符串会被内核判为非法值）。
 * smart 组按正则给节点配优先级（系数 <1 提升、>1 降低），仅对 smart 组生效。
 */
const withPolicyPriority = (
  group: ProxyGroup,
  policyPriority: string,
): ProxyGroup =>
  policyPriority.trim()
    ? { ...group, "policy-priority": policyPriority }
    : group;

// --- 规则出口目标构建（基于 ruleOptionsEnable 动态映射） ---

/**
 * 根据 SmartRuleOptions 构建分流规则出口。
 * 当某个服务的开关为 false 时，该服务的流量平滑回退到 main 组。
 */
const buildRuleTargets = (options: SmartRuleOptions): RuleTargets => ({
  adblock: options.广告拦截 ? GROUPS.ADBLOCK : "REJECT",
  ai: options.AI ? GROUPS.AI : GROUPS.MAIN,
  google: options.Google ? GROUPS.GOOGLE : GROUPS.MAIN,
  youtube: options.YouTube ? GROUPS.YOUTUBE : GROUPS.MAIN,
  telegram: options.Telegram ? GROUPS.TELEGRAM : GROUPS.MAIN,
  steam: options.Steam ? GROUPS.STEAM : GROUPS.MAIN,
  apple: options.Apple ? GROUPS.APPLE : GROUPS.MAIN,
  microsoft: options.Microsoft ? GROUPS.MICROSOFT : GROUPS.MAIN,
  spotify: options.Spotify ? GROUPS.SPOTIFY : GROUPS.MAIN,
  proxy: GROUPS.MAIN,
  blockQuic: options.屏蔽QUIC,
});

// --- 节点来源判断 ---

/**
 * 订阅是否提供了可用节点来源。
 * FlClash/Bettbox 在调用脚本前会将缺失的 proxy-providers 补成 {}，故必须判断 key 数量。
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

// --- 策略组构建（完整策略组 + 地区分组 + 可视化开关 + smart 自动组） ---

/**
 * 构建策略组（导出供单测直接断言）。
 *
 * include-all 的内核语义与过滤时机同 bettbox-flclash：
 * 组成员由内核在 GroupBase.GetProxies 里 filter/exclude-filter 过滤后得到，
 * 这里只声明空成员兜底与默认选中项。
 */
export const buildSmartProxyGroups = (
  hasNodes: boolean,
  options: SmartRuleOptions = DEFAULT_RULE_OPTIONS,
  policyPriority: string = POLICY_PRIORITY,
): ProxyGroup[] => {
  const icon = (f: string) => SETTINGS.ICON_BASE + f;
  const enableRegion = options.地区分组;

  /**
   * 隐藏智能选路组通用构造：smart 类型 + 内核固定 5 分钟重测
   * （不写 interval/tolerance）+ 空成员兜底 + 用户级节点优先级。
   */
  const smartAuto = (name: string, iconFile: string): ProxyGroup =>
    withPolicyPriority(
      {
        name,
        type: "smart",
        proxies: [],
        "include-all": true,
        icon: icon(iconFile),
        ...SETTINGS.SMART_EXTRA,
        ...EMPTY_FALLBACK,
      },
      policyPriority,
    );

  // ─── 无节点来源：全部组回退 DIRECT ───
  if (!hasNodes) {
    const fallback: ProxyGroup[] = [
      {
        name: GROUPS.MAIN,
        type: "select",
        proxies: ["DIRECT"],
        icon: icon("Available.png"),
      },
      {
        name: GROUPS.ALL,
        type: "select",
        proxies: ["DIRECT"],
        icon: icon("Auto.png"),
      },
    ];
    // 有开关的服务组也需生成（否则规则引用会报错），但回退 main
    if (options.AI)
      fallback.push({
        name: GROUPS.AI,
        type: "select",
        proxies: [GROUPS.MAIN],
        icon: icon("ChatGPT.png"),
      });
    if (options.Google)
      fallback.push({
        name: GROUPS.GOOGLE,
        type: "select",
        proxies: [GROUPS.MAIN],
        icon: icon("Google_Search.png"),
      });
    if (options.YouTube)
      fallback.push({
        name: GROUPS.YOUTUBE,
        type: "select",
        proxies: [GROUPS.MAIN],
        icon: icon("YouTube.png"),
      });
    if (options.Telegram)
      fallback.push({
        name: GROUPS.TELEGRAM,
        type: "select",
        proxies: [GROUPS.MAIN],
        icon: icon("Telegram.png"),
      });
    if (options.Steam)
      fallback.push({
        name: GROUPS.STEAM,
        type: "select",
        proxies: [GROUPS.MAIN, "DIRECT"],
        icon: icon("Steam.png"),
      });
    if (options.Apple)
      fallback.push({
        name: GROUPS.APPLE,
        type: "select",
        proxies: [GROUPS.MAIN, "DIRECT"],
        icon: icon("Apple.png"),
      });
    if (options.Microsoft)
      fallback.push({
        name: GROUPS.MICROSOFT,
        type: "select",
        proxies: [GROUPS.MAIN, "DIRECT"],
        icon: icon("Microsoft.png"),
      });
    if (options.Spotify)
      fallback.push({
        name: GROUPS.SPOTIFY,
        type: "select",
        proxies: [GROUPS.MAIN],
        icon: icon("Spotify.png"),
      });
    if (options.广告拦截)
      fallback.push({
        name: GROUPS.ADBLOCK,
        type: "select",
        proxies: ["REJECT", "DIRECT", GROUPS.MAIN],
        icon: icon("AdBlack.png"),
      });
    fallback.push({
      name: GROUPS.GLOBAL,
      type: "select",
      proxies: [GROUPS.MAIN, "DIRECT"],
      icon: icon("Global.png"),
    });
    return fallback;
  }

  // ─── 有节点来源：完整策略组体系 ───
  const groups: ProxyGroup[] = [];

  // 1. All：全局智能选路 + 手动选择
  groups.push(
    withExclude(smartAuto(`${SMART_PREFIX}All`, "Auto.png"), EXCLUDE_COMMON),
  );
  groups.push(
    withExclude(
      {
        name: GROUPS.ALL,
        type: "select",
        proxies: [`${SMART_PREFIX}All`],
        "include-all": true,
        "default-selected": `${SMART_PREFIX}All`,
        icon: icon("Auto.png"),
      },
      EXCLUDE_COMMON,
    ),
  );

  // 2. 地区分组（可通过 ruleOptionsEnable.地区分组 关闭）
  const regionNames: string[] = [];
  if (enableRegion) {
    for (const rName of REGION_ORDER) {
      const def = REGION_DEFS.find((r) => r.name === rName);
      if (!def) continue;

      // 地区隐藏智能选路组
      groups.push(
        withFilters(
          smartAuto(`${SMART_PREFIX}${def.name}`, def.icon),
          def.filter,
          EXCLUDE_COMMON,
        ),
      );

      // 地区手动选择组
      groups.push(
        withFilters(
          {
            name: def.name,
            type: "select",
            proxies: [`${SMART_PREFIX}${def.name}`],
            "include-all": true,
            "default-selected": `${SMART_PREFIX}${def.name}`,
            icon: icon(def.icon),
          },
          def.filter,
          EXCLUDE_COMMON,
        ),
      );

      regionNames.push(def.name);
    }
  }

  // 3. Other 组（非地区节点兜底）—— 仅在启用地区分组时生成
  //    用 exclude-filter 排除所有已知地区的节点
  if (enableRegion) {
    const allRegionPatterns = REGION_DEFS.map((r) =>
      // 去掉外层 (?i)(?:...) 包裹，取内部 pattern
      r.filter.replace(/^\(\?i\)\(\?:/, "").replace(/\)$/, ""),
    ).join("|");
    // Other 组的 exclude-filter = 信息节点 + 用户自定义 + 所有地区匹配
    const otherExclude = EXCLUDE_COMMON
      ? `(?i)(?:${EXCLUDE_COMMON.replace(/^\(\?i\)\(\?:/, "").replace(/\)$/, "")}|${allRegionPatterns})`
      : `(?i)(?:${allRegionPatterns})`;

    groups.push(
      withExclude(
        smartAuto(`${SMART_PREFIX}Other`, "Available.png"),
        otherExclude,
      ),
    );
    groups.push(
      withExclude(
        {
          name: GROUPS.OTHER,
          type: "select",
          proxies: [`${SMART_PREFIX}Other`],
          "include-all": true,
          "default-selected": `${SMART_PREFIX}Other`,
          icon: icon("Available.png"),
        },
        otherExclude,
      ),
    );
  }

  // 4. main 组：顶层入口
  const mainProxies = [
    GROUPS.ALL,
    ...regionNames,
    ...(enableRegion ? [GROUPS.OTHER] : []),
  ];
  groups.push({
    name: GROUPS.MAIN,
    type: "select",
    proxies: mainProxies,
    "default-selected": GROUPS.ALL,
    icon: icon("Available.png"),
  });

  // 5. 分流服务组（根据 ruleOptionsEnable 按需生成）
  /** 服务组的 proxies 列表：main → 地区 → Other → DIRECT */
  const serviceProxies = [
    GROUPS.MAIN,
    GROUPS.ALL,
    ...regionNames,
    ...(enableRegion ? [GROUPS.OTHER] : []),
  ];
  const serviceWithDirect = [...serviceProxies, "DIRECT"];

  // AI 组（排除香港）
  if (options.AI) {
    groups.push(
      withExclude(smartAuto(`${SMART_PREFIX}AI`, "ChatGPT.png"), EXCLUDE_AI),
    );
    const aiRegions = regionNames.filter((r) => r !== "HK");
    groups.push({
      name: GROUPS.AI,
      type: "select",
      proxies: [
        `${SMART_PREFIX}AI`,
        ...aiRegions,
        GROUPS.MAIN,
        ...(enableRegion ? [GROUPS.OTHER] : []),
      ],
      "default-selected": `${SMART_PREFIX}AI`,
      icon: icon("ChatGPT.png"),
    });
  }

  // Google
  if (options.Google) {
    groups.push({
      name: GROUPS.GOOGLE,
      type: "select",
      proxies: serviceProxies,
      icon: icon("Google_Search.png"),
    });
  }

  // YouTube（默认走 Google 组统一出口）
  if (options.YouTube) {
    const ytProxies = options.Google
      ? [GROUPS.GOOGLE, ...serviceProxies]
      : serviceProxies;
    groups.push({
      name: GROUPS.YOUTUBE,
      type: "select",
      proxies: ytProxies,
      "default-selected": options.Google ? GROUPS.GOOGLE : GROUPS.MAIN,
      icon: icon("YouTube.png"),
    });
  }

  // Telegram（首选新加坡，fallback 到 main）
  if (options.Telegram) {
    const hasSG = regionNames.includes("SG");
    if (hasSG) {
      groups.push({
        name: "Telegram - Fallback",
        type: "fallback",
        proxies: ["SG", GROUPS.MAIN],
        icon: icon("Telegram.png"),
        ...SETTINGS.MOBILE_URL_TEST_EXTRA,
      });
    }
    groups.push({
      name: GROUPS.TELEGRAM,
      type: "select",
      proxies: [
        ...(hasSG ? ["Telegram - Fallback", "SG"] : []),
        ...serviceProxies,
      ],
      "default-selected": hasSG ? "Telegram - Fallback" : GROUPS.MAIN,
      icon: icon("Telegram.png"),
    });
  }

  // Steam
  if (options.Steam) {
    groups.push({
      name: GROUPS.STEAM,
      type: "select",
      proxies: serviceWithDirect,
      icon: icon("Steam.png"),
    });
  }

  // Apple
  if (options.Apple) {
    groups.push({
      name: GROUPS.APPLE,
      type: "select",
      proxies: serviceWithDirect,
      icon: icon("Apple.png"),
    });
  }

  // Microsoft
  if (options.Microsoft) {
    groups.push({
      name: GROUPS.MICROSOFT,
      type: "select",
      proxies: serviceWithDirect,
      icon: icon("Microsoft.png"),
    });
  }

  // Spotify
  if (options.Spotify) {
    groups.push({
      name: GROUPS.SPOTIFY,
      type: "select",
      proxies: serviceProxies,
      icon: icon("Spotify.png"),
    });
  }

  // 广告拦截
  if (options.广告拦截) {
    groups.push({
      name: GROUPS.ADBLOCK,
      type: "select",
      proxies: ["REJECT", "DIRECT", GROUPS.MAIN],
      icon: icon("AdBlack.png"),
    });
  }

  // 6. GLOBAL 组
  groups.push({
    name: GROUPS.GLOBAL,
    type: "select",
    proxies: [
      GROUPS.MAIN,
      GROUPS.ALL,
      ...(options.AI ? [GROUPS.AI] : []),
      ...(options.Google ? [GROUPS.GOOGLE] : []),
      ...(options.YouTube ? [GROUPS.YOUTUBE] : []),
      ...(options.Telegram ? [GROUPS.TELEGRAM] : []),
      ...(options.Steam ? [GROUPS.STEAM] : []),
      ...(options.Apple ? [GROUPS.APPLE] : []),
      ...(options.Microsoft ? [GROUPS.MICROSOFT] : []),
      ...(options.Spotify ? [GROUPS.SPOTIFY] : []),
      ...regionNames,
      ...(enableRegion ? [GROUPS.OTHER] : []),
      "DIRECT",
    ],
    icon: icon("Global.png"),
  });

  return groups;
};

// --- 主入口 ---

export function smartMain(config: ClashConfig): ClashConfig {
  config = config && typeof config === "object" ? config : {};
  const options = getRuleOptions();
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

  // 根据 options 构建分流规则出口
  const ruleTargets = buildRuleTargets(options);

  config["rule-providers"] = {
    ...(config["rule-providers"] || {}),
    ...buildRuleProviders(),
  };
  config.rules = mergeRules(
    buildStaticRules(ruleTargets),
    pickDirectRules(existingRules),
  );

  // 重名去冲突：内核在解析阶段遇到同名节点会直接报错，必须先处理。
  // 除此之外不改写 config.proxies —— 节点由内核按 include-all 在运行时
  // 纳入策略组，脚本无需（也不应该）枚举节点名。
  makeProxyNamesUnique(originalProxies);
  if (originalProxies.length) config.proxies = originalProxies;

  config["proxy-groups"] = buildSmartProxyGroups(
    hasProxySource(config),
    options,
  );

  applyRuntime(config);
  applySniffer(config);
  applyTun(config);
  applyDns(config);

  return config;
}
