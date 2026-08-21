import { SETTINGS } from "./settings";
import { uniq } from "./utils";
import type { ProxyGroup, RegionGroup } from "./types";

// ============================================================
// 7. ProxyBuilder —— 策略组生成
// ============================================================

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

  // 按既定顺序取出「有节点」的地区
  const regionEntries = SETTINGS.REGION_ORDER.filter((r) =>
    activeRegionNameSet.has(r),
  );
  const hasOther = otherProxyNames.length > 0;
  const hasNodes = allNames.length > 0;

  // ---- 主选择组 & 全量组 ----
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
    // default-selected：把「默认选中自动测速组」写成显式语义。
    // 此前依赖内核 selectedProxy() 找不到选中项时返回 proxies[0]，
    // 一旦成员顺序调整默认项就会跟着漂。
    add("All", "select", ["URL Test - All", ...allNames], "Auto.png", {
      "default-selected": "URL Test - All",
    });
  }

  // ---- 地区组（每地区一个 url-test + 一个 select） ----
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

  // ---- Other / info ----
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

  // ---- 服务策略组（依赖节点存在） ----
  if (hasNodes) {
    // 代理优先型成员：main → All → 各地区 → Other
    const proxyFirst = [
      "main",
      "All",
      ...regionEntries,
      ...(hasOther ? ["Other"] : []),
    ];
    // 需在本地/直连间可切换的服务：附加 DIRECT 选项
    const withDirect = [...proxyFirst, "DIRECT"];

    // AI：非香港优先 + 自动测速子组
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

    // Google / YouTube（YouTube 默认复用 Google 出口）
    // default-selected 显式锁定到 "Google"：YouTube 与 Google 大量共享
    // 域名与账号态（youtubei.googleapis.com、登录/推荐/历史同步），两组
    // 落到不同出口 IP 会触发 Google 侧的会话风控。想单独给 YouTube 换线
    // 路时仍可在 App 内手动切换，只是默认不再分裂。
    add("Google", "select", proxyFirst, "Google_Search.png");
    add("YouTube", "select", ["Google", ...proxyFirst], "YouTube.png", {
      "default-selected": "Google",
    });

    // Telegram（新加坡优先，附 fallback 自愈）
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

    // Steam / Apple / Microsoft：默认走代理，可选 DIRECT
    add("Steam", "select", withDirect, "Steam.png");
    add("Apple", "select", withDirect, "Apple.png");
    add("Microsoft", "select", withDirect, "Microsoft.png");
  } else {
    // 零节点回退：规则出口引用的业务组必须始终存在（对齐极简版
    // 「全部」组的处理），否则空订阅/拉取失败时内核 -t 直接报错
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

  // ---- GLOBAL 全局入口（汇总所有组） ----
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
