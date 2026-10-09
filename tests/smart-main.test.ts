import { describe, expect, it } from "vitest";
import {
  buildSmartProxyGroups,
  DEFAULT_RULE_OPTIONS,
  type SmartRuleOptions,
} from "../src/smart-main";

/** exclude-filter 是 regexp2 风格的 (?i) 前缀正则，转成 JS 正则做行为断言 */
const toJsRegex = (src: string) => {
  const m = /^\(\?i\)([\s\S]*)$/.exec(String(src));
  return m ? new RegExp(m[1], "i") : new RegExp(String(src));
};

const SMART_GROUP_NAMES = [
  "智能选路 - All",
  "All",
  "智能选路 - HK",
  "HK",
  "智能选路 - TW",
  "TW",
  "智能选路 - JP",
  "JP",
  "智能选路 - SG",
  "SG",
  "智能选路 - KR",
  "KR",
  "智能选路 - US",
  "US",
  "智能选路 - EU",
  "EU",
  "智能选路 - AU",
  "AU",
  "智能选路 - AS",
  "AS",
  "智能选路 - Other",
  "Other",
  "main",
  "智能选路 - AI",
  "AI",
  "Google",
  "YouTube",
  "Telegram - Fallback",
  "Telegram",
  "Steam",
  "Apple",
  "Microsoft",
  "Spotify",
  "广告拦截",
  "GLOBAL",
];

const withOptions = (
  overrides: Partial<SmartRuleOptions>,
): SmartRuleOptions => ({
  ...DEFAULT_RULE_OPTIONS,
  ...overrides,
});

describe("buildSmartProxyGroups", () => {
  it("完整布局：与 bettbox-flclash 相同的组名与顺序", () => {
    const groups = buildSmartProxyGroups(true);
    expect(groups.map((g) => g.name)).toEqual(SMART_GROUP_NAMES);
  });

  it("所有隐藏自动组均为 smart 类型且不写 interval/tolerance", () => {
    const groups = buildSmartProxyGroups(true);
    const autos = groups.filter((g) => g.name.startsWith("智能选路 - "));
    expect(autos.map((g) => g.name)).toEqual([
      "智能选路 - All",
      "智能选路 - HK",
      "智能选路 - TW",
      "智能选路 - JP",
      "智能选路 - SG",
      "智能选路 - KR",
      "智能选路 - US",
      "智能选路 - EU",
      "智能选路 - AU",
      "智能选路 - AS",
      "智能选路 - Other",
      "智能选路 - AI",
    ]);
    for (const g of autos) {
      expect(g.type).toBe("smart");
      expect(g.hidden).toBe(true);
      expect(g["include-all"]).toBe(true);
      expect(g.proxies).toEqual([]);
      expect(g["empty-fallback"]).toBe("DIRECT");
      expect(g["expected-status"]).toBe(204);
      expect(g.lazy).toBe(true);
      // 内核固定每 5 分钟重测：不写 interval/tolerance
      expect(g.interval).toBeUndefined();
      expect(g.tolerance).toBeUndefined();
    }
    // url-test 只剩 Telegram 的 fallback 自愈机制，其余自动组全部为 smart
    expect(groups.filter((g) => g.type === "url-test")).toEqual([]);
    expect(groups.filter((g) => g.type === "smart")).toHaveLength(12);
  });

  it("select 组以对应智能选路组打头并默认选中", () => {
    const groups = buildSmartProxyGroups(true);
    const byName = new Map(groups.map((g) => [g.name, g]));
    for (const name of [
      "All",
      "HK",
      "TW",
      "JP",
      "SG",
      "KR",
      "US",
      "EU",
      "AU",
      "AS",
      "Other",
    ]) {
      const g = byName.get(name);
      expect(g?.proxies).toEqual([`智能选路 - ${name}`]);
      expect(g?.["default-selected"]).toBe(`智能选路 - ${name}`);
    }
    // AI 服务组：智能选路打头，其后是可手选的纯净地区与 main
    const ai = byName.get("AI");
    expect(ai?.proxies[0]).toBe("智能选路 - AI");
    expect(ai?.proxies).not.toContain("HK");
    expect(ai?.["default-selected"]).toBe("智能选路 - AI");
    expect(byName.get("main")?.["default-selected"]).toBe("All");
    expect(byName.get("YouTube")?.["default-selected"]).toBe("Google");
    expect(byName.get("Telegram")?.["default-selected"]).toBe(
      "Telegram - Fallback",
    );
    expect(byName.get("Telegram - Fallback")?.type).toBe("fallback");
  });

  it("地区组 filter 只放行本地区节点", () => {
    const groups = buildSmartProxyGroups(true);
    const byName = new Map(groups.map((g) => [g.name, g]));
    const hkRe = toJsRegex(byName.get("HK")?.filter);
    const jpRe = toJsRegex(byName.get("JP")?.filter);
    expect(hkRe.test("🇭🇰 香港 IEPL 01")).toBe(true);
    expect(hkRe.test("🇯🇵 日本 02 0.5x")).toBe(false);
    expect(jpRe.test("🇯🇵 日本 02 0.5x")).toBe(true);
    expect(jpRe.test("🇭🇰 香港 IEPL 01")).toBe(false);
    // include-all 组同时携带信息节点黑名单
    expect(byName.get("HK")?.["exclude-filter"]).toMatch(/^\(\?i\)\(\?:/);
    expect(hkRe.test("剩余流量：100GB")).toBe(false);
  });

  it("exclude-filter 排除信息节点与香港，且不误伤自身组名", () => {
    const groups = buildSmartProxyGroups(true);
    const byName = new Map(groups.map((g) => [g.name, g]));
    const allExclude = toJsRegex(
      byName.get("智能选路 - All")?.["exclude-filter"],
    );
    const aiExclude = toJsRegex(
      byName.get("智能选路 - AI")?.["exclude-filter"],
    );
    expect(allExclude.test("剩余流量：100GB")).toBe(true);
    expect(allExclude.test("🇯🇵 日本 02 0.5x")).toBe(false);
    expect(allExclude.test("")).toBe(false);
    expect(allExclude.test("智能选路 - All")).toBe(false);
    expect(aiExclude.test("智能选路 - AI")).toBe(false);
    expect(allExclude.test("🇭🇰 香港 IEPL 01")).toBe(false);
    expect(aiExclude.test("🇭🇰 香港 IEPL 01")).toBe(true);
    expect(aiExclude.test("🇸🇬 新加坡 BGP")).toBe(false);
  });

  it("Other 组排除所有已知地区节点，仅兜底未归类节点", () => {
    const groups = buildSmartProxyGroups(true);
    const byName = new Map(groups.map((g) => [g.name, g]));
    const otherExclude = toJsRegex(byName.get("Other")?.["exclude-filter"]);
    expect(otherExclude.test("🇯🇵 日本 02 0.5x")).toBe(true);
    expect(otherExclude.test("🇭🇰 香港 IEPL 01")).toBe(true);
    expect(otherExclude.test("剩余流量：100GB")).toBe(true);
    expect(otherExclude.test("Fallback 备用节点")).toBe(false);
    // 关键回归：组名里的 "th"（Other）不能被当成泰国短码 TH 过滤掉，
    // 否则 Other 组连自己的智能选路组都不剩，整组退化成空成员兜底
    expect(otherExclude.test("智能选路 - Other")).toBe(false);
    expect(otherExclude.test("URL Test - Other")).toBe(false);
  });

  it("地区短码只匹配独立出现的代码，不命中词内子串", () => {
    const groups = buildSmartProxyGroups(true);
    const byName = new Map(groups.map((g) => [g.name, g]));
    const filterOf = (name: string) => toJsRegex(byName.get(name)?.filter);
    const usRe = filterOf("US");
    const asRe = filterOf("AS");
    const euRe = filterOf("EU");
    // 独立出现的代码照常命中（数字/分隔符/non-ASCII 相邻都算边界）
    expect(usRe.test("US-01")).toBe(true);
    expect(usRe.test("01 US")).toBe(true);
    expect(asRe.test("TH-01")).toBe(true);
    expect(euRe.test("IT-01")).toBe(true);
    // 词内子串不再误伤：Plus(us) / Other(th) / Digital(it) / Singapore(in)
    expect(usRe.test("Plus 中转")).toBe(false);
    expect(asRe.test("智能选路 - Other")).toBe(false);
    expect(euRe.test("Digital")).toBe(false);
    expect(asRe.test("Singapore 01")).toBe(false);
    expect(filterOf("SG").test("Singapore 01")).toBe(true);
  });

  it("显式列出的策略组员不会被父组的 exclude-filter 误伤", () => {
    const groups = buildSmartProxyGroups(true);
    const groupNames = new Set(groups.map((g) => g.name));
    const bad: string[] = [];
    for (const g of groups) {
      const exclude = g["exclude-filter"];
      if (typeof exclude !== "string" || !exclude) continue;
      const re = toJsRegex(exclude);
      for (const member of g.proxies ?? []) {
        if (groupNames.has(member) && re.test(member)) {
          bad.push(`${g.name}→${member}`);
        }
      }
    }
    expect(bad).toEqual([]);
  });

  it("policy-priority 非空时写入全部智能选路组，为空时不下发", () => {
    const withPriority = buildSmartProxyGroups(
      true,
      DEFAULT_RULE_OPTIONS,
      "Premium:0.9;备用:1.3",
    );
    for (const g of withPriority.filter((x) =>
      x.name.startsWith("智能选路 - "),
    )) {
      expect(g["policy-priority"]).toBe("Premium:0.9;备用:1.3");
    }
    // 非 smart 组不下发该字段
    expect(
      withPriority.find((x) => x.name === "All")?.["policy-priority"],
    ).toBeUndefined();
    const blank = buildSmartProxyGroups(true, DEFAULT_RULE_OPTIONS, "   ");
    for (const g of blank.filter((x) => x.name.startsWith("智能选路 - "))) {
      expect(g["policy-priority"]).toBeUndefined();
    }
  });

  it("Bettbox 开关：关闭服务组/地区分组后对应组不生成", () => {
    const custom = buildSmartProxyGroups(
      true,
      withOptions({ Google: false, YouTube: false, 地区分组: false }),
    );
    const names = custom.map((g) => g.name);
    expect(names).not.toContain("Google");
    expect(names).not.toContain("YouTube");
    expect(names).not.toContain("HK");
    expect(names).not.toContain("Other");
    expect(names).toContain("智能选路 - All");
    expect(names).not.toContain("智能选路 - HK");
    // main / GLOBAL 中的地区与非地区项同步移除
    expect(custom.find((g) => g.name === "main")?.proxies).toEqual(["All"]);
    expect(custom.find((g) => g.name === "GLOBAL")?.proxies).not.toContain(
      "HK",
    );
  });

  it("零节点回退 DIRECT 且不生成 smart 组", () => {
    const groups = buildSmartProxyGroups(false);
    const names = groups.map((g) => g.name);
    expect(names).toContain("main");
    expect(names).toContain("All");
    expect(names).toContain("广告拦截");
    expect(groups.every((g) => g.type !== "smart")).toBe(true);
    expect(groups.find((g) => g.name === "All")?.proxies).toEqual(["DIRECT"]);
    expect(groups.find((g) => g.name === "main")?.proxies).toEqual(["DIRECT"]);
  });
});
