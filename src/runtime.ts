import type { ClashConfig } from "./types";

// ============================================================
// 9. RuntimeBuilder —— 运行时 / Sniffer / TUN
// ============================================================

export const applyRuntime = (cfg: ClashConfig): void => {
  cfg.mode = "rule";
  cfg["log-level"] = "warning"; // 降低日志开销
  cfg["tcp-concurrent"] = true; // 多 IP 并发握手，降低连接延迟
  cfg["unified-delay"] = true; // 统一延迟统计口径，测速更准
  cfg["find-process-mode"] = "off"; // 无进程规则，关闭以提升性能
  // 注：global-client-fingerprint 已从新版内核移除，如需 TLS 指纹请在
  // 节点级设置 client-fingerprint，此处不再全局注入。
  cfg["keep-alive-interval"] = 30; // 长连接保活，缓解 FCM 等断流
  cfg["keep-alive-idle"] = 600;
  cfg.profile = {
    ...(cfg.profile || {}),
    "store-selected": true, // 记住手动选择的节点
    // 持久化 fake-ip 映射：内核重启后同域名拿到同一 fake-ip。设 false
    // 时重启后地址池从头分配，浏览器连接池/长驻进程缓存的旧 fake-ip
    // 会映射到别的域名，TUN + strict-route 下表现为发错站或黑洞。
    // （fake-ip-range 变更时内核会自动重建映射，无需担心错乱。）
    "store-fake-ip": true,
  };
};

export const applySniffer = (cfg: ClashConfig): void => {
  cfg.sniffer = {
    ...(cfg.sniffer || {}),
    enable: true,
    "force-dns-mapping": true,
    "parse-pure-ip": true,
    // 全局关闭强制覆盖：保护 FCM 等长连接，且避免影响 YouTube QUIC（Plan 9）
    "override-destination": false,
    sniff: {
      // HTTP 端口区间必须避开 TLS 的 8443：同一 TCP 端口被两个 sniffer
      // 同时声明时，究竟由谁接管取决于内核内部顺序（v1.19.30 的
      // "coordinate TCP sniffers on overlapping ports" 才把这类冲突理顺），
      // 而这里两者的 override-destination 取值相反，重叠即行为不确定。
      // 故把 8080-8880 切成两段，把 8443 单独留给 TLS。
      // 注：HTTP sniffer 自 v1.19.30 起同时覆盖 H2C（明文 HTTP/2），
      // QUIC sniffer 同时覆盖 QUICv2，均无需额外配置。
      HTTP: {
        ports: [80, "8080-8442", "8444-8880"],
        "override-destination": false,
      },
      TLS: { ports: [443, 8443], "override-destination": true },
      QUIC: { ports: [443, 8443], "override-destination": true },
    },
    // 跳过常见无需嗅探的 CDN/内网域名
    "skip-domain": ["Mijia Cloud", "+.push.apple.com", "+.oray.com"],
  };
};

export const applyTun = (cfg: ClashConfig): void => {
  cfg.tun = {
    ...(cfg.tun || {}),
    enable: true,
    stack: "mixed",
    "auto-route": true,
    "auto-detect-interface": true,
    "strict-route": false, // 降级：减轻全流量接管的性能压力（卡顿修复）
    "endpoint-independent-nat": true, // 改善 P2P / 游戏 NAT（Plan 10）
    "dns-hijack": ["any:53", "tcp://any:53"],
    mtu: 1500, // 通用最优 MTU；弱网可下调至 1280
    "disable-icmp-forwarding": true, // 防 ICMP 转发风暴导致占用飙升
  };
};
