import { CUSTOM_FILTER } from "./user-config";
import { SETTINGS } from "./settings";
import { sortProxyNames, uniq } from "./utils";
import { buildRuleProviders } from "./rule-providers";
import {
  buildStaticRules,
  mergeRules,
  pickDirectRules,
  type RuleTargets,
} from "./rules";
import { makeProxyNamesUnique } from "./proxies";
import { applyDns } from "./dns";
import { applyRuntime, applySniffer, applyTun } from "./runtime";
import type { ClashConfig, Proxy, ProxyGroup } from "./types";

/**
 * 极简业务分流版主流程（Sparkle / Clash Verge Rev）
 * ------------------------------------------------------------------
 * 策略组收敛为三个核心组：
 * - 全部：汇总所有节点并内置自动测速（默认自动选优）
 * - AI：剔除香港出口的纯净节点池（内置独立测速）
 * - 广告拦截：REJECT / DIRECT / 全部 可切换
 */

/** 三个策略组的名称定义 */
const GROUPS = {
  ALL: "全部",
  AI: "AI",
  ADBLOCK: "广告拦截",
};

/** 香港节点识别正则（AI 服务需剔除香港出口） */
const HK_FILTER = /香港|HK|HKG|HONGKONG|HONG KONG|🇭🇰/i;

/** 极简版分流出口映射：除广告与 AI 外均收敛至「全部」 */
const SIMPLE_RULE_TARGETS: RuleTargets = {
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

const STATIC_RULES = buildStaticRules(SIMPLE_RULE_TARGETS);

// --- 节点处理（去重、过滤与 AI 纯净池构建） ---

/**
 * 构建节点池：
 * - allNames: 全部可用节点（剔除自定义过滤与广告信息节点）
 * - aiNames: AI 专用池（排除香港节点；全排除则回退至 allNames）
 */
const buildProxyPools = (
  proxies: Proxy[] = [],
): { allNames: string[]; aiNames: string[] } => {
  const usable = proxies.filter(
    (p) =>
      p &&
      p.name &&
      !CUSTOM_FILTER.test(p.name) &&
      !SETTINGS.INFO_FILTER.test(p.name),
  );
  const allNames = sortProxyNames(uniq(usable.map((p) => p.name)));
  const nonHk = allNames.filter((n) => !HK_FILTER.test(n));
  return { allNames, aiNames: nonHk.length ? nonHk : allNames };
};

// --- 策略组生成 ---

const buildSimpleProxyGroups = ({
  allNames,
  aiNames,
}: {
  allNames: string[];
  aiNames: string[];
}): ProxyGroup[] => {
  const icon = (f: string) => SETTINGS.ICON_BASE + f;
  const groups: ProxyGroup[] = [];

  // 全部：自动测速打头（默认选它即自动选优），后跟所有节点可手动切换。
  // default-selected 把「默认选中自动测速」写成显式语义，不再依赖
  // 内核 selectedProxy() 找不到选中项时返回 proxies[0] 的隐式行为。
  // 无节点时回退 DIRECT，保证规则引用的组始终存在（配置不报错）。
  if (allNames.length) {
    groups.push({
      name: "自动测速",
      type: "url-test",
      proxies: allNames,
      icon: icon("Auto.png"),
      ...SETTINGS.URL_TEST_EXTRA,
    });
    groups.push({
      name: GROUPS.ALL,
      type: "select",
      proxies: ["自动测速", ...allNames],
      "default-selected": "自动测速",
      icon: icon("Global.png"),
    });
  } else {
    groups.push({
      name: GROUPS.ALL,
      type: "select",
      proxies: ["DIRECT"],
      icon: icon("Global.png"),
    });
  }

  // AI：纯净节点池（已剔除香港），同样自动测速打头
  if (aiNames.length) {
    groups.push({
      name: "AI 自动测速",
      type: "url-test",
      proxies: aiNames,
      icon: icon("ChatGPT.png"),
      ...SETTINGS.URL_TEST_EXTRA,
    });
    groups.push({
      name: GROUPS.AI,
      type: "select",
      proxies: ["AI 自动测速", ...aiNames],
      "default-selected": "AI 自动测速",
      icon: icon("ChatGPT.png"),
    });
  } else {
    groups.push({
      name: GROUPS.AI,
      type: "select",
      proxies: [GROUPS.ALL],
      icon: icon("ChatGPT.png"),
    });
  }

  // 广告拦截：默认 REJECT；误杀时可切 DIRECT（直连放行）或 全部（代理放行）
  groups.push({
    name: GROUPS.ADBLOCK,
    type: "select",
    proxies: ["REJECT", "DIRECT", GROUPS.ALL],
    icon: icon("AdBlack.png"),
  });

  return groups;
};

// --- 主入口 ---

export function simpleMain(config: ClashConfig): ClashConfig {
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

  makeProxyNamesUnique(originalProxies);
  config["proxy-groups"] = buildSimpleProxyGroups(
    buildProxyPools(originalProxies),
  );
  if (originalProxies.length) config.proxies = originalProxies;

  applyRuntime(config);
  applySniffer(config);
  applyTun(config);
  applyDns(config);

  return config;
}
