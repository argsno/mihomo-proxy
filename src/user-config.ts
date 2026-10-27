/**
 * 用户自定义配置区
 * ------------------------------------------------------------------
 * 供用户按需配置强制直连/代理域名、节点排除正则以及 QUIC 拦截开关。
 * 四个版本共享此配置，修改后执行 pnpm build 即可生效。
 */

/** 强制直连的域名（后缀匹配），示例：["mycompany.com", "internal.example"] */
export const BYPASS_DOMAINS: string[] = [];

/** 强制走代理的域名（精确匹配；完整版出口为 main 组，极简版为「全部」组） */
export const FORCE_PROXY_DOMAINS: string[] = [];

/** 需要从订阅中剔除的节点名过滤器（正则） */
export const CUSTOM_FILTER = /示例占位符1|示例占位符2|示例占位符3/i;

/**
 * 阻断 Google 系的 QUIC（UDP 443），强制回落 HTTP/2 over TCP。
 *
 * Google 是 QUIC 用得最激进的一族（googleapis / gstatic / googlevideo /
 * youtube 几乎全量 HTTP/3）。多数机场节点不转发 UDP 或对 UDP 做限速，
 * QUIC 包直接进黑洞——浏览器不会立刻报错，而是等自己的超时再回落 TCP，
 * 表现就是「页面时不时卡几秒才出来」这种间歇性不稳定，而非明确的连不上。
 *
 * 置 true（默认）：主动 REJECT 这些 UDP 443 连接，客户端立即感知并回落，
 * 卡顿消失，代价是放弃 HTTP/3 的性能收益。
 * 置 false：节点确认支持 UDP 且质量良好时可关闭，让 QUIC 正常工作。
 */
export const BLOCK_GOOGLE_QUIC = true;

/**
 * OpenCode（AI coding agent，opencode.ai）不走代理预设，五版产物共享。
 *
 * 背景：OpenCode 全部出站流量（模型 API、Console 网关、模型目录、
 * 遥测）都由 `opencode` 单二进制进程发出，进程级直连即可一次覆盖；
 * 额外把自家域名写直连，是为了在进程查找失效的环境（App 端
 * find-process-mode 被强制覆写为 off、或后台进程缓存缺失）下，
 * Console 登录与模型目录请求仍能直连。
 *
 * 注意：
 * - domains 是 DOMAIN-SUFFIX，任何进程访问这些域名都会直连。
 *   例如浏览器打开 console.opencode.ai 登录页也走直连，若你的
 *   网络直连 opencode.ai 不通，请关闭开关改用纯进程方式。
 * - 官方未公布固定 IP 段，故不做 IP-CIDR 层面的直连。
 * - 该预设生成的 PROCESS-NAME 规则依赖进程查找生效，详见
 *   `src/rules.ts` 与 README 中「查找进程」的说明。
 */
export const OPENCODE_BYPASS = {
  /** 总开关 */
  enabled: true,

  /**
   * OpenCode 可执行文件进程名（PROCESS-NAME 精确匹配）。
   * macOS/Linux 取二进制名 `opencode`；Windows 进程名带扩展名
   * `opencode.exe`，两个都要列。安装方式（npm/brew/安装脚本）不同
   * 只改变可执行路径，不改变进程名。
   */
  processes: ["opencode", "opencode.exe"],

  /**
   * OpenCode 自家服务域名（DOMAIN-SUFFIX 后缀匹配）。
   * - opencode.ai：Console / 推理网关 / auth / 证书与版本元数据
   *   （api.、console.、cert. 等子域一并覆盖）
   * - models.dev：provider 与模型目录（启动时拉取 api.json）
   */
  domains: ["opencode.ai", "models.dev"],
};

/**
 * Qoder（AI coding IDE）走代理预设，五版产物共享。
 *
 * 范围：仅国际版 `/Applications/Qoder.app`（com.qoder.app）。国内版
 * `Qoder CN.app`（com.qodercn.app）进程名是 `Qoder CN`，不会被进程
 * 规则命中；其 API 走 `gateway.qoder.com` / `openapi.qoder.com`，
 * 所以 qoder.com 不能写进域名规则，否则会连带把国内版送进代理。
 *
 * Qoder 是 Electron 多进程应用：HTTP(S) 请求实际由网络服务 Helper 进程
 * 发出，主进程只负责拉起 agent / MCP 等 Node 子进程，两者都要列。
 * 进程规则依赖进程查找（桌面端「查找进程」需为 always），域名规则是
 * 进程查找不可用时的保底。
 */
export const QODER_PROXY = {
  /** 总开关 */
  enabled: true,

  /**
   * 进程名（PROCESS-NAME 精确匹配）。
   * - `Qoder`：主程序，同时承接它拉起的 Node 子进程（agent SDK、
   *   search daemon、MCP server 等都以主二进制名运行）
   * - `Qoder Helper`：Electron 网络服务进程，真正发包的一端
   * - `Qoder Helper (Renderer)` / `Qoder Helper (Plugin)`：渲染进程
   *   与扩展宿主，兜底
   * - Windows 上 Electron 的子进程都跑在 `Qoder.exe` 下
   */
  processes: [
    "Qoder",
    "Qoder Helper",
    "Qoder Helper (Renderer)",
    "Qoder Helper (Plugin)",
    "Qoder.exe",
  ],

  /**
   * 国际版自家服务域名（DOMAIN-SUFFIX 后缀匹配）。
   * - qoder.sh：center（登录/账号）、openapi、api2/api3（推理网关）
   *
   * 刻意不含 qoder.com：国内版 Qoder CN 的 gateway / openapi / docs /
   * static 都在该后缀下，写进去会连带代理国内版。国际版的 qoder.com
   * （静态资源、更新）由进程规则覆盖。
   */
  domains: ["qoder.sh"],
};

/**
 * smart 组节点优先级（仅 bettbox-smart 变体生效；留空表示不设置）。
 *
 * 格式 "正则:系数;正则:系数"，对节点名做正则匹配，第一个命中的规则生效；
 * 系数小于 1 提升优先级、大于 1 降低优先级（默认 1.0），必须为正数。
 *
 * 示例：'Premium:0.9;备用:1.3'
 *   - 节点名含 Premium 的乘 0.9（更容易被选中）
 *   - 节点名含 备用 的乘 1.3（更少被选中）
 */
export const POLICY_PRIORITY = "";
