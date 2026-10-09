/**
 * 打包入口（Bettbox Smart 版）：仅导出 main。
 * Bettbox / FlClash 以 `{脚本}\nmain({配置JSON})` 求值（lib/common/javascript.dart），
 * 引擎为 flutter_qjs → QuickJS，调用时只传 1 个参数。
 * 与 flclash-mobile 的桥接方式一致：IIFE 打包 + footer 注入顶层 main。
 */
export { smartMain as main } from "./smart-main";
