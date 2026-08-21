import { uniq } from "./utils";
import {
  BLOCK_GOOGLE_QUIC,
  BYPASS_DOMAINS,
  FORCE_PROXY_DOMAINS,
} from "./user-config";

// ============================================================
// 5. RuleBuilder —— 分流规则（顺序敏感：越具体越靠前）
// ============================================================

/**
 * Google 系 QUIC 阻断规则（UDP 443 → REJECT，迫使客户端回落 TCP）。
 * 必须排在所有 Google/AI/YouTube 规则之前才会命中（rules 先匹配先停止）。
 * 用 OR + DOMAIN-SUFFIX 显式列举而非 `RULE-SET,google`：逻辑规则内嵌
 * RULE-SET 在部分内核版本上行为不一致，显式后缀无歧义且覆盖了实际跑
 * QUIC 的全部域名族。REJECT 而非 REJECT-DROP —— 静默丢弃会让客户端继续
 * 等超时，正好是我们要消除的那几秒卡顿。
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
 * 分流出口目标。完整版与极简版共用同一套规则骨架，
 * 仅出口策略组名不同：完整版按服务独立分组（Google/AI/Steam…），
 * 极简版收敛到「全部 / AI / 广告拦截」三组。
 */
export interface RuleTargets {
  /** 广告拦截出口（完整版固定 REJECT，极简版为「广告拦截」组可切换） */
  adblock: string;
  ai: string;
  google: string;
  youtube: string;
  telegram: string;
  steam: string;
  apple: string;
  microsoft: string;
  /** 主代理出口：Spotify / GFW 兜底 / FORCE_PROXY_DOMAINS / MATCH 均走这里 */
  proxy: string;
}

/**
 * 构建静态规则。分流目标由 targets 注入。
 * 设计要点：
 *  - Google FCM 走代理，不再 DIRECT（Plan 4）。
 *  - Google / YouTube / AI / Telegram / Steam / Apple / Microsoft 各自独立分流。
 *  - 国区子集(*-cn)直连，全球集走对应代理组。
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

  // 基础设施：Cloudflare Analytics 直连（防广告规则误杀）/ 内网 直连
  "RULE-SET,cloudflare,DIRECT",
  "RULE-SET,private,DIRECT",
  "RULE-SET,private-ip,DIRECT,no-resolve",

  // Google 系 QUIC 阻断（见文件顶部 googleQuicRule 注释）。位置必须在
  // AI / Google / YouTube 之前，否则那些规则会先把 UDP 443 送进代理组。
  ...googleQuicRule(),

  // AI（独立于 gfw，优先匹配以免被 google/gfw 抢占）
  `RULE-SET,openai,${t.ai}`,
  `RULE-SET,anthropic,${t.ai}`,
  `RULE-SET,perplexity,${t.ai}`,
  `RULE-SET,cursor,${t.ai}`,
  `RULE-SET,notion,${t.ai}`,
  `RULE-SET,xai,${t.ai}`,
  `RULE-SET,category-ai,${t.ai}`,

  // Google 生态（顺序关键！rules 是有序数组，先匹配先停止）
  // google-cn 列表中混有 connectivitycheck.gstatic.com / fonts.googleapis.com /
  // fonts.gstatic.com / dl.google.com 等全球关键域名（历史上有国内 CDN，现已不可达）。
  // 若 google-cn,DIRECT 放在 google 之前，会把上述域名强制直连 → YouTube 报
  // "未联网"、Chrome 商店卡死、NotebookLM 白屏。
  // 实际效果：google 先匹配并消耗了所有全球域名，google-cn 仅能命中
  // 不在 google 集合中的纯国区域名（google.cn / 265.com / pki.goog 等）。
  //
  // 出口收敛：googleapis.com / gstatic.com 这两个共享域下的子域散落在
  // youtube（youtubei.googleapis.com）与 google 两个集合里，完整版会因此
  // 被分派到 YouTube / Google 两个可独立切换的策略组。后果不是某个域名
  // 不通，而是同一 Google 账号的请求从多个出口 IP 发出——OAuth 刷新、
  // Chrome sync、Drive 上传在 IP 间跳变，触发 Google 侧风控（插入验证、
  // 401、静默降速），表现即"时好时坏"。故在 youtube 之前把这两个共享域
  // 整体钉到 t.google，保证单一出口。
  // 注：AI 族规则排在更前面，generativelanguage.googleapis.com 等仍归
  // AI 组——那是刻意的地区分离设计（AI 组避开香港），不在此收敛范围内。
  `DOMAIN-SUFFIX,googleapis.com,${t.google}`,
  `DOMAIN-SUFFIX,gstatic.com,${t.google}`,
  `RULE-SET,googlefcm,${t.google}`, // FCM 走代理（关键修正）
  `RULE-SET,youtube,${t.youtube}`,
  `RULE-SET,google,${t.google}`,
  `RULE-SET,google-ip,${t.google},no-resolve`,
  "RULE-SET,google-cn,DIRECT",

  // Telegram
  `RULE-SET,telegram,${t.telegram}`,
  `RULE-SET,telegram-ip,${t.telegram},no-resolve`,

  // Steam（国区/下载 CDN 直连，商店/社区/登录走代理组）
  // 下载 CDN 必须在 steam 集合之前直连：steamcontent.com（内容分发）、
  // steamserver.net（自建 SteamPipe 节点）、steampipe.akamaized.net
  // （Akamai 分发）均在 geosite:steam 中，若不前置会被送进代理组，
  // 导致下载吃代理流量且速度受限。直连时国内运营商 CDN 可跑满带宽。
  "DOMAIN-SUFFIX,steamcontent.com,DIRECT",
  "DOMAIN-SUFFIX,steamserver.net,DIRECT",
  "DOMAIN-SUFFIX,steampipe.akamaized.net,DIRECT",
  "RULE-SET,steam-cn,DIRECT",
  `RULE-SET,steam,${t.steam}`,

  // Apple（国区 CDN 直连，iCloud/App Store 全球等走代理组）
  "RULE-SET,apple-cn,DIRECT",
  `RULE-SET,apple,${t.apple}`,

  // Microsoft（国区/Windows Update 直连，Copilot 等全球走代理组）
  "RULE-SET,microsoft-cn,DIRECT",
  `RULE-SET,microsoft,${t.microsoft}`,

  // Spotify 走代理
  `RULE-SET,spotify,${t.proxy}`,

  // 连通性检测 / NTP 直连（快速返回，避免走代理增加延迟）
  "RULE-SET,connectivity-check,DIRECT",
  "RULE-SET,category-ntp,DIRECT",

  // GFW 兜底走代理
  `RULE-SET,gfw,${t.proxy}`,

  // 国内直连
  "RULE-SET,cn,DIRECT",
  "RULE-SET,cn-ip,DIRECT,no-resolve",

  // 漏网之鱼走主代理
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
