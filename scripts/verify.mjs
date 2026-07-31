/**
 * 产物冒烟验证（三级校验的第 1 级）：
 * 用 node:vm 模拟宿主的调用方式 —— 桌面（boa_engine）`{script}; main(config, name)`，
 * 手机（FlClash / QuickJS）`{script}; main(config)`——
 * 在无 module/require 的裸沙箱中执行 dist 产物并断言关键结构。
 * 通过后：
 *   1. 导出 dist/test-*.yaml 供第 2 级真实内核校验
 *      （scripts/verify-kernel.mjs 或 CI）
 *   2. 将产物同步到仓库根目录（发布位置）
 */
import { readFileSync, writeFileSync, copyFileSync } from "node:fs";
import vm from "node:vm";
import yaml from "js-yaml";

let failed = false;
const assert = (cond, msg) => {
  if (!cond) {
    console.error(`✗ ${msg}`);
    failed = true;
  } else {
    console.log(`✓ ${msg}`);
  }
};

const CN_DOH = [
  "https://dns.alidns.com/dns-query",
  "https://doh.pub/dns-query",
];
const GLOBAL_DOH = ["https://1.1.1.1/dns-query", "https://8.8.8.8/dns-query"];

/** 内核合法的样例节点（-t 校验要求 ss 节点字段完整） */
const sampleProxy = (name) => ({
  name,
  type: "ss",
  server: "203.0.113.1",
  port: 443,
  cipher: "aes-128-gcm",
  password: "verify-only",
  udp: true,
});

const sampleConfig = () => ({
  "mixed-port": 7890,
  proxies: [
    sampleProxy("🇭🇰 香港 IEPL 01"),
    sampleProxy("🇯🇵 日本 02 0.5x"),
    sampleProxy("🇺🇸 美国 GAME"),
    sampleProxy("🇸🇬 新加坡 BGP"),
    sampleProxy("剩余流量：100GB"),
    sampleProxy("🇭🇰 香港 IEPL 01"), // 故意重名
  ],
  rules: ["DOMAIN-SUFFIX,mycompany.com,DIRECT", "MATCH,Proxy"],
});

/**
 * FlClash 传入的配置：调用前必定把缺失的 proxy-providers 补成 {}
 * （lib/common/javascript.dart），脚本的节点来源判定必须容忍这一点。
 */
const flclashConfig = (extra = {}) => ({
  ...sampleConfig(),
  "proxy-providers": {},
  ...extra,
});

/** 在裸沙箱中按宿主的调用约定执行产物（argc=1 模拟 FlClash） */
const runScript = (file, cfg, argc = 2) => {
  const script = readFileSync(
    new URL(`../dist/${file}`, import.meta.url),
    "utf8",
  );
  const sandbox = vm.createContext({ console });
  const call =
    argc === 1
      ? `main(${JSON.stringify(cfg)})`
      : `main(${JSON.stringify(cfg)}, "verify")`;
  return new vm.Script(
    `${script};\nJSON.parse(JSON.stringify(${call}))`,
  ).runInContext(sandbox);
};

/** 每条规则的出口必须是存在的策略组 / DIRECT / REJECT / 节点名（零节点配置也必须满足） */
const assertRuleTargets = (tag, result) => {
  const groupNames = new Set((result["proxy-groups"] ?? []).map((g) => g.name));
  const names = (result.proxies ?? []).map((p) => p.name);
  const validTargets = new Set([
    ...groupNames,
    ...names,
    "DIRECT",
    "REJECT",
    "REJECT-DROP",
    "PASS",
  ]);
  const badTargets = (result.rules ?? [])
    .map((r) => {
      const parts = String(r).split(",");
      return parts[0] === "MATCH" ? parts[1] : parts[2];
    })
    .filter((t) => t && !validTargets.has(t));
  assert(
    badTargets.length === 0,
    `[${tag}] 规则出口均有对应策略组（异常：${badTargets.join(",") || "无"}）`,
  );
};

/** 两个版本共同的断言（DNS 防泄露铁律 / 规则一致性 / 节点处理） */
const assertCommon = (tag, result) => {
  assert(typeof result === "object" && !!result, `[${tag}] main 返回对象`);
  assert(
    result.dns?.["respect-rules"] === true,
    `[${tag}] DNS respect-rules=true`,
  );
  assert(
    JSON.stringify(result.dns?.nameserver) === JSON.stringify(GLOBAL_DOH),
    `[${tag}] 默认 nameserver 为国际 DoH（防 DNS 泄露铁律）`,
  );
  assert(
    JSON.stringify(result.dns?.["proxy-server-nameserver"]) ===
      JSON.stringify(CN_DOH),
    `[${tag}] proxy-server-nameserver 为国内 DoH`,
  );
  assert(
    result.dns?.["nameserver-policy"]?.[
      "rule-set:cn,apple-cn,google-cn,microsoft-cn,steam-cn"
    ] !== undefined,
    `[${tag}] nameserver-policy 国内白名单存在`,
  );
  assert(
    JSON.stringify(
      result.dns?.["nameserver-policy"]?.["+.steamcontent.com"],
    ) === JSON.stringify(CN_DOH),
    `[${tag}] Steam 下载 CDN 的 DNS 指向国内 DoH`,
  );

  const rules = result.rules ?? [];
  const steamDirectIdx = rules.indexOf("DOMAIN-SUFFIX,steamcontent.com,DIRECT");
  const steamRuleIdx = rules.findIndex((r) => /^RULE-SET,steam,/.test(r));
  assert(
    steamDirectIdx > -1 && steamRuleIdx > -1 && steamDirectIdx < steamRuleIdx,
    `[${tag}] Steam 下载 CDN 直连且位于 steam 规则集之前`,
  );
  assert(
    rules.includes("DOMAIN-SUFFIX,mycompany.com,DIRECT"),
    `[${tag}] 用户 DIRECT 规则被保留合并`,
  );
  assert(
    /^MATCH,/.test(rules[rules.length - 1] ?? ""),
    `[${tag}] MATCH 兜底在末位`,
  );

  // 每条 RULE-SET 引用的规则集都必须已定义
  const providerKeys = Object.keys(result["rule-providers"] ?? {});
  const missing = rules
    .map((r) => String(r).match(/^RULE-SET,([^,]+),/)?.[1])
    .filter((k) => k && !providerKeys.includes(k));
  assert(
    missing.length === 0,
    `[${tag}] 规则集引用一致（缺失：${missing.join(",") || "无"}）`,
  );

  // 重名节点去冲突
  const names = (result.proxies ?? []).map((p) => p.name);
  assert(new Set(names).size === names.length, `[${tag}] 节点重名已去冲突`);

  assertRuleTargets(tag, result);
};

/** 规则骨架（剥离出口目标后的 类型+匹配对象 序列），用于跨版本比对 */
const skeleton = (rules = []) =>
  rules.map((r) => {
    const parts = String(r).split(",");
    if (parts[0] === "MATCH") return "MATCH";
    return `${parts[0]},${parts[1]}`;
  });

/**
 * mihomo 的 filter / exclude-filter 由 dlclark/regexp2 编译（.NET 风格），
 * 支持 `(?i)` 内联选项。这里把它还原成 JS RegExp 以便断言其匹配行为。
 */
const toJsRegex = (src) => {
  const m = /^\(\?i\)([\s\S]*)$/.exec(String(src));
  return m ? new RegExp(m[1], "i") : new RegExp(String(src));
};

// ============ 完整版 ============
const full = runScript("mihomo-proxy.js", sampleConfig());
assertCommon("full", full);
{
  const groups = full["proxy-groups"] ?? [];
  const names = groups.map((g) => g.name);
  for (const g of [
    "main",
    "All",
    "AI",
    "Google",
    "YouTube",
    "Telegram",
    "Steam",
    "Apple",
    "Microsoft",
    "GLOBAL",
    "HK",
    "JP",
    "US",
    "SG",
    "info",
  ]) {
    assert(names.includes(g), `[full] 策略组存在：${g}`);
  }
  assert(
    full.rules[0] === "RULE-SET,category-ads-all,REJECT",
    "[full] 广告规则出口为 REJECT",
  );
  const aiGroup = groups.find((g) => g.name === "AI");
  assert(aiGroup && !aiGroup.proxies.includes("HK"), "[full] AI 组排除 HK");
  const emptyFull = runScript("mihomo-proxy.js", {});
  assert(
    (emptyFull["proxy-groups"] ?? []).some((g) => g.name === "GLOBAL"),
    "[full] 无节点时仍产出 GLOBAL",
  );
  assertRuleTargets("full-empty", emptyFull);
}

// ============ 极简版 ============
const simple = runScript("simple-mihomo.js", sampleConfig());
assertCommon("simple", simple);
{
  const groups = simple["proxy-groups"] ?? [];
  const names = groups.map((g) => g.name);
  assert(
    JSON.stringify(names) ===
      JSON.stringify(["自动测速", "全部", "AI 自动测速", "AI", "广告拦截"]),
    `[simple] 策略组恰为五个（含两个隐藏测速组）：${names.join(" / ")}`,
  );
  assert(
    simple.rules[0] === "RULE-SET,category-ads-all,广告拦截",
    "[simple] 广告规则出口为「广告拦截」组",
  );
  assert(
    simple.rules.includes("RULE-SET,google,全部"),
    "[simple] google 出口收敛到「全部」",
  );
  assert(
    simple.rules[simple.rules.length - 1] === "MATCH,全部",
    "[simple] MATCH 出口为「全部」",
  );
  const aiGroup = groups.find((g) => g.name === "AI");
  assert(
    aiGroup && !aiGroup.proxies.some((n) => /香港|🇭🇰/.test(n)),
    "[simple] AI 组剔除香港节点",
  );
  const adblock = groups.find((g) => g.name === "广告拦截");
  assert(
    adblock &&
      JSON.stringify(adblock.proxies) ===
        JSON.stringify(["REJECT", "DIRECT", "全部"]),
    "[simple] 广告拦截组选项为 REJECT/DIRECT/全部",
  );
  // 双版本规则骨架一致性：剥离出口后应完全相同
  assert(
    JSON.stringify(skeleton(full.rules)) ===
      JSON.stringify(skeleton(simple.rules)),
    "[两版一致] 规则骨架（类型+匹配对象序列）完全相同",
  );
  const emptySimple = runScript("simple-mihomo.js", {});
  const emptyAll = (emptySimple["proxy-groups"] ?? []).find(
    (g) => g.name === "全部",
  );
  assert(
    emptyAll && JSON.stringify(emptyAll.proxies) === JSON.stringify(["DIRECT"]),
    "[simple] 无节点时「全部」回退 DIRECT",
  );
  assertRuleTargets("simple-empty", emptySimple);
}

// ============ FlClash 手机版 ============
// 按 FlClash 的真实调用约定执行：单参数 main(config)，且 config 一定带
// proxy-providers（App 在调用前补成 {}）。
const flclash = runScript("flclash-mobile.js", flclashConfig(), 1);
assertCommon("flclash", flclash);
{
  const groups = flclash["proxy-groups"] ?? [];
  const names = groups.map((g) => g.name);
  const byName = new Map(groups.map((g) => [g.name, g]));
  assert(
    JSON.stringify(names) ===
      JSON.stringify(["自动测速", "全部", "AI 自动测速", "AI", "广告拦截"]),
    `[flclash] 策略组恰为五个（含两个隐藏测速组）：${names.join(" / ")}`,
  );

  // 出口目标与极简版完全一致 → 两版分流行为可直接互换验证
  assert(
    JSON.stringify(flclash.rules) === JSON.stringify(simple.rules),
    "[flclash] 分流规则与极简版逐条相同（含出口策略组名）",
  );

  // 节点纳入方式：include-all 由内核在运行时填充，脚本不枚举节点名
  for (const n of ["自动测速", "全部", "AI 自动测速", "AI"]) {
    assert(
      byName.get(n)?.["include-all"] === true,
      `[flclash] ${n} 组启用 include-all`,
    );
  }
  assert(
    JSON.stringify(byName.get("全部")?.proxies) ===
      JSON.stringify(["自动测速"]),
    "[flclash]「全部」组以自动测速打头（其余节点由内核追加）",
  );
  assert(
    JSON.stringify(byName.get("AI")?.proxies) ===
      JSON.stringify(["AI 自动测速"]),
    "[flclash]「AI」组以 AI 自动测速打头",
  );

  // exclude-filter 行为：必须排除信息类节点、放行正常节点，且绝不匹配空串
  // （空正则 source 是 "(?:)"，误拼进过滤器会命中每个节点名 → 组被清空）
  const allExclude = byName.get("全部")?.["exclude-filter"];
  const aiExclude = byName.get("AI")?.["exclude-filter"];
  assert(
    typeof allExclude === "string" && allExclude.startsWith("(?i)(?:"),
    `[flclash] exclude-filter 为大小写不敏感的非捕获组：${allExclude}`,
  );
  const allRe = toJsRegex(allExclude);
  const aiRe = toJsRegex(aiExclude);
  assert(
    allRe.test("剩余流量：100GB"),
    "[flclash] exclude-filter 命中机场信息类节点",
  );
  assert(
    !allRe.test("🇯🇵 日本 02 0.5x"),
    "[flclash] exclude-filter 放行正常节点",
  );
  assert(
    !allRe.test(""),
    "[flclash] exclude-filter 不匹配空串（不会清空策略组）",
  );
  assert(
    !allRe.test("自动测速") && !aiRe.test("AI 自动测速"),
    "[flclash] exclude-filter 不误伤自身测速组名",
  );
  assert(!allRe.test("🇭🇰 香港 IEPL 01"), "[flclash]「全部」组保留香港节点");
  assert(aiRe.test("🇭🇰 香港 IEPL 01"), "[flclash] AI 组排除香港节点");
  assert(!aiRe.test("🇸🇬 新加坡 BGP"), "[flclash] AI 组保留非香港节点");

  // 手机端测速参数：拉长间隔省电、放宽容差防抖动切换
  const auto = byName.get("自动测速");
  assert(auto?.hidden === true, "[flclash] 自动测速组隐藏");
  assert(
    auto?.interval === 600 && auto?.tolerance === 80,
    "[flclash] 手机端测速间隔 600s / 容差 80ms",
  );
  assert(
    auto?.lazy === true,
    "[flclash] 自动测速组 lazy（非活跃时不测速，省电）",
  );

  const adblock = byName.get("广告拦截");
  assert(
    adblock &&
      JSON.stringify(adblock.proxies) ===
        JSON.stringify(["REJECT", "DIRECT", "全部"]),
    "[flclash] 广告拦截组选项为 REJECT/DIRECT/全部",
  );

  // proxy-providers 型订阅（手机端常见）：proxies 为空但有 provider，
  // 必须走 include-all 分支而不是零节点回退
  const providerOnly = runScript(
    "flclash-mobile.js",
    {
      proxies: [],
      "proxy-providers": {
        airport: {
          type: "http",
          url: "https://example.invalid/sub",
          path: "./providers/airport.yaml",
          interval: 3600,
        },
      },
    },
    1,
  );
  const providerAll = (providerOnly["proxy-groups"] ?? []).find(
    (g) => g.name === "全部",
  );
  assert(
    providerAll?.["include-all"] === true,
    "[flclash] 仅 proxy-providers 的订阅仍按 include-all 分组（不回退 DIRECT）",
  );

  // 零节点边界：FlClash 注入的空 proxy-providers {} 不能被当成有节点
  const emptyFlclash = runScript(
    "flclash-mobile.js",
    { "proxy-providers": {} },
    1,
  );
  const emptyFlAll = (emptyFlclash["proxy-groups"] ?? []).find(
    (g) => g.name === "全部",
  );
  assert(
    emptyFlAll &&
      JSON.stringify(emptyFlAll.proxies) === JSON.stringify(["DIRECT"]),
    "[flclash] 无节点来源时「全部」回退 DIRECT（空 proxy-providers 不误判）",
  );
  assertRuleTargets("flclash-empty", emptyFlclash);
}

// ============ 导出内核校验用 YAML + 同步产物 ============
if (failed) {
  console.error("\n验证失败，产物未复制到仓库根目录。");
  process.exitCode = 1;
} else {
  writeFileSync(
    new URL("../dist/test-full.yaml", import.meta.url),
    yaml.dump(full, { lineWidth: -1 }),
  );
  writeFileSync(
    new URL("../dist/test-simple.yaml", import.meta.url),
    yaml.dump(simple, { lineWidth: -1 }),
  );
  writeFileSync(
    new URL("../dist/test-flclash.yaml", import.meta.url),
    yaml.dump(flclash, { lineWidth: -1 }),
  );
  // 零节点边界配置也导出：业务组回退 DIRECT 后必须同样能过内核 -t
  writeFileSync(
    new URL("../dist/test-full-empty.yaml", import.meta.url),
    yaml.dump(runScript("mihomo-proxy.js", {}), { lineWidth: -1 }),
  );
  writeFileSync(
    new URL("../dist/test-simple-empty.yaml", import.meta.url),
    yaml.dump(runScript("simple-mihomo.js", {}), { lineWidth: -1 }),
  );
  writeFileSync(
    new URL("../dist/test-flclash-empty.yaml", import.meta.url),
    yaml.dump(runScript("flclash-mobile.js", { "proxy-providers": {} }, 1), {
      lineWidth: -1,
    }),
  );
  copyFileSync(
    new URL("../dist/mihomo-proxy.js", import.meta.url),
    new URL("../mihomo-proxy.js", import.meta.url),
  );
  copyFileSync(
    new URL("../dist/simple-mihomo.js", import.meta.url),
    new URL("../simple-mihomo.js", import.meta.url),
  );
  copyFileSync(
    new URL("../dist/flclash-mobile.js", import.meta.url),
    new URL("../flclash-mobile.js", import.meta.url),
  );
  console.log(
    "\n全部通过：产物已同步到仓库根目录，内核校验 YAML 已导出到 dist/。",
  );
  console.log(
    "第 2 级校验：pnpm verify:kernel（需本地 mihomo 内核或设置 MIHOMO_BIN）",
  );
}
