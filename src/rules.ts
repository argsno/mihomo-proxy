import { uniq } from "./utils";
import {
  BLOCK_GOOGLE_QUIC,
  BYPASS_DOMAINS,
  FORCE_PROXY_DOMAINS,
} from "./user-config";

/**
 * 分流规则构建器
 * ------------------------------------------------------------------
 * 规则遵循严格的有序匹配机制（先匹配即生效，越具体的规则越靠前）。
 * 多个版本共享同一份规则骨架，仅通过 RuleTargets 参数化注入不同出口策略组。
 */

/**
 * Google 系 QUIC 阻断规则（UDP 443 → REJECT，迫使客户端立即回落 TCP）。
 * 必须置于所有 Google/AI/YouTube 规则之前；使用 REJECT 而非 REJECT-DROP，
 * 避免浏览器因静默丢包超时等待数秒。
 */
const GOOGLE_QUIC_DOMAINS = [
  "googleapis.com",
  "gstatic.com",
  "google.com",
  "googlevideo.com",
  "youtube.com",
  "ytimg.com",
  "ggpht.com",
];

const googleQuicRule = (): string[] =>
  BLOCK_GOOGLE_QUIC
    ? [
        `AND,((NETWORK,udp),(DST-PORT,443),(OR,(${GOOGLE_QUIC_DOMAINS.map(
          (d) => `(DOMAIN-SUFFIX,${d})`,
        ).join(",")}))),REJECT`,
      ]
    : [];

/**
 * 分流出口目标映射接口。
 * 完整版/Bettbox 版独立服务分组，极简版收敛至「全部/AI/广告拦截」三组。
 */
export interface RuleTargets {
  /** 广告拦截出口（REJECT 或「广告拦截」组） */
  adblock: string;
  ai: string;
  google: string;
  youtube: string;
  telegram: string;
  steam: string;
  apple: string;
  microsoft: string;
  /** 主代理出口（兜底与未指定独立组的国外服务） */
  proxy: string;
}

/**
 * 构建静态分流规则列表。
 * - 顺序敏感：广告拦截 → 自定义 → 游戏直连 → 基础设施 → QUIC阻断 → AI → Google → 业务服务 → GFW → 国内直连 → MATCH
 */
export const buildStaticRules = (t: RuleTargets): string[] => [
  // 广告拦截
  `RULE-SET,category-ads-all,${t.adblock}`,

  // 用户自定义
  ...uniq(BYPASS_DOMAINS).map((d) => `DOMAIN-SUFFIX,${d},DIRECT`),
  ...uniq(FORCE_PROXY_DOMAINS).map((d) => `DOMAIN,${d},${t.proxy}`),

  // 腾讯游戏 / WeGame 直连（防止 TUN 模式干扰游戏登录与联机）
  "DOMAIN-SUFFIX,wegame.com.cn,DIRECT",
  "DOMAIN-KEYWORD,wegame,DIRECT",
  "DOMAIN-SUFFIX,igame.qq.com,DIRECT",
  "DOMAIN-SUFFIX,tgp.qq.com,DIRECT",

  // 基础设施直连
  "RULE-SET,cloudflare,DIRECT",
  "RULE-SET,private,DIRECT",
  "RULE-SET,private-ip,DIRECT,no-resolve",

  // Google QUIC 阻断（必须排在 Google/AI 规则之前）
  ...googleQuicRule(),

  // AI 独立服务（避免被后续规则误匹配）
  `RULE-SET,openai,${t.ai}`,
  `RULE-SET,anthropic,${t.ai}`,
  `RULE-SET,perplexity,${t.ai}`,
  `RULE-SET,cursor,${t.ai}`,
  `RULE-SET,notion,${t.ai}`,
  `RULE-SET,xai,${t.ai}`,
  `RULE-SET,category-ai,${t.ai}`,

  // Google 服务（严格顺序：googleapis/gstatic 锁定出口，google 优先于 google-cn 匹配）
  `DOMAIN-SUFFIX,googleapis.com,${t.google}`,
  `DOMAIN-SUFFIX,gstatic.com,${t.google}`,
  `RULE-SET,googlefcm,${t.google}`,
  `RULE-SET,youtube,${t.youtube}`,
  `RULE-SET,google,${t.google}`,
  `RULE-SET,google-ip,${t.google},no-resolve`,
  "RULE-SET,google-cn,DIRECT",

  // Telegram 通讯服务
  `RULE-SET,telegram,${t.telegram}`,
  `RULE-SET,telegram-ip,${t.telegram},no-resolve`,

  // Steam（下载 CDN 强制直连以跑满本地带宽，商店/社区走代理）
  "DOMAIN-SUFFIX,steamcontent.com,DIRECT",
  "DOMAIN-SUFFIX,steamserver.net,DIRECT",
  "DOMAIN-SUFFIX,steampipe.akamaized.net,DIRECT",
  "RULE-SET,steam-cn,DIRECT",
  `RULE-SET,steam,${t.steam}`,

  // Apple & Microsoft（国区 CDN / 更新直连，全球走代理）
  "RULE-SET,apple-cn,DIRECT",
  `RULE-SET,apple,${t.apple}`,
  "RULE-SET,microsoft-cn,DIRECT",
  `RULE-SET,microsoft,${t.microsoft}`,

  // 流媒体服务
  `RULE-SET,spotify,${t.proxy}`,

  // 网络连通性检测与时间同步直连
  "RULE-SET,connectivity-check,DIRECT",
  "RULE-SET,category-ntp,DIRECT",

  // 境外与境内兜底
  `RULE-SET,gfw,${t.proxy}`,
  "RULE-SET,cn,DIRECT",
  "RULE-SET,cn-ip,DIRECT,no-resolve",
  `MATCH,${t.proxy}`,
];

/**
 * 合并用户既有规则中的 DIRECT 规则到 MATCH 之前，保持向后兼容。
 */
export const mergeRules = (
  baseRules: string[] = [],
  extraRules: string[] = [],
): string[] => {
  const extra = Array.isArray(extraRules) ? extraRules.filter(Boolean) : [];
  if (!extra.length) return baseRules.slice();
  const matchIndex = baseRules.findIndex((rule) =>
    String(rule).trim().toUpperCase().startsWith("MATCH,"),
  );
  if (matchIndex === -1) return uniq([...baseRules, ...extra]);
  return uniq([
    ...baseRules.slice(0, matchIndex),
    ...extra,
    ...baseRules.slice(matchIndex),
  ]);
};

/** 从用户既有规则中挑出 DIRECT 规则（供合并保留自定义直连） */
export const pickDirectRules = (rules: string[] = []): string[] =>
  rules.filter((rule) => {
    const r = String(rule || "").trim();
    if (!r || r.startsWith("#")) return false;
    return /,DIRECT(?:,|$)/i.test(r);
  });
