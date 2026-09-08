import { SETTINGS } from "./settings";

/**
 * 规则集配置构建器
 * ------------------------------------------------------------------
 * 统一管理 GeoSite 与 GeoIP 规则集的下载与本地缓存路径。
 *
 * 命名解耦设计：
 * - key: 内部规范逻辑名，供 rule-providers、rules 与 nameserver-policy 引用
 * - file: 远端真实文件名（如 microsoft@cn、steam@cn），确保准确拉取不发生 404
 */

interface ProviderEntry {
  key: string;
  file: string;
}

/** GeoSite 域名规则集列表 */
const GEOSITE_PROVIDERS: ProviderEntry[] = [
  { key: "category-ads-all", file: "category-ads-all" },
  { key: "private", file: "private" },
  { key: "cn", file: "cn" },
  { key: "google", file: "google" },
  { key: "google-cn", file: "google-cn" },
  { key: "googlefcm", file: "googlefcm" },
  { key: "youtube", file: "youtube" },
  { key: "apple", file: "apple" },
  { key: "apple-cn", file: "apple-cn" },
  { key: "microsoft", file: "microsoft" },
  { key: "microsoft-cn", file: "microsoft@cn" },
  { key: "telegram", file: "telegram" },
  { key: "spotify", file: "spotify" },
  { key: "steam", file: "steam" },
  { key: "steam-cn", file: "steam@cn" },

  // AI 独立服务（优先于 GFW 匹配）
  { key: "category-ai", file: "category-ai-!cn" },
  { key: "openai", file: "openai" },
  { key: "anthropic", file: "anthropic" },
  { key: "perplexity", file: "perplexity" },
  { key: "cursor", file: "cursor" },
  { key: "notion", file: "notion" },
  { key: "xai", file: "xai" },

  // 兜底与系统服务
  { key: "gfw", file: "gfw" },
  { key: "connectivity-check", file: "connectivity-check" },
  { key: "category-ntp", file: "category-ntp" },
];

/** GeoIP 网段规则集列表 */
const GEOIP_PROVIDERS: ProviderEntry[] = [
  { key: "private-ip", file: "private" },
  { key: "cn-ip", file: "cn" },
  { key: "google-ip", file: "google" },
  { key: "telegram-ip", file: "telegram" },
];

/** 构建 rule-providers 配置对象 */
export const buildRuleProviders = (): Record<string, any> => {
  const providers: Record<string, any> = {};
  const base = SETTINGS.RULE_PROVIDER_URL_BASE;
  const common = {
    type: "http",
    format: "mrs",
    interval: SETTINGS.PROVIDER_INTERVAL,
  };

  GEOSITE_PROVIDERS.forEach(({ key, file }) => {
    providers[key] = {
      ...common,
      behavior: "domain",
      path: `${SETTINGS.RULE_PROVIDER_PATH}/${key}.mrs`,
      url: `${base}/geosite/${file}.mrs`,
    };
  });
  GEOIP_PROVIDERS.forEach(({ key, file }) => {
    providers[key] = {
      ...common,
      behavior: "ipcidr",
      path: `${SETTINGS.RULE_PROVIDER_PATH}/${key}.mrs`,
      url: `${base}/geoip/${file}.mrs`,
    };
  });

  // Cloudflare Web Analytics 脚本直连（防广告规则误杀）
  // challenges.cloudflare.com 保持跟随主站路由，防止 Turnstile 验证因 IP 不一致触发风控
  providers.cloudflare = {
    type: "inline",
    behavior: "classical",
    payload: ["DOMAIN-SUFFIX,cloudflareinsights.com"],
  };
  return providers;
};
