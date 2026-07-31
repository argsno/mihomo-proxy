/**
 * 可选的第 3 级校验：实际启动内核，用 API 断言策略组的运行时成员。
 *
 * 为什么需要：手机版（flclash-mobile.js）的节点不再由脚本枚举，而是靠
 * 内核的 include-all + exclude-filter 在运行时纳入。这是 `-t` 查不到的
 * 行为——配置合法不代表组里真的有节点，也不代表信息类节点被排除掉了。
 *
 * 断言项：
 *   1. include-all 确实纳入订阅节点，且不含 DIRECT / REJECT
 *      （内核的 AllProxies 只含订阅节点，一旦这点变化，自动测速组会把
 *       DIRECT 当成"最快节点"选中，全部流量静默直连）
 *   2. exclude-filter 排除机场信息类节点
 *   3. AI 组排除香港节点，「全部」组保留香港节点
 *   4. 显式列出的自动测速组名没有被 exclude-filter 误伤
 *
 * 与 verify-kernel.mjs 一样：找不到内核则跳过（退出码 0）。
 * 需要联网（内核启动时会拉取 rule-providers）。
 * 用法：pnpm verify:runtime
 */
import { execFileSync, spawn } from "node:child_process";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import yaml from "js-yaml";

const distDir = fileURLToPath(new URL("../dist/", import.meta.url));
const API = "127.0.0.1:19099";

let failed = false;
const assert = (cond, msg) => {
  if (!cond) {
    console.error(`✗ ${msg}`);
    failed = true;
  } else {
    console.log(`✓ ${msg}`);
  }
};

const findKernel = () => {
  if (process.env.MIHOMO_BIN && existsSync(process.env.MIHOMO_BIN)) {
    return process.env.MIHOMO_BIN;
  }
  const candidates = [
    "mihomo",
    "mihomo.exe",
    "D:\\Sparkle\\resources\\sidecar\\mihomo.exe",
    "D:\\Clash Verge\\verge-mihomo.exe",
  ];
  for (const c of candidates) {
    try {
      execFileSync(c, ["-v"], { stdio: "pipe" });
      return c;
    } catch {
      /* try next */
    }
  }
  return null;
};

const kernel = findKernel();
if (!kernel) {
  console.log(
    "⊘ 未找到 mihomo 内核，跳过第 3 级校验（可设置 MIHOMO_BIN 指定路径）",
  );
  process.exit(0);
}

const srcPath = path.join(distDir, "test-flclash.yaml");
if (!existsSync(srcPath)) {
  console.error("✗ dist/test-flclash.yaml 不存在，请先运行 pnpm build");
  process.exit(1);
}

// 探针配置：开 API、关 TUN（免管理员权限）、换用不冲突的端口
const cfg = yaml.load(readFileSync(srcPath, "utf8"));
cfg["external-controller"] = API;
cfg.tun = { ...(cfg.tun || {}), enable: false };
cfg["mixed-port"] = 17890;
cfg.dns = { ...cfg.dns, listen: "0.0.0.0:11053" };
const probePath = path.join(distDir, "probe-flclash.yaml");
writeFileSync(probePath, yaml.dump(cfg, { lineWidth: -1 }));

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const child = spawn(kernel, ["-d", distDir, "-f", probePath], {
  stdio: "ignore",
});

try {
  let ready = false;
  for (let i = 0; i < 30; i++) {
    await wait(1000);
    try {
      await (await fetch(`http://${API}/version`)).json();
      ready = true;
      break;
    } catch {
      /* 内核还在启动 / 拉规则集 */
    }
  }
  if (!ready) {
    console.error("✗ 内核未能在 30s 内就绪（检查网络与端口占用）");
    process.exitCode = 1;
  } else {
    await wait(1500); // 等策略组初始化完成
    const { proxies } = await (await fetch(`http://${API}/proxies`)).json();
    const members = (name) => proxies[name]?.all ?? [];

    const all = members("全部");
    const auto = members("自动测速");
    const ai = members("AI");
    const aiAuto = members("AI 自动测速");

    console.log(`\n【全部】${JSON.stringify(all)}`);
    console.log(`【AI】${JSON.stringify(ai)}\n`);

    assert(
      all.includes("自动测速"),
      "「全部」组包含自动测速（显式成员未被 exclude-filter 误伤）",
    );
    assert(ai.includes("AI 自动测速"), "「AI」组包含 AI 自动测速");
    assert(
      auto.length > 0 && aiAuto.length > 0,
      "include-all 已把订阅节点纳入测速组",
    );
    assert(
      !auto.includes("DIRECT") && !auto.includes("REJECT"),
      "自动测速组不含 DIRECT / REJECT（否则会把直连当成最快节点选中）",
    );
    assert(
      !all.some((n) => /剩余|流量|到期|官网/.test(n)),
      "exclude-filter 已排除机场信息类节点",
    );
    assert(
      all.some((n) => /香港|🇭🇰/.test(n)),
      "「全部」组保留香港节点",
    );
    assert(!ai.some((n) => /香港|🇭🇰/.test(n)), "AI 组已排除香港节点");
  }
} finally {
  child.kill();
}

process.exitCode = failed ? 1 : (process.exitCode ?? 0);
