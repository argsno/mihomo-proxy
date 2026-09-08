import { CUSTOM_FILTER } from "./user-config";
import { SETTINGS } from "./settings";
import { uniq } from "./utils";
import { REGIONS } from "./regions";
import { buildRuleProviders } from "./rule-providers";
import {
  buildStaticRules,
  mergeRules,
  pickDirectRules,
  type RuleTargets,
} from "./rules";
import {
  buildAllAiProxyList,
  classifyProxiesByRegion,
  ensureConfigObject,
  filterCustomProxies,
  getOriginalProxies,
  makeProxyNamesUnique,
  splitInfoAndNormalProxies,
} from "./proxies";
import { buildProxyGroups } from "./proxy-groups";
import { applyDns } from "./dns";
import { applyRuntime, applySniffer, applyTun } from "./runtime";
import type { ClashConfig } from "./types";

/**
 * 桌面完整版主入口流程（Sparkle / Clash Verge Rev）
 * ------------------------------------------------------------------
 * 执行流程：
 * 1. 清理遗留 geodata 配置
 * 2. 构建并注入 rule-providers 与 rules 分流规则
 * 3. 节点重名消重、广告/营销节点过滤与地区正则分类
 * 4. 生成服务级独立策略组与地区测速组
 * 5. 应用网络优化（Runtime / Sniffer / TUN / 防泄露 DNS）
 */

/** 完整版分流出口：各服务独立指向对应专属策略组 */
const FULL_RULE_TARGETS: RuleTargets = {
  adblock: "REJECT",
  ai: "AI",
  google: "Google",
  youtube: "YouTube",
  telegram: "Telegram",
  steam: "Steam",
  apple: "Apple",
  microsoft: "Microsoft",
  proxy: "main",
};

const STATIC_RULES = buildStaticRules(FULL_RULE_TARGETS);

export function main(config: ClashConfig): ClashConfig {
  config = ensureConfigObject(config);
  const originalProxies = getOriginalProxies(config);
  const existingRules: string[] = Array.isArray(config.rules)
    ? config.rules
    : [];

  // 清理旧版 geodata 相关字段（改用 rule-providers）
  delete config["geodata-mode"];
  delete config["geo-auto-update"];
  delete config["geo-update-interval"];
  delete config["geox-url"];

  // 规则集与规则
  config["rule-providers"] = {
    ...(config["rule-providers"] || {}),
    ...buildRuleProviders(),
  };
  config.rules = mergeRules(STATIC_RULES, pickDirectRules(existingRules));

  // 节点分类与策略组
  if (originalProxies.length) {
    makeProxyNamesUnique(originalProxies);
    const filtered = filterCustomProxies(originalProxies, CUSTOM_FILTER);
    const { infoProxies, normalProxies } = splitInfoAndNormalProxies(
      filtered,
      SETTINGS.INFO_FILTER,
    );

    const allNames = uniq(normalProxies.map((p) => p.name));
    const infoNames = uniq(infoProxies.map((p) => p.name));

    const {
      activeRegions,
      activeRegionNameSet,
      activeRegionMap,
      otherProxyNames,
    } = classifyProxiesByRegion(normalProxies, REGIONS);
    const allAiNames = buildAllAiProxyList(
      activeRegions,
      otherProxyNames,
      allNames,
    );

    config["proxy-groups"] = buildProxyGroups({
      allNames,
      allAiNames,
      activeRegionMap,
      activeRegionNameSet,
      otherProxyNames,
      infoNames,
    });
    config.proxies = originalProxies;
  } else {
    // 无节点时仍产出基础结构（含 GLOBAL）
    config["proxy-groups"] = buildProxyGroups({
      allNames: [],
      allAiNames: [],
      activeRegionMap: new Map(),
      activeRegionNameSet: new Set(),
      otherProxyNames: [],
      infoNames: [],
    });
  }

  // 网络与运行时
  applyRuntime(config);
  applySniffer(config);
  applyTun(config);
  applyDns(config);

  return config;
}
