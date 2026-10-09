/**
 * 全局常量配置
 * ------------------------------------------------------------------
 * 包含测速策略、规则集路径、通用图标以及预定义地区顺序等常量。
 */

/**
 * 健康检查期望状态码。
 * 测速地址 generate_204 正常返回 204，显式锁定避免门户劫持时误判节点可用。
 */
const EXPECTED_STATUS = 204;

export const SETTINGS = {
  /** Koolson/Qure 彩色图标库根地址 */
  ICON_BASE:
    "https://fastly.jsdelivr.net/gh/Koolson/Qure@master/IconSet/Color/",

  /** MetaCubeX meta-rules-dat 规则集根地址 */
  RULE_PROVIDER_URL_BASE:
    "https://fastly.jsdelivr.net/gh/MetaCubeX/meta-rules-dat@meta/geo",

  /** 规则集本地缓存目录 */
  RULE_PROVIDER_PATH: "./rules",

  /** 规则集更新间隔（秒）：24 小时 */
  PROVIDER_INTERVAL: 86400,

  /** 策略组中地区的展示顺序（同时决定生成顺序） */
  REGION_ORDER: ["HK", "TW", "JP", "SG", "KR", "US", "EU", "AU", "AS"],

  /**
   * url-test 自动测速组参数（桌面端）。
   * 采用 600s 间隔与 100ms 容差，降低长连接频繁切换造成的断流风险。
   */
  URL_TEST_EXTRA: {
    hidden: true,
    url: "https://www.gstatic.com/generate_204",
    interval: 600,
    tolerance: 100,
    lazy: true,
    timeout: 5000,
    "max-failed-times": 3,
    "expected-status": EXPECTED_STATUS,
  },
  /**
   * url-test 自动测速组参数（移动端 / FlClash）。
   * 放宽至 600s 间隔与 80ms 容差，降低后台唤醒频次并减少移动网络抖动引起的频繁切换。
   */
  MOBILE_URL_TEST_EXTRA: {
    hidden: true,
    url: "https://www.gstatic.com/generate_204",
    interval: 600,
    tolerance: 80,
    lazy: true,
    timeout: 5000,
    "max-failed-times": 3,
    "expected-status": EXPECTED_STATUS,
  },

  /**
   * smart 智能选路组参数（Bettbox 内核专属，bettbox-smart 变体）。
   * smart 组按真实连接质量打分选路（首响应延迟 + 重传惩罚 + 按站点记忆），
   * 内核固定每 5 分钟重测一轮：interval 参数无效（不写入，避免误解），
   * 择优范围由内核的优选集合自动决定，也没有 url-test 的 tolerance 语义。
   * timeout / lazy / max-failed-times / expected-status 语义与测速组相同。
   */
  SMART_EXTRA: {
    hidden: true,
    url: "https://www.gstatic.com/generate_204",
    lazy: true,
    timeout: 5000,
    "max-failed-times": 3,
    "expected-status": EXPECTED_STATUS,
  },

  /** fallback 故障转移组通用参数 */
  FALLBACK_TEST_EXTRA: {
    url: "https://www.gstatic.com/generate_204",
    interval: 300,
    lazy: true,
    timeout: 5000,
    "max-failed-times": 3,
    "expected-status": EXPECTED_STATUS,
  },

  /** 机场营销/通知/信息类无效节点过滤器（用于从正常节点池中剔除） */
  INFO_FILTER:
    /tg|telegram|倒卖|到期|电报|订阅|发布|防止|返利|购买|官方|官网|工单|过期|规则|建议|客服|联系|流量|剩余|失联|网址|邮箱|续费|邀请|重置|梯子|群/i,
};

/**
 * 常用 DNS 上游服务器
 */
export const DNS_SERVERS = {
  /** Bootstrap DNS（纯 IP，用于解析 DoH 域名本身） */
  BOOTSTRAP: ["223.5.5.5", "119.29.29.29", "1.1.1.1", "8.8.8.8"],

  /** 国内加密 DoH（AliDNS + DNSPod，用于节点解析与国内白名单） */
  CN_DOH: ["https://dns.alidns.com/dns-query", "https://doh.pub/dns-query"],

  /**
   * 国际加密 DoH（IP 格式，直连免 Bootstrap）。
   * 默认作为全局 nameserver 经代理出站，避免境内运营商截获解析。
   * 使用 Quad9 + Cloudflare 双源异构组合，避免单一服务商单点故障。
   */
  GLOBAL_DOH: ["https://1.1.1.1/dns-query", "https://9.9.9.9/dns-query"],
};

/** Fake-IP IPv4 / IPv6 地址池 */
export const FAKE_IP_RANGE = "198.18.0.1/16";
export const FAKE_IP_RANGE6 = "fc00::/18";
