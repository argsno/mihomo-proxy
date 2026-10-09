const Compatible_With_Bettbox = { ruleOptionsEnable: true };
/**
* bettbox-smart — Bettbox 智能选路版覆写脚本 v3.0
* ------------------------------------------------------------------
* 与 bettbox-flclash 相同的完整分流布局（Google / YouTube / AI /
* Telegram / Steam / Apple / Microsoft / Spotify + 地区分组
* HK/TW/JP/SG/KR/US/EU/AU/AS + Bettbox 可视化开关），唯一区别：
* 所有隐藏自动选路组由 url-test 换成 Bettbox 内核的 smart 类型，
* 按真实连接质量打分选路：
*
*   All        —— 智能选路打头（全部节点），可手动切任意节点
*   地区分组   —— 各地区智能选路打头，可手动切换
*   Other      —— 未归类节点的智能选路
*   AI         —— 排除香港的纯净节点池智能选路
*   main / GLOBAL —— 顶层入口与全局汇总
*
* smart 与 url-test 的区别：url-test 只看周期性测速延迟；smart 用真实
* 连接的首响应延迟打分（含重传惩罚与按站点记忆），失败自动回退下一候选；
* 内核固定每 5 分钟重测一轮，interval 参数无效。
* 可在 src/user-config.ts 的 POLICY_PRIORITY 中按正则给节点配优先级。
*
* ── Bettbox 可视化开关 ───────────────────────────────────────────
* 本脚本首行的 Compatible_With_Bettbox 声明会被 Bettbox（v1.18.8+）
* 自动识别，在客户端 UI 中渲染可视化配置面板，用户可直接通过开关
* 控制各分流策略组和地区分组的启用/禁用。
*
* ── 仅限 Bettbox（smart 为内核专属能力）──────────────────────────
* 上游 mihomo 内核（FlClash / Sparkle / Clash Verge Rev 等）不支持
* smart 组，配置校验会报 `unsupported type: smart`，请勿混用；
* 需要 url-test 版本请改用 bettbox-flclash.js。
*
* ── 用法 ──────────────────────────────────────────────────────────
* 设置 → 高级设置 → 脚本 → 添加 →（右上角可远程下载本脚本链接）→
* 保存；再到 配置 → 对应订阅 → 覆写 → 模式选「脚本」→ 勾选本脚本。
*
* ── 必须在 App 内正确的设置（脚本无法覆盖，会被 App 强制改写）────
*  1. 设置 → 网络 →「覆写 DNS」保持【关闭】
*  2. 设置 → 网络 →「追加系统 DNS」保持【关闭】
*  3. 出站模式选「规则」；TUN 栈选 mixed；
*     「查找进程」建议设为 off
*
* 本文件由 vite build 自动生成，请勿手改；源码见 src/ 目录。
*
* 仓库地址：https://github.com/wchiway/mihomo-proxy
* 脚本链接：https://raw.githubusercontent.com/wchiway/mihomo-proxy/refs/heads/main/bettbox-smart.js
* 客户端：https://github.com/appshubcc/Bettbox
*/
var ruleOptionsEnable = {
	Google: true,
	YouTube: true,
	AI: true,
	Telegram: true,
	Steam: true,
	Apple: true,
	Microsoft: true,
	Spotify: true,
	广告拦截: true,
	地区分组: true,
	屏蔽QUIC: true
};
var serviceConfigs = [
	{
		name: "Google",
		icon: "https://fastly.jsdelivr.net/gh/Koolson/Qure@master/IconSet/Color/Google_Search.png"
	},
	{
		name: "YouTube",
		icon: "https://fastly.jsdelivr.net/gh/Koolson/Qure@master/IconSet/Color/YouTube.png"
	},
	{
		name: "AI",
		icon: "https://fastly.jsdelivr.net/gh/Koolson/Qure@master/IconSet/Color/ChatGPT.png"
	},
	{
		name: "Telegram",
		icon: "https://fastly.jsdelivr.net/gh/Koolson/Qure@master/IconSet/Color/Telegram.png"
	},
	{
		name: "Steam",
		icon: "https://fastly.jsdelivr.net/gh/Koolson/Qure@master/IconSet/Color/Steam.png"
	},
	{
		name: "Apple",
		icon: "https://fastly.jsdelivr.net/gh/Koolson/Qure@master/IconSet/Color/Apple.png"
	},
	{
		name: "Microsoft",
		icon: "https://fastly.jsdelivr.net/gh/Koolson/Qure@master/IconSet/Color/Microsoft.png"
	},
	{
		name: "Spotify",
		icon: "https://fastly.jsdelivr.net/gh/Koolson/Qure@master/IconSet/Color/Spotify.png"
	},
	{
		name: "广告拦截",
		icon: "https://fastly.jsdelivr.net/gh/Koolson/Qure@master/IconSet/Color/AdBlack.png"
	},
	{
		name: "地区分组",
		icon: "https://fastly.jsdelivr.net/gh/Koolson/Qure@master/IconSet/Color/Global.png"
	},
	{
		name: "屏蔽QUIC",
		icon: "https://fastly.jsdelivr.net/gh/Koolson/Qure@master/IconSet/Color/Reject.png"
	}
];
var __mihomoBettboxSmart = (function(exports) {
	Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
	//#region src/user-config.ts
	/**
	* 用户自定义配置区
	* ------------------------------------------------------------------
	* 供用户按需配置强制直连/代理域名、节点排除正则以及 QUIC 拦截开关。
	* 四个版本共享此配置，修改后执行 pnpm build 即可生效。
	*/
	/** 强制直连的域名（后缀匹配），示例：["mycompany.com", "internal.example"] */
	var BYPASS_DOMAINS = [];
	/** 强制走代理的域名（精确匹配；完整版出口为 main 组，极简版为「全部」组） */
	var FORCE_PROXY_DOMAINS = [];
	/** 需要从订阅中剔除的节点名过滤器（正则） */
	var CUSTOM_FILTER = /示例占位符1|示例占位符2|示例占位符3/i;
	//#endregion
	//#region src/settings.ts
	/**
	* 全局常量配置
	* ------------------------------------------------------------------
	* 包含测速策略、规则集路径、通用图标以及预定义地区顺序等常量。
	*/
	/**
	* 健康检查期望状态码。
	* 测速地址 generate_204 正常返回 204，显式锁定避免门户劫持时误判节点可用。
	*/
	var EXPECTED_STATUS = 204;
	var SETTINGS = {
		/** Koolson/Qure 彩色图标库根地址 */
		ICON_BASE: "https://fastly.jsdelivr.net/gh/Koolson/Qure@master/IconSet/Color/",
		/** MetaCubeX meta-rules-dat 规则集根地址 */
		RULE_PROVIDER_URL_BASE: "https://fastly.jsdelivr.net/gh/MetaCubeX/meta-rules-dat@meta/geo",
		/** 规则集本地缓存目录 */
		RULE_PROVIDER_PATH: "./rules",
		/** 规则集更新间隔（秒）：24 小时 */
		PROVIDER_INTERVAL: 86400,
		/** 策略组中地区的展示顺序（同时决定生成顺序） */
		REGION_ORDER: [
			"HK",
			"TW",
			"JP",
			"SG",
			"KR",
			"US",
			"EU",
			"AU",
			"AS"
		],
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
			timeout: 5e3,
			"max-failed-times": 3,
			"expected-status": EXPECTED_STATUS
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
			timeout: 5e3,
			"max-failed-times": 3,
			"expected-status": EXPECTED_STATUS
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
			timeout: 5e3,
			"max-failed-times": 3,
			"expected-status": EXPECTED_STATUS
		},
		/** fallback 故障转移组通用参数 */
		FALLBACK_TEST_EXTRA: {
			url: "https://www.gstatic.com/generate_204",
			interval: 300,
			lazy: true,
			timeout: 5e3,
			"max-failed-times": 3,
			"expected-status": EXPECTED_STATUS
		},
		/** 机场营销/通知/信息类无效节点过滤器（用于从正常节点池中剔除） */
		INFO_FILTER: /tg|telegram|倒卖|到期|电报|订阅|发布|防止|返利|购买|官方|官网|工单|过期|规则|建议|客服|联系|流量|剩余|失联|网址|邮箱|续费|邀请|重置|梯子|群/i
	};
	/**
	* 常用 DNS 上游服务器
	*/
	var DNS_SERVERS = {
		/** Bootstrap DNS（纯 IP，用于解析 DoH 域名本身） */
		BOOTSTRAP: [
			"223.5.5.5",
			"119.29.29.29",
			"1.1.1.1",
			"8.8.8.8"
		],
		/** 国内加密 DoH（AliDNS + DNSPod，用于节点解析与国内白名单） */
		CN_DOH: ["https://dns.alidns.com/dns-query", "https://doh.pub/dns-query"],
		/**
		* 国际加密 DoH（IP 格式，直连免 Bootstrap）。
		* 默认作为全局 nameserver 经代理出站，避免境内运营商截获解析。
		* 使用 Quad9 + Cloudflare 双源异构组合，避免单一服务商单点故障。
		*/
		GLOBAL_DOH: ["https://1.1.1.1/dns-query", "https://9.9.9.9/dns-query"]
	};
	/** Fake-IP IPv4 / IPv6 地址池 */
	var FAKE_IP_RANGE = "198.18.0.1/16";
	var FAKE_IP_RANGE6 = "fc00::/18";
	//#endregion
	//#region src/rule-providers.ts
	/** GeoSite 域名规则集列表 */
	var GEOSITE_PROVIDERS = [
		{
			key: "category-ads-all",
			file: "category-ads-all"
		},
		{
			key: "private",
			file: "private"
		},
		{
			key: "cn",
			file: "cn"
		},
		{
			key: "google",
			file: "google"
		},
		{
			key: "google-cn",
			file: "google-cn"
		},
		{
			key: "googlefcm",
			file: "googlefcm"
		},
		{
			key: "youtube",
			file: "youtube"
		},
		{
			key: "apple",
			file: "apple"
		},
		{
			key: "apple-cn",
			file: "apple-cn"
		},
		{
			key: "microsoft",
			file: "microsoft"
		},
		{
			key: "microsoft-cn",
			file: "microsoft@cn"
		},
		{
			key: "telegram",
			file: "telegram"
		},
		{
			key: "spotify",
			file: "spotify"
		},
		{
			key: "steam",
			file: "steam"
		},
		{
			key: "steam-cn",
			file: "steam@cn"
		},
		{
			key: "category-ai",
			file: "category-ai-!cn"
		},
		{
			key: "openai",
			file: "openai"
		},
		{
			key: "anthropic",
			file: "anthropic"
		},
		{
			key: "perplexity",
			file: "perplexity"
		},
		{
			key: "cursor",
			file: "cursor"
		},
		{
			key: "notion",
			file: "notion"
		},
		{
			key: "xai",
			file: "xai"
		},
		{
			key: "gfw",
			file: "gfw"
		},
		{
			key: "connectivity-check",
			file: "connectivity-check"
		},
		{
			key: "category-ntp",
			file: "category-ntp"
		}
	];
	/** GeoIP 网段规则集列表 */
	var GEOIP_PROVIDERS = [
		{
			key: "private-ip",
			file: "private"
		},
		{
			key: "cn-ip",
			file: "cn"
		},
		{
			key: "google-ip",
			file: "google"
		},
		{
			key: "telegram-ip",
			file: "telegram"
		}
	];
	/** 构建 rule-providers 配置对象 */
	var buildRuleProviders = () => {
		const providers = {};
		const base = SETTINGS.RULE_PROVIDER_URL_BASE;
		const common = {
			type: "http",
			format: "mrs",
			interval: SETTINGS.PROVIDER_INTERVAL
		};
		GEOSITE_PROVIDERS.forEach(({ key, file }) => {
			providers[key] = {
				...common,
				behavior: "domain",
				path: `${SETTINGS.RULE_PROVIDER_PATH}/${key}.mrs`,
				url: `${base}/geosite/${file}.mrs`
			};
		});
		GEOIP_PROVIDERS.forEach(({ key, file }) => {
			providers[key] = {
				...common,
				behavior: "ipcidr",
				path: `${SETTINGS.RULE_PROVIDER_PATH}/${key}.mrs`,
				url: `${base}/geoip/${file}.mrs`
			};
		});
		providers.cloudflare = {
			type: "inline",
			behavior: "classical",
			payload: ["DOMAIN-SUFFIX,cloudflareinsights.com"]
		};
		return providers;
	};
	//#endregion
	//#region src/utils.ts
	/**
	* 基础工具函数
	* ------------------------------------------------------------------
	* 提供数组去重、正则转义、节点名归一化、倍率解析与线路质量排序等通用功能。
	*/
	/** 数组去重并剔除 falsy */
	var uniq = (arr = []) => [...new Set(arr.filter(Boolean))];
	//#endregion
	//#region src/rules.ts
	/**
	* 分流规则构建器
	* ------------------------------------------------------------------
	* 规则遵循严格的有序匹配机制（先匹配即生效，越具体的规则越靠前）。
	* 多个版本共享同一份规则骨架，仅通过 RuleTargets 参数化注入不同出口策略组。
	*/
	/**
	* Google 系 QUIC 阻断规则（UDP 443 → REJECT，迫使客户端立即回落 TCP）。
	* 必须置于所有 Google/AI/YouTube 规则之前；使用 REJECT 而非 REJECT-DROP，
	* 避免浏览器因静默丢包超时等待数秒。
	*/
	var GOOGLE_QUIC_DOMAINS = [
		"googleapis.com",
		"gstatic.com",
		"google.com",
		"googlevideo.com",
		"youtube.com",
		"ytimg.com",
		"ggpht.com"
	];
	var googleQuicRule = (enabled = true) => enabled ? [`AND,((NETWORK,udp),(DST-PORT,443),(OR,(${GOOGLE_QUIC_DOMAINS.map((d) => `(DOMAIN-SUFFIX,${d})`).join(",")}))),REJECT`] : [];
	/**
	* 构建静态分流规则列表。
	* - 顺序敏感：广告拦截 → 自定义 → 游戏直连 → 基础设施 → QUIC阻断 → AI → Google → 业务服务 → GFW → 国内直连 → MATCH
	*/
	var buildStaticRules = (t) => [
		`RULE-SET,category-ads-all,${t.adblock}`,
		...uniq(BYPASS_DOMAINS).map((d) => `DOMAIN-SUFFIX,${d},DIRECT`),
		...uniq(FORCE_PROXY_DOMAINS).map((d) => `DOMAIN,${d},${t.proxy}`),
		"DOMAIN-SUFFIX,wegame.com.cn,DIRECT",
		"DOMAIN-KEYWORD,wegame,DIRECT",
		"DOMAIN-SUFFIX,igame.qq.com,DIRECT",
		"DOMAIN-SUFFIX,tgp.qq.com,DIRECT",
		"RULE-SET,cloudflare,DIRECT",
		"RULE-SET,private,DIRECT",
		"RULE-SET,private-ip,DIRECT,no-resolve",
		...googleQuicRule(t.blockQuic),
		`RULE-SET,openai,${t.ai}`,
		`RULE-SET,anthropic,${t.ai}`,
		`RULE-SET,perplexity,${t.ai}`,
		`RULE-SET,cursor,${t.ai}`,
		`RULE-SET,notion,${t.ai}`,
		`RULE-SET,xai,${t.ai}`,
		`RULE-SET,category-ai,${t.ai}`,
		`DOMAIN-SUFFIX,googleapis.com,${t.google}`,
		`DOMAIN-SUFFIX,gstatic.com,${t.google}`,
		`RULE-SET,googlefcm,${t.google}`,
		`RULE-SET,youtube,${t.youtube}`,
		`RULE-SET,google,${t.google}`,
		`RULE-SET,google-ip,${t.google},no-resolve`,
		"RULE-SET,google-cn,DIRECT",
		`RULE-SET,telegram,${t.telegram}`,
		`RULE-SET,telegram-ip,${t.telegram},no-resolve`,
		"DOMAIN-SUFFIX,steamcontent.com,DIRECT",
		"DOMAIN-SUFFIX,steamserver.net,DIRECT",
		"DOMAIN-SUFFIX,steampipe.akamaized.net,DIRECT",
		"RULE-SET,steam-cn,DIRECT",
		`RULE-SET,steam,${t.steam}`,
		"RULE-SET,apple-cn,DIRECT",
		`RULE-SET,apple,${t.apple}`,
		"RULE-SET,microsoft-cn,DIRECT",
		`RULE-SET,microsoft,${t.microsoft}`,
		`RULE-SET,spotify,${t.spotify ?? t.proxy}`,
		"RULE-SET,connectivity-check,DIRECT",
		"RULE-SET,category-ntp,DIRECT",
		`RULE-SET,gfw,${t.proxy}`,
		"RULE-SET,cn,DIRECT",
		"RULE-SET,cn-ip,DIRECT,no-resolve",
		`MATCH,${t.proxy}`
	];
	/**
	* 合并用户既有规则中的 DIRECT 规则到 MATCH 之前，保持向后兼容。
	*/
	var mergeRules = (baseRules = [], extraRules = []) => {
		const extra = Array.isArray(extraRules) ? extraRules.filter(Boolean) : [];
		if (!extra.length) return baseRules.slice();
		const matchIndex = baseRules.findIndex((rule) => String(rule).trim().toUpperCase().startsWith("MATCH,"));
		if (matchIndex === -1) return uniq([...baseRules, ...extra]);
		return uniq([
			...baseRules.slice(0, matchIndex),
			...extra,
			...baseRules.slice(matchIndex)
		]);
	};
	/** 从用户既有规则中挑出 DIRECT 规则（供合并保留自定义直连） */
	var pickDirectRules = (rules = []) => rules.filter((rule) => {
		const r = String(rule || "").trim();
		if (!r || r.startsWith("#")) return false;
		return /,DIRECT(?:,|$)/i.test(r);
	});
	//#endregion
	//#region src/dns.ts
	/**
	* DNS 架构配置构建器
	* ------------------------------------------------------------------
	* 核心设计原则：防 DNS 泄露 + Smart 上游精确分流。
	* - respect-rules: true 确保境外 DNS 请求经代理通道出站，境外域名绝不落入国内解析商
	* - proxy-server-nameserver 采用国内加密 DoH，保证节点域名直连可解且不受污染
	* - direct-nameserver 采用系统 DNS + 国内 DoH，配合 follow-policy 处理直连域名
	* - nameserver-policy 精确分派国内外规则集，杜绝解析污染与解析回环
	*/
	var applyDns = (cfg) => {
		const dns = cfg.dns || {};
		const fakeIpFilter = uniq([
			"rule-set:private",
			"rule-set:cn",
			"+.cn",
			"+.lan",
			"+.local",
			"localhost",
			"*.localhost",
			"+.qq.com",
			"+.tencent.com",
			"+.qcloud.com",
			"+.wegame.com.cn",
			"+.stun.*.*",
			"+.stun.*.*.*",
			"+.stun.*.*.*.*",
			"rule-set:category-ntp",
			"+.msftconnecttest.com",
			"+.msftncsi.com",
			"+.captive.apple.com",
			...Array.isArray(dns["fake-ip-filter"]) ? dns["fake-ip-filter"] : []
		]);
		cfg.dns = {
			...dns,
			enable: true,
			listen: "0.0.0.0:1053",
			ipv6: false,
			"cache-algorithm": "arc",
			"prefer-h3": false,
			"use-hosts": true,
			"use-system-hosts": true,
			"respect-rules": true,
			"enhanced-mode": "fake-ip",
			"fake-ip-range": FAKE_IP_RANGE,
			"fake-ip-range6": FAKE_IP_RANGE6,
			"fake-ip-filter-mode": "blacklist",
			"fake-ip-filter": fakeIpFilter,
			"default-nameserver": ["system", ...DNS_SERVERS.BOOTSTRAP],
			nameserver: DNS_SERVERS.GLOBAL_DOH,
			"proxy-server-nameserver": DNS_SERVERS.CN_DOH,
			"direct-nameserver": ["system", ...DNS_SERVERS.CN_DOH],
			"direct-nameserver-follow-policy": true,
			"nameserver-policy": {
				"rule-set:private": ["system", ...DNS_SERVERS.CN_DOH],
				"+.qq.com": DNS_SERVERS.CN_DOH,
				"+.tencent.com": DNS_SERVERS.CN_DOH,
				"+.qcloud.com": DNS_SERVERS.CN_DOH,
				"+.wegame.com.cn": DNS_SERVERS.CN_DOH,
				"rule-set:google,googlefcm,youtube,gfw,telegram,spotify,category-ai,openai,anthropic,perplexity,cursor,notion,xai": DNS_SERVERS.GLOBAL_DOH,
				"rule-set:category-ntp": ["system", ...DNS_SERVERS.CN_DOH],
				"+.msftconnecttest.com": ["system", ...DNS_SERVERS.CN_DOH],
				"+.msftncsi.com": ["system", ...DNS_SERVERS.CN_DOH],
				"+.captive.apple.com": ["system", ...DNS_SERVERS.CN_DOH],
				"+.steamcontent.com": DNS_SERVERS.CN_DOH,
				"+.steamserver.net": DNS_SERVERS.CN_DOH,
				"+.steampipe.akamaized.net": DNS_SERVERS.CN_DOH,
				"rule-set:cn,apple-cn,google-cn,microsoft-cn,steam-cn": DNS_SERVERS.CN_DOH
			}
		};
		cfg.hosts = {
			...cfg.hosts || {},
			"dns.alidns.com": ["223.5.5.5", "223.6.6.6"],
			"doh.pub": ["1.12.12.12", "120.53.53.53"],
			"services.googleapis.cn": "services.googleapis.com",
			"+.mcdn.bilivideo.com": ["0.0.0.0"],
			"+.mcdn.bilivideo.cn": ["0.0.0.0"]
		};
	};
	//#endregion
	//#region src/runtime.ts
	/**
	* 运行时、域名嗅探与虚拟网卡配置
	* ------------------------------------------------------------------
	* 负责底层网络性能优化（并发握手、长连接保活、Fake-IP 映射持久化）、
	* 流量嗅探（Sniffer 协议识别与端口互斥）以及 TUN 虚拟网卡配置。
	*/
	var applyRuntime = (cfg) => {
		cfg.mode = "rule";
		cfg["log-level"] = "warning";
		cfg["tcp-concurrent"] = true;
		cfg["unified-delay"] = true;
		cfg["find-process-mode"] = "off";
		cfg["keep-alive-interval"] = 30;
		cfg["keep-alive-idle"] = 600;
		cfg.profile = {
			...cfg.profile || {},
			"store-selected": true,
			"store-fake-ip": true
		};
	};
	var applySniffer = (cfg) => {
		cfg.sniffer = {
			...cfg.sniffer || {},
			enable: true,
			"force-dns-mapping": true,
			"parse-pure-ip": true,
			"override-destination": false,
			sniff: {
				HTTP: {
					ports: [
						80,
						"8080-8442",
						"8444-8880"
					],
					"override-destination": false
				},
				TLS: {
					ports: [443, 8443],
					"override-destination": true
				},
				QUIC: {
					ports: [443, 8443],
					"override-destination": true
				}
			},
			"skip-domain": [
				"Mijia Cloud",
				"+.push.apple.com",
				"+.oray.com"
			]
		};
	};
	var applyTun = (cfg) => {
		cfg.tun = {
			...cfg.tun || {},
			enable: true,
			stack: "mixed",
			"auto-route": true,
			"auto-detect-interface": true,
			"strict-route": false,
			"endpoint-independent-nat": true,
			"dns-hijack": ["any:53", "tcp://any:53"],
			mtu: 1500,
			"disable-icmp-forwarding": true
		};
	};
	//#endregion
	//#region src/proxies.ts
	/** 节点重名去冲突：追加 _1/_2… 后缀 */
	var makeProxyNamesUnique = (proxies = []) => {
		const used = /* @__PURE__ */ new Set();
		const nextIdx = /* @__PURE__ */ new Map();
		proxies.forEach((p) => {
			if (!p || !p.name) return;
			const base = String(p.name);
			if (!used.has(base)) {
				used.add(base);
				nextIdx.set(base, 1);
				return;
			}
			let idx = nextIdx.get(base) ?? 1;
			let candidate = `${base}_${idx}`;
			while (used.has(candidate)) candidate = `${base}_${++idx}`;
			p.name = candidate;
			used.add(candidate);
			nextIdx.set(base, idx + 1);
		});
	};
	//#endregion
	//#region src/smart-main.ts
	/** 默认开关配置 */
	var DEFAULT_RULE_OPTIONS = {
		Google: true,
		YouTube: true,
		AI: true,
		Telegram: true,
		Steam: true,
		Apple: true,
		Microsoft: true,
		Spotify: true,
		广告拦截: true,
		地区分组: true,
		屏蔽QUIC: true
	};
	/**
	* 动态获取 Bettbox 规则开关配置。
	* 优先读取宿主环境中注入的词法/全局作用域 ruleOptionsEnable（经用户自定义设置覆盖后的值），
	* 未设置的项回退至 DEFAULT_RULE_OPTIONS。
	*/
	function getRuleOptions() {
		let hostOptions;
		try {
			if (typeof ruleOptionsEnable !== "undefined" && ruleOptionsEnable && typeof ruleOptionsEnable === "object") hostOptions = ruleOptionsEnable;
		} catch {}
		if (!hostOptions && typeof globalThis !== "undefined") {
			const g = globalThis;
			if (g.ruleOptionsEnable && typeof g.ruleOptionsEnable === "object") hostOptions = g.ruleOptionsEnable;
		}
		return {
			...DEFAULT_RULE_OPTIONS,
			...hostOptions || {}
		};
	}
	var GROUPS = {
		MAIN: "main",
		ALL: "All",
		AI: "AI",
		GOOGLE: "Google",
		YOUTUBE: "YouTube",
		TELEGRAM: "Telegram",
		STEAM: "Steam",
		APPLE: "Apple",
		MICROSOFT: "Microsoft",
		SPOTIFY: "Spotify",
		ADBLOCK: "广告拦截",
		GLOBAL: "GLOBAL",
		OTHER: "Other"
	};
	/** 隐藏智能选路组名前缀（对应 bettbox-flclash 的 "URL Test - "） */
	var SMART_PREFIX = "智能选路 - ";
	/**
	* 地区定义与 filter 正则
	* 使用 (?i)(?:pattern1|pattern2) 语法统一包裹。
	*/
	var REGION_DEFS = [
		{
			name: "HK",
			filter: "(?i)(?:香港|HK|HKG|HONGKONG|HONG KONG|🇭🇰)",
			icon: "Hong_Kong.png"
		},
		{
			name: "TW",
			filter: "(?i)(?:台湾|台北|新北|TW|TWN|TAIWAN|TAIPEI|🇹🇼)",
			icon: "Taiwan.png"
		},
		{
			name: "JP",
			filter: "(?i)(?:日本|东京|大阪|JP|JPN|JAPAN|TOKYO|OSAKA|🇯🇵)",
			icon: "Japan.png"
		},
		{
			name: "SG",
			filter: "(?i)(?:新加坡|狮城|SG|SGP|SINGAPORE|🇸🇬)",
			icon: "Singapore.png"
		},
		{
			name: "KR",
			filter: "(?i)(?:韩国|首尔|KR|KOR|KOREA|SEOUL|🇰🇷)",
			icon: "Korea.png"
		},
		{
			name: "US",
			filter: "(?i)(?:美国|纽约|旧金山|洛杉矶|西雅图|芝加哥|US|USA|NEW YORK|SAN FRANCISCO|LOS ANGELES|SEATTLE|CHICAGO|🇺🇸)",
			icon: "United_States.png"
		},
		{
			name: "EU",
			filter: "(?i)(?:欧洲|德国|法国|英国|荷兰|俄罗斯|意大利|西班牙|瑞典|瑞士|波兰|芬兰|土耳其|爱尔兰|奥地利|法兰克福|伦敦|EU|DE|FR|UK|GB|NL|RU|IT|ES|SE|CH|PL|FI|TR|IE|AT|GERMANY|FRANCE|LONDON|FRANKFURT|🇪🇺|🇩🇪|🇫🇷|🇬🇧|🇳🇱|🇷🇺|🇮🇹|🇪🇸|🇸🇪|🇨🇭|🇵🇱|🇫🇮|🇹🇷|🇮🇪|🇦🇹|🇧🇪)",
			icon: "European_Union.png"
		},
		{
			name: "AU",
			filter: "(?i)(?:澳大利亚|澳洲|悉尼|墨尔本|AU|AUS|AUSTRALIA|SYDNEY|MELBOURNE|🇦🇺)",
			icon: "Australia.png"
		},
		{
			name: "AS",
			filter: "(?i)(?:越南|泰国|马来西亚|印尼|菲律宾|印度|VN|TH|MY|ID|PH|IN|VIETNAM|THAILAND|MALAYSIA|INDONESIA|PHILIPPINES|MANILA|🇻🇳|🇹🇭|🇲🇾|🇮🇩|🇵🇭|🇮🇳)",
			icon: "Asia_Map.png"
		}
	];
	/** 地区展示顺序（与 settings.ts REGION_ORDER 一致） */
	var REGION_ORDER = [
		"HK",
		"TW",
		"JP",
		"SG",
		"KR",
		"US",
		"EU",
		"AU",
		"AS"
	];
	/** 香港节点识别（AI 组需剔除香港出口） */
	var HK_FILTER = /香港|HK|HKG|HONGKONG|HONG KONG|🇭🇰/i;
	/**
	* 取正则源码，空正则返回 ""。
	* 空 RegExp 的 source 是 "(?:)"，直接拼入过滤器会匹配空串导致所有节点被排除。
	*/
	var filterSource = (re) => {
		const src = re && re.source ? String(re.source) : "";
		return !src || src === "(?:)" ? "" : src;
	};
	/**
	* 合并多个正则为一条 exclude-filter。
	* 统一包装进非捕获组 `(?i)(?:...)`，确保对全部分支生效。
	*/
	var buildExcludeFilter = (...regexps) => {
		const parts = regexps.map(filterSource).filter(Boolean);
		return parts.length ? `(?i)(?:${parts.join("|")})` : "";
	};
	/** 通用排除：机场信息类节点 + 用户自定义过滤 */
	var EXCLUDE_COMMON = buildExcludeFilter(SETTINGS.INFO_FILTER, CUSTOM_FILTER);
	/** AI 组排除：通用排除 + 香港节点 */
	var EXCLUDE_AI = buildExcludeFilter(SETTINGS.INFO_FILTER, CUSTOM_FILTER, HK_FILTER);
	/** 仅在过滤器非空时写入字段，避免下发空字符串 */
	var withExclude = (group, filter) => filter ? {
		...group,
		"exclude-filter": filter
	} : group;
	/**
	* 为 include-all 组同时设置 filter（地区白名单）和 exclude-filter（信息节点黑名单）。
	*/
	var withFilters = (group, includeFilter, excludeFilter) => {
		const result = { ...group };
		if (includeFilter) result.filter = includeFilter;
		if (excludeFilter) result["exclude-filter"] = excludeFilter;
		return result;
	};
	/**
	* include-all 组的空成员兜底（empty-fallback）。
	* 过滤后空组显式回退至 DIRECT，避免 UI 显示含混的 COMPATIBLE。
	*/
	var EMPTY_FALLBACK = { "empty-fallback": "DIRECT" };
	/**
	* 仅在用户配置了 policy-priority 时写入字段（空字符串会被内核判为非法值）。
	* smart 组按正则给节点配优先级（系数 <1 提升、>1 降低），仅对 smart 组生效。
	*/
	var withPolicyPriority = (group, policyPriority) => policyPriority.trim() ? {
		...group,
		"policy-priority": policyPriority
	} : group;
	/**
	* 根据 SmartRuleOptions 构建分流规则出口。
	* 当某个服务的开关为 false 时，该服务的流量平滑回退到 main 组。
	*/
	var buildRuleTargets = (options) => ({
		adblock: options.广告拦截 ? GROUPS.ADBLOCK : "REJECT",
		ai: options.AI ? GROUPS.AI : GROUPS.MAIN,
		google: options.Google ? GROUPS.GOOGLE : GROUPS.MAIN,
		youtube: options.YouTube ? GROUPS.YOUTUBE : GROUPS.MAIN,
		telegram: options.Telegram ? GROUPS.TELEGRAM : GROUPS.MAIN,
		steam: options.Steam ? GROUPS.STEAM : GROUPS.MAIN,
		apple: options.Apple ? GROUPS.APPLE : GROUPS.MAIN,
		microsoft: options.Microsoft ? GROUPS.MICROSOFT : GROUPS.MAIN,
		spotify: options.Spotify ? GROUPS.SPOTIFY : GROUPS.MAIN,
		proxy: GROUPS.MAIN,
		blockQuic: options.屏蔽QUIC
	});
	/**
	* 订阅是否提供了可用节点来源。
	* FlClash/Bettbox 在调用脚本前会将缺失的 proxy-providers 补成 {}，故必须判断 key 数量。
	*/
	var hasProxySource = (cfg) => {
		const proxies = Array.isArray(cfg.proxies) ? cfg.proxies : [];
		const providers = cfg["proxy-providers"];
		const providerCount = providers && typeof providers === "object" ? Object.keys(providers).length : 0;
		return proxies.length > 0 || providerCount > 0;
	};
	/**
	* 构建策略组（导出供单测直接断言）。
	*
	* include-all 的内核语义与过滤时机同 bettbox-flclash：
	* 组成员由内核在 GroupBase.GetProxies 里 filter/exclude-filter 过滤后得到，
	* 这里只声明空成员兜底与默认选中项。
	*/
	var buildSmartProxyGroups = (hasNodes, options = DEFAULT_RULE_OPTIONS, policyPriority = "") => {
		const icon = (f) => SETTINGS.ICON_BASE + f;
		const enableRegion = options.地区分组;
		/**
		* 隐藏智能选路组通用构造：smart 类型 + 内核固定 5 分钟重测
		* （不写 interval/tolerance）+ 空成员兜底 + 用户级节点优先级。
		*/
		const smartAuto = (name, iconFile) => withPolicyPriority({
			name,
			type: "smart",
			proxies: [],
			"include-all": true,
			icon: icon(iconFile),
			...SETTINGS.SMART_EXTRA,
			...EMPTY_FALLBACK
		}, policyPriority);
		if (!hasNodes) {
			const fallback = [{
				name: GROUPS.MAIN,
				type: "select",
				proxies: ["DIRECT"],
				icon: icon("Available.png")
			}, {
				name: GROUPS.ALL,
				type: "select",
				proxies: ["DIRECT"],
				icon: icon("Auto.png")
			}];
			if (options.AI) fallback.push({
				name: GROUPS.AI,
				type: "select",
				proxies: [GROUPS.MAIN],
				icon: icon("ChatGPT.png")
			});
			if (options.Google) fallback.push({
				name: GROUPS.GOOGLE,
				type: "select",
				proxies: [GROUPS.MAIN],
				icon: icon("Google_Search.png")
			});
			if (options.YouTube) fallback.push({
				name: GROUPS.YOUTUBE,
				type: "select",
				proxies: [GROUPS.MAIN],
				icon: icon("YouTube.png")
			});
			if (options.Telegram) fallback.push({
				name: GROUPS.TELEGRAM,
				type: "select",
				proxies: [GROUPS.MAIN],
				icon: icon("Telegram.png")
			});
			if (options.Steam) fallback.push({
				name: GROUPS.STEAM,
				type: "select",
				proxies: [GROUPS.MAIN, "DIRECT"],
				icon: icon("Steam.png")
			});
			if (options.Apple) fallback.push({
				name: GROUPS.APPLE,
				type: "select",
				proxies: [GROUPS.MAIN, "DIRECT"],
				icon: icon("Apple.png")
			});
			if (options.Microsoft) fallback.push({
				name: GROUPS.MICROSOFT,
				type: "select",
				proxies: [GROUPS.MAIN, "DIRECT"],
				icon: icon("Microsoft.png")
			});
			if (options.Spotify) fallback.push({
				name: GROUPS.SPOTIFY,
				type: "select",
				proxies: [GROUPS.MAIN],
				icon: icon("Spotify.png")
			});
			if (options.广告拦截) fallback.push({
				name: GROUPS.ADBLOCK,
				type: "select",
				proxies: [
					"REJECT",
					"DIRECT",
					GROUPS.MAIN
				],
				icon: icon("AdBlack.png")
			});
			fallback.push({
				name: GROUPS.GLOBAL,
				type: "select",
				proxies: [GROUPS.MAIN, "DIRECT"],
				icon: icon("Global.png")
			});
			return fallback;
		}
		const groups = [];
		groups.push(withExclude(smartAuto(`${SMART_PREFIX}All`, "Auto.png"), EXCLUDE_COMMON));
		groups.push(withExclude({
			name: GROUPS.ALL,
			type: "select",
			proxies: [`${SMART_PREFIX}All`],
			"include-all": true,
			"default-selected": `${SMART_PREFIX}All`,
			icon: icon("Auto.png")
		}, EXCLUDE_COMMON));
		const regionNames = [];
		if (enableRegion) for (const rName of REGION_ORDER) {
			const def = REGION_DEFS.find((r) => r.name === rName);
			if (!def) continue;
			groups.push(withFilters(smartAuto(`${SMART_PREFIX}${def.name}`, def.icon), def.filter, EXCLUDE_COMMON));
			groups.push(withFilters({
				name: def.name,
				type: "select",
				proxies: [`${SMART_PREFIX}${def.name}`],
				"include-all": true,
				"default-selected": `${SMART_PREFIX}${def.name}`,
				icon: icon(def.icon)
			}, def.filter, EXCLUDE_COMMON));
			regionNames.push(def.name);
		}
		if (enableRegion) {
			const allRegionPatterns = REGION_DEFS.map((r) => r.filter.replace(/^\(\?i\)\(\?:/, "").replace(/\)$/, "")).join("|");
			const otherExclude = EXCLUDE_COMMON ? `(?i)(?:${EXCLUDE_COMMON.replace(/^\(\?i\)\(\?:/, "").replace(/\)$/, "")}|${allRegionPatterns})` : `(?i)(?:${allRegionPatterns})`;
			groups.push(withExclude(smartAuto(`${SMART_PREFIX}Other`, "Available.png"), otherExclude));
			groups.push(withExclude({
				name: GROUPS.OTHER,
				type: "select",
				proxies: [`${SMART_PREFIX}Other`],
				"include-all": true,
				"default-selected": `${SMART_PREFIX}Other`,
				icon: icon("Available.png")
			}, otherExclude));
		}
		const mainProxies = [
			GROUPS.ALL,
			...regionNames,
			...enableRegion ? [GROUPS.OTHER] : []
		];
		groups.push({
			name: GROUPS.MAIN,
			type: "select",
			proxies: mainProxies,
			"default-selected": GROUPS.ALL,
			icon: icon("Available.png")
		});
		/** 服务组的 proxies 列表：main → 地区 → Other → DIRECT */
		const serviceProxies = [
			GROUPS.MAIN,
			GROUPS.ALL,
			...regionNames,
			...enableRegion ? [GROUPS.OTHER] : []
		];
		const serviceWithDirect = [...serviceProxies, "DIRECT"];
		if (options.AI) {
			groups.push(withExclude(smartAuto(`${SMART_PREFIX}AI`, "ChatGPT.png"), EXCLUDE_AI));
			const aiRegions = regionNames.filter((r) => r !== "HK");
			groups.push({
				name: GROUPS.AI,
				type: "select",
				proxies: [
					`${SMART_PREFIX}AI`,
					...aiRegions,
					GROUPS.MAIN,
					...enableRegion ? [GROUPS.OTHER] : []
				],
				"default-selected": `${SMART_PREFIX}AI`,
				icon: icon("ChatGPT.png")
			});
		}
		if (options.Google) groups.push({
			name: GROUPS.GOOGLE,
			type: "select",
			proxies: serviceProxies,
			icon: icon("Google_Search.png")
		});
		if (options.YouTube) {
			const ytProxies = options.Google ? [GROUPS.GOOGLE, ...serviceProxies] : serviceProxies;
			groups.push({
				name: GROUPS.YOUTUBE,
				type: "select",
				proxies: ytProxies,
				"default-selected": options.Google ? GROUPS.GOOGLE : GROUPS.MAIN,
				icon: icon("YouTube.png")
			});
		}
		if (options.Telegram) {
			const hasSG = regionNames.includes("SG");
			if (hasSG) groups.push({
				name: "Telegram - Fallback",
				type: "fallback",
				proxies: ["SG", GROUPS.MAIN],
				icon: icon("Telegram.png"),
				...SETTINGS.MOBILE_URL_TEST_EXTRA
			});
			groups.push({
				name: GROUPS.TELEGRAM,
				type: "select",
				proxies: [...hasSG ? ["Telegram - Fallback", "SG"] : [], ...serviceProxies],
				"default-selected": hasSG ? "Telegram - Fallback" : GROUPS.MAIN,
				icon: icon("Telegram.png")
			});
		}
		if (options.Steam) groups.push({
			name: GROUPS.STEAM,
			type: "select",
			proxies: serviceWithDirect,
			icon: icon("Steam.png")
		});
		if (options.Apple) groups.push({
			name: GROUPS.APPLE,
			type: "select",
			proxies: serviceWithDirect,
			icon: icon("Apple.png")
		});
		if (options.Microsoft) groups.push({
			name: GROUPS.MICROSOFT,
			type: "select",
			proxies: serviceWithDirect,
			icon: icon("Microsoft.png")
		});
		if (options.Spotify) groups.push({
			name: GROUPS.SPOTIFY,
			type: "select",
			proxies: serviceProxies,
			icon: icon("Spotify.png")
		});
		if (options.广告拦截) groups.push({
			name: GROUPS.ADBLOCK,
			type: "select",
			proxies: [
				"REJECT",
				"DIRECT",
				GROUPS.MAIN
			],
			icon: icon("AdBlack.png")
		});
		groups.push({
			name: GROUPS.GLOBAL,
			type: "select",
			proxies: [
				GROUPS.MAIN,
				GROUPS.ALL,
				...options.AI ? [GROUPS.AI] : [],
				...options.Google ? [GROUPS.GOOGLE] : [],
				...options.YouTube ? [GROUPS.YOUTUBE] : [],
				...options.Telegram ? [GROUPS.TELEGRAM] : [],
				...options.Steam ? [GROUPS.STEAM] : [],
				...options.Apple ? [GROUPS.APPLE] : [],
				...options.Microsoft ? [GROUPS.MICROSOFT] : [],
				...options.Spotify ? [GROUPS.SPOTIFY] : [],
				...regionNames,
				...enableRegion ? [GROUPS.OTHER] : [],
				"DIRECT"
			],
			icon: icon("Global.png")
		});
		return groups;
	};
	function smartMain(config) {
		config = config && typeof config === "object" ? config : {};
		const options = getRuleOptions();
		const originalProxies = Array.isArray(config.proxies) ? config.proxies : [];
		const existingRules = Array.isArray(config.rules) ? config.rules : [];
		delete config["geodata-mode"];
		delete config["geo-auto-update"];
		delete config["geo-update-interval"];
		delete config["geox-url"];
		const ruleTargets = buildRuleTargets(options);
		config["rule-providers"] = {
			...config["rule-providers"] || {},
			...buildRuleProviders()
		};
		config.rules = mergeRules(buildStaticRules(ruleTargets), pickDirectRules(existingRules));
		makeProxyNamesUnique(originalProxies);
		if (originalProxies.length) config.proxies = originalProxies;
		config["proxy-groups"] = buildSmartProxyGroups(hasProxySource(config), options);
		applyRuntime(config);
		applySniffer(config);
		applyTun(config);
		applyDns(config);
		return config;
	}
	//#endregion
	exports.main = smartMain;
	return exports;
})({});
// 宿主入口桥接：脚本被求值后直接调用顶层 main
// （Sparkle / Clash Verge Rev 传 (config, profileName)，FlClash 只传 config）
function main(config, profileName) {
	return __mihomoBettboxSmart.main(config, profileName);
}
