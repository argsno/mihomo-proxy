import { DNS_SERVERS, FAKE_IP_RANGE, FAKE_IP_RANGE6 } from "./settings";
import { uniq } from "./utils";
import type { ClashConfig } from "./types";

/**
 * DNS 架构配置构建器
 * ------------------------------------------------------------------
 * 核心设计原则：防 DNS 泄露 + Smart 上游精确分流。
 * - respect-rules: true 确保境外 DNS 请求经代理通道出站，境外域名绝不落入国内解析商
 * - proxy-server-nameserver 采用国内加密 DoH，保证节点域名直连可解且不受污染
 * - direct-nameserver 采用系统 DNS + 国内 DoH，配合 follow-policy 处理直连域名
 * - nameserver-policy 精确分派国内外规则集，杜绝解析污染与解析回环
 */

export const applyDns = (cfg: ClashConfig): void => {
  const dns = cfg.dns || {};
  const userFakeIpFilter: string[] = Array.isArray(dns["fake-ip-filter"])
    ? dns["fake-ip-filter"]
    : [];

  // Fake-IP 豁免黑名单：仅对局域网、国内服务、NTP 与特定系统连通性测试放行真实 IP
  const fakeIpFilter = uniq([
    "rule-set:private",
    "rule-set:cn",
    "+.cn",
    "+.lan",
    "+.local",
    "localhost",
    "*.localhost",
    // 腾讯系安全校验与游戏平台域名
    "+.qq.com",
    "+.tencent.com",
    "+.qcloud.com",
    "+.wegame.com.cn",
    // STUN（WebRTC 与游戏 NAT 穿透）
    "+.stun.*.*",
    "+.stun.*.*.*",
    "+.stun.*.*.*.*",
    // 网络授时
    "rule-set:category-ntp",
    // 系统连通性探测（仅豁免微软与苹果，不整组引用以避免泄露 gstatic 探测）
    "+.msftconnecttest.com",
    "+.msftncsi.com",
    "+.captive.apple.com",
    ...userFakeIpFilter,
  ]);

  cfg.dns = {
    ...dns,
    enable: true,
    listen: "0.0.0.0:1053",
    ipv6: false, // 规避国内不稳定 IPv6 导致的 AAAA 查询超时与连接卡顿
    "cache-algorithm": "arc",
    "prefer-h3": false, // 官方明确建议：respect-rules 启用时不与 prefer-h3 同开
    "use-hosts": true,
    "use-system-hosts": true,

    // 核心：DNS 请求遵循路由分流规则出站
    "respect-rules": true,

    "enhanced-mode": "fake-ip",
    "fake-ip-range": FAKE_IP_RANGE,
    "fake-ip-range6": FAKE_IP_RANGE6,
    "fake-ip-filter-mode": "blacklist",
    "fake-ip-filter": fakeIpFilter,

    // Bootstrap DNS：用于解析 DoH 域名本身（系统 DNS 优先以兼容校园网认证阶段）
    "default-nameserver": ["system", ...DNS_SERVERS.BOOTSTRAP],

    // 默认上游：国际加密 DoH（经代理出口出站，防 DNS 泄露核心）
    nameserver: DNS_SERVERS.GLOBAL_DOH,

    // 节点服务器域名解析器：直连可达且防污染的国内加密 DoH
    "proxy-server-nameserver": DNS_SERVERS.CN_DOH,

    // 直连出口专用解析器：直连流量优先使用国内解析，follow-policy 保留 policy 优先级
    "direct-nameserver": ["system", ...DNS_SERVERS.CN_DOH],
    "direct-nameserver-follow-policy": true,

    // 精确上游策略：按规则集指派最优 DNS（注意：多个 rule-set 共享键时只写一次 rule-set: 前缀）
    "nameserver-policy": {
      // 私有网络与内网域名 → 系统 DNS 优先
      "rule-set:private": ["system", ...DNS_SERVERS.CN_DOH],

      // 国内高频服务
      "+.qq.com": DNS_SERVERS.CN_DOH,
      "+.tencent.com": DNS_SERVERS.CN_DOH,
      "+.qcloud.com": DNS_SERVERS.CN_DOH,
      "+.wegame.com.cn": DNS_SERVERS.CN_DOH,

      // 境外主流服务族群 → 国际纯净 DoH
      "rule-set:google,googlefcm,youtube,gfw,telegram,spotify,category-ai,openai,anthropic,perplexity,cursor,notion,xai":
        DNS_SERVERS.GLOBAL_DOH,

      // 时间同步与系统连通性探测（直连解析，防止代理未建立时的启动死锁）
      "rule-set:category-ntp": ["system", ...DNS_SERVERS.CN_DOH],
      "+.msftconnecttest.com": ["system", ...DNS_SERVERS.CN_DOH],
      "+.msftncsi.com": ["system", ...DNS_SERVERS.CN_DOH],
      "+.captive.apple.com": ["system", ...DNS_SERVERS.CN_DOH],

      // Steam CDN 国内加速解析（确保直连拉取就近 CDN 节点）
      "+.steamcontent.com": DNS_SERVERS.CN_DOH,
      "+.steamserver.net": DNS_SERVERS.CN_DOH,
      "+.steampipe.akamaized.net": DNS_SERVERS.CN_DOH,

      // 国内域名白名单族群 → 国内 DoH
      "rule-set:cn,apple-cn,google-cn,microsoft-cn,steam-cn":
        DNS_SERVERS.CN_DOH,
    },
  };

  // DoH 域名预解析加速 + 特殊映射
  cfg.hosts = {
    ...(cfg.hosts || {}),
    "dns.alidns.com": ["223.5.5.5", "223.6.6.6"],
    "doh.pub": ["1.12.12.12", "120.53.53.53"],
    "services.googleapis.cn": "services.googleapis.com",
    "+.mcdn.bilivideo.com": ["0.0.0.0"], // 屏蔽 B 站 P2P CDN 回源
    "+.mcdn.bilivideo.cn": ["0.0.0.0"],
  };
};
