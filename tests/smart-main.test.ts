import { describe, expect, it } from "vitest";
import { buildSmartProxyGroups } from "../src/smart-main";

/** exclude-filter 是 regexp2 风格的 (?i) 前缀正则，转成 JS 正则做行为断言 */
const toJsRegex = (src: string) => {
  const m = /^\(\?i\)([\s\S]*)$/.exec(String(src));
  return m ? new RegExp(m[1], "i") : new RegExp(String(src));
};

describe("buildSmartProxyGroups", () => {
  it("两个隐藏自动组使用 smart 类型且不写 interval/tolerance", () => {
    const groups = buildSmartProxyGroups(true);
    expect(groups.map((g) => g.name)).toEqual([
      "智能选路",
      "全部",
      "AI 智能选路",
      "AI",
      "广告拦截",
    ]);
    for (const name of ["智能选路", "AI 智能选路"]) {
      const g = groups.find((x) => x.name === name);
      expect(g?.type).toBe("smart");
      expect(g?.hidden).toBe(true);
      expect(g?.["include-all"]).toBe(true);
      expect(g?.["empty-fallback"]).toBe("DIRECT");
      expect(g?.["expected-status"]).toBe(204);
      expect(g?.lazy).toBe(true);
      // 内核固定每 5 分钟重测：不写 interval/tolerance
      expect(g?.interval).toBeUndefined();
      expect(g?.tolerance).toBeUndefined();
    }
  });

  it("select 组以智能选路组打头并默认选中", () => {
    const groups = buildSmartProxyGroups(true);
    const all = groups.find((g) => g.name === "全部");
    const ai = groups.find((g) => g.name === "AI");
    expect(all?.proxies).toEqual(["智能选路"]);
    expect(all?.["default-selected"]).toBe("智能选路");
    expect(ai?.proxies).toEqual(["AI 智能选路"]);
    expect(ai?.["default-selected"]).toBe("AI 智能选路");
  });

  it("policy-priority 非空时写入两个自动组，为空时不下发", () => {
    const withPriority = buildSmartProxyGroups(true, "Premium:0.9;备用:1.3");
    for (const name of ["智能选路", "AI 智能选路"]) {
      const g = withPriority.find((x) => x.name === name);
      expect(g?.["policy-priority"]).toBe("Premium:0.9;备用:1.3");
    }
    const blank = buildSmartProxyGroups(true, "   ");
    for (const name of ["智能选路", "AI 智能选路"]) {
      expect(
        blank.find((x) => x.name === name)?.["policy-priority"],
      ).toBeUndefined();
    }
  });

  it("exclude-filter 排除信息节点与香港，且不误伤自身组名", () => {
    const groups = buildSmartProxyGroups(true);
    const allRe = toJsRegex(
      groups.find((g) => g.name === "全部")?.["exclude-filter"],
    );
    const aiRe = toJsRegex(
      groups.find((g) => g.name === "AI")?.["exclude-filter"],
    );
    expect(allRe.test("剩余流量：100GB")).toBe(true);
    expect(allRe.test("🇯🇵 日本 02 0.5x")).toBe(false);
    expect(allRe.test("")).toBe(false);
    expect(allRe.test("智能选路")).toBe(false);
    expect(aiRe.test("AI 智能选路")).toBe(false);
    expect(allRe.test("🇭🇰 香港 IEPL 01")).toBe(false);
    expect(aiRe.test("🇭🇰 香港 IEPL 01")).toBe(true);
    expect(aiRe.test("🇸🇬 新加坡 BGP")).toBe(false);
  });

  it("零节点回退 DIRECT 并保持三组结构", () => {
    const groups = buildSmartProxyGroups(false);
    expect(groups.map((g) => g.name)).toEqual(["全部", "AI", "广告拦截"]);
    expect(groups[0].proxies).toEqual(["DIRECT"]);
    expect(groups[0].type).toBe("select");
    expect(groups.every((g) => g.type !== "smart")).toBe(true);
  });
});
