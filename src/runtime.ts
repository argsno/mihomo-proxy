import type { ClashConfig } from "./types";

/**
 * 运行时、域名嗅探与虚拟网卡配置
 * ------------------------------------------------------------------
 * 负责底层网络性能优化（并发握手、长连接保活、Fake-IP 映射持久化）、
 * 流量嗅探（Sniffer 协议识别与端口互斥）以及 TUN 虚拟网卡配置。
 */

export const applyRuntime = (cfg: ClashConfig): void => {
  cfg.mode = "rule";
  cfg["log-level"] = "warning";
  cfg["tcp-concurrent"] = true; // 多 IP 并发握手，减少首包延迟
  cfg["unified-delay"] = true; // 统一延迟计算方式
  cfg["find-process-mode"] = "off"; // 移动端/无进程分流场景关闭以节省性能
  cfg["keep-alive-interval"] = 30; // 30s TCP 心跳保活，降低 FCM 等长连接异常中断
  cfg["keep-alive-idle"] = 600;
  cfg.profile = {
    ...(cfg.profile || {}),
    "store-selected": true, // 持久化记录用户手动选择的节点
    "store-fake-ip": true, // 持久化 Fake-IP 缓存，避免内核重启后映射错乱
  };
};

export const applySniffer = (cfg: ClashConfig): void => {
  cfg.sniffer = {
    ...(cfg.sniffer || {}),
    enable: true,
    "force-dns-mapping": true,
    "parse-pure-ip": true,
    "override-destination": false, // 全局关闭强制覆写，保护长连接与 QUIC 会话
    sniff: {
      // HTTP 与 TLS 的 TCP 端口区间严格互斥（8443 独立预留给 TLS）
      HTTP: {
        ports: [80, "8080-8442", "8444-8880"],
        "override-destination": false,
      },
      TLS: { ports: [443, 8443], "override-destination": true },
      QUIC: { ports: [443, 8443], "override-destination": true },
    },
    // 跳过常见内网与无需嗅探的推送域名
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
    "strict-route": false, // 降低路由表接管开销
    "endpoint-independent-nat": true, // 启用锥型 NAT，改善 P2P 与在线联机
    "dns-hijack": ["any:53", "tcp://any:53"],
    mtu: 1500, // 推荐标准 MTU（弱网/校园网可降至 1280）
    "disable-icmp-forwarding": true, // 拦截 ICMP 转发，防止广播风暴
  };
};
