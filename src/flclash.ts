/**
 * 打包入口（FlClash 手机端）：仅导出 main。
 * FlClash 以 `{脚本}\nmain({配置JSON})` 求值（lib/common/javascript.dart），
 * 引擎为 flutter_js → QuickJS，调用时只传 1 个参数。
 * 与 Sparkle 的桥接方式一致：IIFE 打包 + footer 注入顶层 main。
 */
export { flclashMain as main } from "./flclash-main";
