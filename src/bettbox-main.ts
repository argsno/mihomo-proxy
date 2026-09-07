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
// bettbox-flclash —— Bettbox / FlClash 系列专属覆写脚本
// ------------------------------------------------------------
// 在 flclash-mobile 的 include-all + exclude-filter 架构基础上，
// 扩展为完整分流策略组（Google/YouTube/AI/Telegram/Steam/Apple/
// Microsoft/Spotify）、按地区自动分组（HK/TW/JP/SG/KR/US/EU/AU/AS）、
// 并集成 Bettbox 独有的 Compatible_With_Bettbox 声明 + ruleOptionsEnable
// 可视化开关适配。
//
// 核心设计：
//   - 节点纳入方式：内核侧 include-all + filter/exclude-filter
//     （运行时动态纳入，订阅更新无需重新应用脚本，proxy-providers 也能正确分组）
//   - 地区分组：每个地区一对 url-test + select，通过 filter 匹配地区关键词
//   - 分流策略组：每个服务一个 select 组，可通过 ruleOptionsEnable 逐个关闭
//   - Bettbox UI 适配：首行 Compatible_With_Bettbox 声明激活可视化开关面板
//
// 运行时约定与 FlClash 一致（lib/common/javascript.dart）：
//   引擎为 flutter_js → QuickJS，调用形式 `main(config)` 只传 1 个参数。
//   FlClash/Bettbox 在脚本执行后会强制改写的字段同 flclash-main.ts 头注释。
// ============================================================

// ============================================================
// Bettbox 兼容声明 —— 运行时不参与逻辑，Bettbox 通过静态文本扫描
// 脚本首行来识别此声明，从而在 UI 中渲染可视化配置面板。
// 本文件中此常量会被 Vite banner 注入到产物首行（脚本顶层作用域），
// 因此这里只需定义 ruleOptionsEnable 供逻辑使用。
// ============================================================

/**
 * 可视化开关配置对象。
 * Bettbox 会从产物文件中读取 `ruleOptionsEnable` 的 key-value，
 * 在客户端 UI 中生成对应的 toggle switch：
 *   - 分流策略：控制对应服务分流到专属策略组还是回退到 main 组
 *   - 节点管理：控制地区分组、QUIC 屏蔽等行为
 *
 * 用户在 Bettbox 中切换开关后，会修改此对象的值并重新执行脚本。
 */
const ruleOptionsEnable: Record<string, boolean> = {
  // 分流策略
  Google: true,
  YouTube: true,
  AI: true,
  Telegram: true,
  Steam: true,
  Apple: true,
  Microsoft: true,
  Spotify: true,
  广告拦截: true,
  // 节点管理
  地区分组: true,
  屏蔽QUIC: true,
};

// ============================================================
// 策略组名常量
// ============================================================

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

/** 测速组名前缀 */
const URL_TEST_PREFIX = "URL Test - ";

// ============================================================
// 地区 filter 映射（include-all 的 filter 字段使用）
// ============================================================

interface RegionDef {
  name: string;
  /** include-all filter 正则（dlclark/regexp2 .NET 风格） */
  filter: string;
  icon: string;
}

/**
 * 地区定义与 filter 正则。
 * filter 使用 (?i) 内联不区分大小写标志，格式为 (?i)(?:pattern1|pattern2)。
 * dlclark/regexp2 支持 Unicode 但不保证与 JS RegExp 完全一致，
 * 这里尽量使用简单的字面量匹配。
 */
const REGION_DEFS: RegionDef[] = [
  {
    name: "HK",
    filter:
      "(?i)(?:香港|HK|HKG|HONGKONG|HONG KONG|🇭🇰)",
    icon: "Hong_Kong.png",
  },
  {
    name: "TW",
    filter:
      "(?i)(?:台湾|台北|新北|TW|TWN|TAIWAN|TAIPEI|🇹🇼)",
    icon: "Taiwan.png",
  },
  {
    name: "JP",
    filter:
      "(?i)(?:日本|东京|大阪|JP|JPN|JAPAN|TOKYO|OSAKA|🇯🇵)",
    icon: "Japan.png",
  },
  {
    name: "SG",
    filter:
      "(?i)(?:新加坡|狮城|SG|SGP|SINGAPORE|🇸🇬)",
    icon: "Singapore.png",
  },
  {
    name: "KR",
    filter:
      "(?i)(?:韩国|首尔|KR|KOR|KOREA|SEOUL|🇰🇷)",
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
const REGION_ORDER = [
  "HK",
  "TW",
  "JP",
  "SG",
  "KR",
  "US",
  "EU",
  "AU",
  "AS",
];

// ============================================================
// 节点过滤器 —— JS RegExp → mihomo filter 字符串
// ============================================================

/** 香港节点识别（AI 组需剔除，OpenAI/Claude 等常封锁 HK 出口） */
const HK_FILTER = /香港|HK|HKG|HONGKONG|HONG KONG|🇭🇰/i;

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
 * mihomo 的 filter / exclude-filter 由 dlclark/regexp2 编译（.NET 风格），
 * 支持 `(?i)` 内联选项。统一包进非捕获组 `(?i)(?:...)` 确保对全部分支生效。
 * 返回空串表示不设置该字段。
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

/**
 * 为 include-all 组同时设置 filter（地区白名单）和 exclude-filter（信息节点黑名单）。
 * filter 确保只纳入某地区节点，exclude-filter 剔除信息类节点。
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
 * include-all 组的空成员兜底（内核 v1.19.27+）。
 * 注意：empty-fallback 只接受 proxy 名，填策略组会被内核直接判错。
 */
const EMPTY_FALLBACK = { "empty-fallback": "DIRECT" };

// ============================================================
// 规则出口目标构建（基于 ruleOptionsEnable 动态映射）
// ============================================================

/**
 * 根据 ruleOptionsEnable 构建分流规则出口。
 * 当某个服务的开关为 false 时，该服务的流量回退到 main 组。
 */
const buildRuleTargets = (): RuleTargets => ({
  adblock: ruleOptionsEnable.广告拦截 ? GROUPS.ADBLOCK : "REJECT",
  ai: ruleOptionsEnable.AI ? GROUPS.AI : GROUPS.MAIN,
  google: ruleOptionsEnable.Google ? GROUPS.GOOGLE : GROUPS.MAIN,
  youtube: ruleOptionsEnable.YouTube ? GROUPS.YOUTUBE : GROUPS.MAIN,
  telegram: ruleOptionsEnable.Telegram ? GROUPS.TELEGRAM : GROUPS.MAIN,
  steam: ruleOptionsEnable.Steam ? GROUPS.STEAM : GROUPS.MAIN,
  apple: ruleOptionsEnable.Apple ? GROUPS.APPLE : GROUPS.MAIN,
  microsoft: ruleOptionsEnable.Microsoft ? GROUPS.MICROSOFT : GROUPS.MAIN,
  proxy: GROUPS.MAIN,
});

// ============================================================
// 判断是否有节点来源
// ============================================================

/**
 * FlClash/Bettbox 在调用脚本前会把缺失的 proxy-providers 补成 {}，
 * 所以必须判 key 数量而不是判字段是否存在。
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

// ============================================================
// ProxyGroups —— 完整策略组（include-all 运行时纳入）
// ============================================================

const buildBettboxProxyGroups = (hasNodes: boolean): ProxyGroup[] => {
  const icon = (f: string) => SETTINGS.ICON_BASE + f;
  const enableRegion = ruleOptionsEnable.地区分组;

  // ─── 无节点来源：全部组回退 DIRECT ───
  if (!hasNodes) {
    const fallback: ProxyGroup[] = [
      { name: GROUPS.MAIN, type: "select", proxies: ["DIRECT"], icon: icon("Available.png") },
      { name: GROUPS.ALL, type: "select", proxies: ["DIRECT"], icon: icon("Auto.png") },
    ];
    // 有开关的服务组也需生成（否则规则引用会报错），但回退 main
    if (ruleOptionsEnable.AI)
      fallback.push({ name: GROUPS.AI, type: "select", proxies: [GROUPS.MAIN], icon: icon("ChatGPT.png") });
    if (ruleOptionsEnable.Google)
      fallback.push({ name: GROUPS.GOOGLE, type: "select", proxies: [GROUPS.MAIN], icon: icon("Google_Search.png") });
    if (ruleOptionsEnable.YouTube)
      fallback.push({ name: GROUPS.YOUTUBE, type: "select", proxies: [GROUPS.MAIN], icon: icon("YouTube.png") });
    if (ruleOptionsEnable.Telegram)
      fallback.push({ name: GROUPS.TELEGRAM, type: "select", proxies: [GROUPS.MAIN], icon: icon("Telegram.png") });
    if (ruleOptionsEnable.Steam)
      fallback.push({ name: GROUPS.STEAM, type: "select", proxies: [GROUPS.MAIN, "DIRECT"], icon: icon("Steam.png") });
    if (ruleOptionsEnable.Apple)
      fallback.push({ name: GROUPS.APPLE, type: "select", proxies: [GROUPS.MAIN, "DIRECT"], icon: icon("Apple.png") });
    if (ruleOptionsEnable.Microsoft)
      fallback.push({ name: GROUPS.MICROSOFT, type: "select", proxies: [GROUPS.MAIN, "DIRECT"], icon: icon("Microsoft.png") });
    if (ruleOptionsEnable.广告拦截)
      fallback.push({ name: GROUPS.ADBLOCK, type: "select", proxies: ["REJECT", "DIRECT", GROUPS.MAIN], icon: icon("AdBlack.png") });
    fallback.push({ name: GROUPS.GLOBAL, type: "select", proxies: [GROUPS.MAIN, "DIRECT"], icon: icon("Global.png") });
    return fallback;
  }

  // ─── 有节点来源：完整策略组体系 ───
  const groups: ProxyGroup[] = [];

  // 1. All：全局自动测速 + 手动选择
  groups.push(
    withExclude(
      {
        name: `${URL_TEST_PREFIX}All`,
        type: "url-test",
        proxies: [],
        "include-all": true,
        icon: icon("Auto.png"),
        ...SETTINGS.MOBILE_URL_TEST_EXTRA,
        ...EMPTY_FALLBACK,
      },
      EXCLUDE_COMMON,
    ),
  );
  groups.push(
    withExclude(
      {
        name: GROUPS.ALL,
        type: "select",
        proxies: [`${URL_TEST_PREFIX}All`],
        "include-all": true,
        "default-selected": `${URL_TEST_PREFIX}All`,
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

      // 地区隐藏测速组
      groups.push(
        withFilters(
          {
            name: `${URL_TEST_PREFIX}${def.name}`,
            type: "url-test",
            proxies: [],
            "include-all": true,
            icon: icon(def.icon),
            ...SETTINGS.MOBILE_URL_TEST_EXTRA,
            ...EMPTY_FALLBACK,
          },
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
            proxies: [`${URL_TEST_PREFIX}${def.name}`],
            "include-all": true,
            "default-selected": `${URL_TEST_PREFIX}${def.name}`,
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
        {
          name: `${URL_TEST_PREFIX}Other`,
          type: "url-test",
          proxies: [],
          "include-all": true,
          icon: icon("Available.png"),
          ...SETTINGS.MOBILE_URL_TEST_EXTRA,
          ...EMPTY_FALLBACK,
        },
        otherExclude,
      ),
    );
    groups.push(
      withExclude(
        {
          name: GROUPS.OTHER,
          type: "select",
          proxies: [`${URL_TEST_PREFIX}Other`],
          "include-all": true,
          "default-selected": `${URL_TEST_PREFIX}Other`,
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
  if (ruleOptionsEnable.AI) {
    groups.push(
      withExclude(
        {
          name: `${URL_TEST_PREFIX}AI`,
          type: "url-test",
          proxies: [],
          "include-all": true,
          icon: icon("ChatGPT.png"),
          ...SETTINGS.MOBILE_URL_TEST_EXTRA,
          ...EMPTY_FALLBACK,
        },
        EXCLUDE_AI,
      ),
    );
    const aiRegions = regionNames.filter((r) => r !== "HK");
    groups.push({
      name: GROUPS.AI,
      type: "select",
      proxies: [
        `${URL_TEST_PREFIX}AI`,
        ...aiRegions,
        GROUPS.MAIN,
        ...(enableRegion ? [GROUPS.OTHER] : []),
      ],
      "default-selected": `${URL_TEST_PREFIX}AI`,
      icon: icon("ChatGPT.png"),
    });
  }

  // Google
  if (ruleOptionsEnable.Google) {
    groups.push({
      name: GROUPS.GOOGLE,
      type: "select",
      proxies: serviceProxies,
      icon: icon("Google_Search.png"),
    });
  }

  // YouTube（默认走 Google 组统一出口）
  if (ruleOptionsEnable.YouTube) {
    const ytProxies = ruleOptionsEnable.Google
      ? [GROUPS.GOOGLE, ...serviceProxies]
      : serviceProxies;
    groups.push({
      name: GROUPS.YOUTUBE,
      type: "select",
      proxies: ytProxies,
      "default-selected": ruleOptionsEnable.Google ? GROUPS.GOOGLE : GROUPS.MAIN,
      icon: icon("YouTube.png"),
    });
  }

  // Telegram（首选新加坡，fallback 到 main）
  if (ruleOptionsEnable.Telegram) {
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
  if (ruleOptionsEnable.Steam) {
    groups.push({
      name: GROUPS.STEAM,
      type: "select",
      proxies: serviceWithDirect,
      icon: icon("Steam.png"),
    });
  }

  // Apple
  if (ruleOptionsEnable.Apple) {
    groups.push({
      name: GROUPS.APPLE,
      type: "select",
      proxies: serviceWithDirect,
      icon: icon("Apple.png"),
    });
  }

  // Microsoft
  if (ruleOptionsEnable.Microsoft) {
    groups.push({
      name: GROUPS.MICROSOFT,
      type: "select",
      proxies: serviceWithDirect,
      icon: icon("Microsoft.png"),
    });
  }

  // Spotify
  if (ruleOptionsEnable.Spotify) {
    groups.push({
      name: GROUPS.SPOTIFY,
      type: "select",
      proxies: serviceProxies,
      icon: icon("Spotify.png"),
    });
  }

  // 广告拦截
  if (ruleOptionsEnable.广告拦截) {
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
      ...(ruleOptionsEnable.AI ? [GROUPS.AI] : []),
      ...(ruleOptionsEnable.Google ? [GROUPS.GOOGLE] : []),
      ...(ruleOptionsEnable.YouTube ? [GROUPS.YOUTUBE] : []),
      ...(ruleOptionsEnable.Telegram ? [GROUPS.TELEGRAM] : []),
      ...(ruleOptionsEnable.Steam ? [GROUPS.STEAM] : []),
      ...(ruleOptionsEnable.Apple ? [GROUPS.APPLE] : []),
      ...(ruleOptionsEnable.Microsoft ? [GROUPS.MICROSOFT] : []),
      ...regionNames,
      ...(enableRegion ? [GROUPS.OTHER] : []),
      "DIRECT",
    ],
    icon: icon("Global.png"),
  });

  return groups;
};

// ============================================================
// Main
// ============================================================

export function bettboxMain(config: ClashConfig): ClashConfig {
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

  // 根据 ruleOptionsEnable 构建分流规则出口
  const ruleTargets = buildRuleTargets();

  config["rule-providers"] = {
    ...(config["rule-providers"] || {}),
    ...buildRuleProviders(),
  };
  config.rules = mergeRules(
    buildStaticRules(ruleTargets),
    pickDirectRules(existingRules),
  );

  // 重名去冲突：内核在解析阶段遇到同名节点会直接报错
  makeProxyNamesUnique(originalProxies);
  if (originalProxies.length) config.proxies = originalProxies;

  config["proxy-groups"] = buildBettboxProxyGroups(hasProxySource(config));

  applyRuntime(config);
  applySniffer(config);
  applyTun(config);
  applyDns(config);

  return config;
}
