/* =========================================================
   utils.js —— 全局命名空间与通用工具函数
   采用命名空间模式（非 ES Module），保证 file:// 直接打开可用
   ========================================================= */

(function (global) {
  "use strict";

  // 全局应用命名空间，各模块按依赖顺序挂载到 App 上
  const App = (global.App = global.App || {});

  /** 生成唯一 ID（时间戳 + 随机数，碰撞概率极低，足够本地场景使用） */
  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  /** 两数钳制 */
  function clamp(v, min, max) {
    return Math.min(max, Math.max(min, v));
  }

  /** HTML 转义，防止 XSS（用户输入渲染到 DOM 前必须转义） */
  function escapeHtml(str) {
    return String(str == null ? "" : str).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  /** 格式化时间戳为 YYYY-MM-DD HH:mm */
  function formatDateTime(ts) {
    if (!ts) return "";
    const d = new Date(ts);
    const p = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
  }

  function pad(n) { return String(n).padStart(2, "0"); }

  function fmtTime(ts) {
    if (!ts) return "";
    const d = new Date(ts);
    return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  const WEEK = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];

  function weekdayCn(ts) {
    return WEEK[new Date(ts).getDay()];
  }

  function dateLabel(ts) {
    if (!ts) return "无截止";
    const today = startOfDay(Date.now());
    const that = startOfDay(ts);
    const diff = Math.round((that - today) / 86400000);
    const d = new Date(ts);
    if (diff === 0) return "今天";
    if (diff === 1) return "明天";
    if (diff === -1) return "昨天";
    if (diff > 1 && diff <= 6) return WEEK[d.getDay()];
    return `${d.getMonth() + 1}-${pad(d.getDate())}`;
  }

  /** 计算相对剩余时间（用于死线倒计时展示） */
  function relativeDue(ts) {
    if (!ts) return null;
    const diff = ts - Date.now();
    const abs = Math.abs(diff);
    const day = Math.floor(abs / 86400000);
    const hour = Math.floor((abs % 86400000) / 3600000);
    const min = Math.floor((abs % 3600000) / 60000);
    if (day > 0) return `${day} 天 ${hour} 小时`;
    if (hour > 0) return `${hour} 小时 ${min} 分钟`;
    return `${Math.max(1, min)} 分钟`;
  }

  /** 防抖（用于搜索输入等高频事件） */
  function debounce(fn, wait) {
    let t = null;
    return function (...args) {
      clearTimeout(t);
      t = setTimeout(() => fn.apply(this, args), wait);
    };
  }

  /** 异步延时（基于 Promise，配合 async/await 演示异步编程） */
  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /** 今天零点时间戳 */
  function startOfDay(ts) {
    const d = new Date(ts);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  }

  App.utils = { uid, clamp, escapeHtml, formatDateTime, fmtTime, dateLabel, weekdayCn, relativeDue, debounce, sleep, startOfDay };
})(window);
