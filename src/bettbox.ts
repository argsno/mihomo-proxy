/**
 * 打包入口（Bettbox / FlClash 系列专属版）。
 * Bettbox 基于 FlClash 早期版本重构，运行时兼容 FlClash：
 *   引擎 flutter_js → QuickJS，调用形式 `main(config)` 只传 1 个参数。
 * 本版在 flclash-mobile 三组极简版基础上，扩展为完整分流策略组 +
 * 地区分组 + Bettbox 可视化开关（Compatible_With_Bettbox）适配。
 */
export { bettboxMain as main } from "./bettbox-main";
