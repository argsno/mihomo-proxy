// ============================================================
// 0. 用户自定义区（按需修改，留空即不生效）
// ============================================================

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
