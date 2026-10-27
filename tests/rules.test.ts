import { describe, expect, it } from "vitest";
import {
  buildStaticRules,
  mergeRules,
  pickDirectRules,
  type RuleTargets,
} from "../src/rules";

const FULL: RuleTargets = {
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

const SIMPLE: RuleTargets = {
  adblock: "广告拦截",
  ai: "AI",
  google: "全部",
  youtube: "全部",
  telegram: "全部",
  steam: "全部",
  apple: "全部",
  microsoft: "全部",
  proxy: "全部",
};

describe("buildStaticRules", () => {
  const full = buildStaticRules(FULL);
  const simple = buildStaticRules(SIMPLE);

  it("出口按 targets 注入", () => {
    expect(full).toContain("RULE-SET,youtube,YouTube");
    expect(simple).toContain("RULE-SET,youtube,全部");
    expect(full[0]).toBe("RULE-SET,category-ads-all,REJECT");
    expect(simple[0]).toBe("RULE-SET,category-ads-all,广告拦截");
  });

  it("MATCH 兜底在末位且指向主代理组", () => {
    expect(full[full.length - 1]).toBe("MATCH,main");
    expect(simple[simple.length - 1]).toBe("MATCH,全部");
  });

  it("双版本规则骨架完全一致（防再次漂移）", () => {
    const skeleton = (rules: string[]) =>
      rules.map((r) => {
        const parts = r.split(",");
        return parts[0] === "MATCH" ? "MATCH" : `${parts[0]},${parts[1]}`;
      });
    expect(skeleton(full)).toEqual(skeleton(simple));
  });

  it("Steam 下载 CDN 直连位于 steam 规则集之前", () => {
    const direct = full.indexOf("DOMAIN-SUFFIX,steamcontent.com,DIRECT");
    const steam = full.indexOf("RULE-SET,steam,Steam");
    expect(direct).toBeGreaterThan(-1);
    expect(direct).toBeLessThan(steam);
  });

  it("google 代理规则先于 google-cn 直连（防 YouTube 未联网）", () => {
    expect(full.indexOf("RULE-SET,google,Google")).toBeLessThan(
      full.indexOf("RULE-SET,google-cn,DIRECT"),
    );
  });
});

describe("OpenCode 直连预设（OPENCODE_BYPASS）", () => {
  const full = buildStaticRules(FULL);
  const simple = buildStaticRules(SIMPLE);

  it("进程 + 自家域名直连规则存在", () => {
    expect(full).toContain("PROCESS-NAME,opencode,DIRECT");
    expect(full).toContain("PROCESS-NAME,opencode.exe,DIRECT");
    expect(full).toContain("DOMAIN-SUFFIX,opencode.ai,DIRECT");
    expect(full).toContain("DOMAIN-SUFFIX,models.dev,DIRECT");
  });

  it("位于 AI 规则集之前（防被 category-ai/anthropic 抢先分流）", () => {
    const firstAiRule = full.findIndex((r) =>
      /^RULE-SET,(openai|anthropic|category-ai),/.test(r),
    );
    for (const rule of [
      "PROCESS-NAME,opencode,DIRECT",
      "DOMAIN-SUFFIX,opencode.ai,DIRECT",
    ]) {
      const idx = full.indexOf(rule);
      expect(idx).toBeGreaterThan(-1);
      expect(idx).toBeLessThan(firstAiRule);
    }
  });

  it("极简版同样注入（共享骨架）", () => {
    expect(simple).toContain("PROCESS-NAME,opencode,DIRECT");
    expect(simple).toContain("DOMAIN-SUFFIX,models.dev,DIRECT");
  });
});

describe("Qoder 走代理预设（QODER_PROXY）", () => {
  const full = buildStaticRules(FULL);
  const simple = buildStaticRules(SIMPLE);

  it("主进程与 Helper 进程均走代理", () => {
    for (const proc of [
      "Qoder",
      "Qoder Helper",
      "Qoder Helper (Renderer)",
      "Qoder Helper (Plugin)",
      "Qoder.exe",
    ]) {
      expect(full).toContain(`PROCESS-NAME,${proc},main`);
      expect(simple).toContain(`PROCESS-NAME,${proc},全部`);
    }
  });

  it("国际版自家域名走代理", () => {
    expect(full).toContain("DOMAIN-SUFFIX,qoder.sh,main");
    expect(simple).toContain("DOMAIN-SUFFIX,qoder.sh,全部");
  });

  it("位于 AI 与国内直连规则之前（防被抢先分流）", () => {
    const firstAiRule = full.findIndex((r) =>
      /^RULE-SET,(openai|anthropic|category-ai),/.test(r),
    );
    const cnRule = full.indexOf("RULE-SET,cn,DIRECT");
    for (const rule of [
      "PROCESS-NAME,Qoder,main",
      "PROCESS-NAME,Qoder Helper,main",
      "DOMAIN-SUFFIX,qoder.sh,main",
    ]) {
      const idx = full.indexOf(rule);
      expect(idx).toBeGreaterThan(-1);
      expect(idx).toBeLessThan(firstAiRule);
      expect(idx).toBeLessThan(cnRule);
    }
  });

  it("不误伤国内版 Qoder CN（进程名与共享域名）", () => {
    expect(full.some((rule) => rule.includes("Qoder CN"))).toBe(false);
    // 国内版 gateway/openapi 在 qoder.com 下，域名规则不能收录
    expect(full.some((rule) => rule.includes("qoder.com"))).toBe(false);
  });
});

describe("pickDirectRules", () => {
  it("仅保留 DIRECT 规则，跳过注释与空行", () => {
    expect(
      pickDirectRules([
        "DOMAIN,a.com,DIRECT",
        "DOMAIN,b.com,Proxy",
        "# DOMAIN,c.com,DIRECT",
        "",
        "IP-CIDR,10.0.0.0/8,DIRECT,no-resolve",
      ]),
    ).toEqual(["DOMAIN,a.com,DIRECT", "IP-CIDR,10.0.0.0/8,DIRECT,no-resolve"]);
  });
  it("不误保留 DIRECTOR 之类前缀", () => {
    expect(pickDirectRules(["DOMAIN,x.com,DIRECTOR"])).toEqual([]);
  });
});

describe("mergeRules", () => {
  const base = ["RULE-SET,a,X", "MATCH,main"];
  it("额外规则插入 MATCH 之前", () => {
    expect(mergeRules(base, ["DOMAIN,u.com,DIRECT"])).toEqual([
      "RULE-SET,a,X",
      "DOMAIN,u.com,DIRECT",
      "MATCH,main",
    ]);
  });
  it("无额外规则返回副本", () => {
    const out = mergeRules(base, []);
    expect(out).toEqual(base);
    expect(out).not.toBe(base);
  });
  it("无 MATCH 时追加并去重", () => {
    expect(
      mergeRules(["RULE-SET,a,X"], ["RULE-SET,a,X", "D,u,DIRECT"]),
    ).toEqual(["RULE-SET,a,X", "D,u,DIRECT"]);
  });
});
