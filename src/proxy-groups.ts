import { SETTINGS } from "./settings";
import { uniq } from "./utils";
import type { ProxyGroup, RegionGroup } from "./types";

/**
 * 完整版策略组构建器
 * ------------------------------------------------------------------
 * 为桌面端（Sparkle / Clash Verge Rev）构建完整的策略组体系：
 * - 基础入口组：main / All / GLOBAL
 * - 地区策略组：HK / TW / JP / SG 等（包含隐藏自动测速与手动选择）
 * - 服务策略组：AI / Google / YouTube / Telegram / Steam / Apple / Microsoft
 */

export interface ProxyGroupsInput {
  allNames: string[];
  allAiNames: string[];
  activeRegionMap: Map<string, RegionGroup>;
  activeRegionNameSet: Set<string>;
  otherProxyNames: string[];
  infoNames: string[];
}

export const buildProxyGroups = ({
  allNames,
  allAiNames,
  activeRegionMap,
  activeRegionNameSet,
  otherProxyNames,
  infoNames,
}: ProxyGroupsInput): ProxyGroup[] => {
  const groups: ProxyGroup[] = [];
  const add = (
    name: string,
    type: string,
    proxies: string[],
    icon = "Available.png",
    extra: Record<string, any> = {},
  ) => {
    proxies = uniq(proxies);
    if (name && proxies.length)
      groups.push({
        name,
        type,
        proxies,
        icon: SETTINGS.ICON_BASE + icon,
        ...extra,
      });
  };

  // 按既定顺序筛选有可用节点的地区
  const regionEntries = SETTINGS.REGION_ORDER.filter((r) =>
    activeRegionNameSet.has(r),
  );
  const hasOther = otherProxyNames.length > 0;
  const hasNodes = allNames.length > 0;

  // --- 主选择组与全局节点组 ---
  if (hasNodes) {
    const mainEntries = [
      "All",
      ...regionEntries,
      ...(hasOther ? ["Other"] : []),
    ];
    add("main", "select", mainEntries, "Available.png", {
      "default-selected": "All",
    });
    add(
      "URL Test - All",
      "url-test",
      allNames,
      "Auto.png",
      SETTINGS.URL_TEST_EXTRA,
    );
    // 显式声明 default-selected，保证默认选中自动测速组
    add("All", "select", ["URL Test - All", ...allNames], "Auto.png", {
      "default-selected": "URL Test - All",
    });
  }

  // --- 地区分组（每个地区独立 url-test 与 select 组） ---
  regionEntries.forEach((rName) => {
    const region = activeRegionMap.get(rName);
    if (!region) return;
    add(
      `URL Test - ${region.name}`,
      "url-test",
      region.proxies,
      region.icon,
      SETTINGS.URL_TEST_EXTRA,
    );
    add(
      region.name,
      "select",
      [`URL Test - ${region.name}`, ...region.proxies],
      region.icon,
      { "default-selected": `URL Test - ${region.name}` },
    );
  });

  // --- Other 兜底组与信息类节点组 ---
  if (hasOther) {
    add(
      "URL Test - Other",
      "url-test",
      otherProxyNames,
      "Available.png",
      SETTINGS.URL_TEST_EXTRA,
    );
    add(
      "Other",
      "select",
      ["URL Test - Other", ...otherProxyNames],
      "Available.png",
      { "default-selected": "URL Test - Other" },
    );
  }
  if (infoNames.length) add("info", "select", infoNames, "Available.png");

  // --- 业务分流策略组 ---
  if (hasNodes) {
    // 代理优先列表：main → All → 各地区 → Other
    const proxyFirst = [
      "main",
      "All",
      ...regionEntries,
      ...(hasOther ? ["Other"] : []),
    ];
    // 兼具代理与直连需求的服务：追加 DIRECT
    const withDirect = [...proxyFirst, "DIRECT"];

    // AI 纯净池（排除香港节点）
    const aiRegions = regionEntries.filter((r) => r !== "HK");
    add(
      "URL Test - AI",
      "url-test",
      allAiNames,
      "ChatGPT.png",
      SETTINGS.URL_TEST_EXTRA,
    );
    add(
      "AI",
      "select",
      ["URL Test - AI", ...aiRegions, "main", ...(hasOther ? ["Other"] : [])],
      "ChatGPT.png",
      { "default-selected": "URL Test - AI" },
    );

    // Google 与 YouTube（YouTube 默认跟随 Google 出口，避免多出口 IP 触发风控）
    add("Google", "select", proxyFirst, "Google_Search.png");
    add("YouTube", "select", ["Google", ...proxyFirst], "YouTube.png", {
      "default-selected": "Google",
    });

    // Telegram（新加坡节点优先，附 fallback 自愈机制）
    const hasSG = activeRegionNameSet.has("SG");
    add(
      "Telegram - Fallback",
      "fallback",
      hasSG ? ["SG", "main"] : ["main"],
      "Telegram.png",
      SETTINGS.FALLBACK_TEST_EXTRA,
    );
    add(
      "Telegram",
      "select",
      ["Telegram - Fallback", ...(hasSG ? ["SG"] : []), ...proxyFirst],
      "Telegram.png",
      { "default-selected": "Telegram - Fallback" },
    );

    // Steam / Apple / Microsoft（默认走代理，可一键切直连）
    add("Steam", "select", withDirect, "Steam.png");
    add("Apple", "select", withDirect, "Apple.png");
    add("Microsoft", "select", withDirect, "Microsoft.png");
  } else {
    // 零节点回退：业务组回退 DIRECT 确保配置合法性
    const fallbackGroups: Array<[string, string]> = [
      ["main", "Available.png"],
      ["AI", "ChatGPT.png"],
      ["Google", "Google_Search.png"],
      ["YouTube", "YouTube.png"],
      ["Telegram", "Telegram.png"],
      ["Steam", "Steam.png"],
      ["Apple", "Apple.png"],
      ["Microsoft", "Microsoft.png"],
    ];
    fallbackGroups.forEach(([name, icon]) =>
      add(name, "select", ["DIRECT"], icon),
    );
  }

  // --- GLOBAL 全局汇总组 ---
  add(
    "GLOBAL",
    "select",
    [
      ...(hasNodes
        ? [
            "main",
            "All",
            "AI",
            "Google",
            "YouTube",
            "Telegram",
            "Steam",
            "Apple",
            "Microsoft",
          ]
        : []),
      ...regionEntries,
      ...(hasOther ? ["Other"] : []),
      ...(infoNames.length ? ["info"] : []),
      "DIRECT",
    ],
    "Global.png",
  );

  return groups;
};
