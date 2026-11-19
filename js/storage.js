/* =========================================================
   storage.js —— 数据持久化层
   基于 localStorage 的统一存取，带版本号与数据校验/迁移能力
   ========================================================= */

(function (global) {
  "use strict";
  const App = (global.App = global.App || {});

  const STORAGE_KEY = "campus-task:v2";
  const THEME_KEY = "campus-task:theme";

  /** 默认数据结构（含 schema 版本，便于日后迁移） */
  function defaultState() {
    return {
      version: 3,
      tasks: [],
      pomodoro: {
        focusMin: 25,
        breakMin: 5,
        sessionsToday: 0,
        totalMinutes: 0,
        lastSessionDay: null
      },
      // 课程表（day: 1=周一 … 7=周日；start/end 为分钟数 0-1440）
      schedule: {
        classes: []   // { id, name, day, start, end, location, teacher }
      },
      settings: {
        bufferMin: 30,       // 今日课表课程前后缓冲（分钟）
        todayLimit: 5        // 今日必做显示上限
      },
      focus: { date: null, totalMin: 0, distract: 0 }  // 今日专注统计
    };
  }

  /** 数据校验：确保读取到的对象结构合法，并做旧版本字段迁移 */
  function sanitize(raw) {
    const base = defaultState();
    if (!raw || typeof raw !== "object") return base;
    const out = { ...base, ...raw };
    if (!Array.isArray(out.tasks)) out.tasks = [];
    out.tasks = out.tasks
      .filter((t) => t && typeof t.id === "string")
      .map((t) => ({
        id: t.id,
        title: String(t.title || ""),
        desc: String(t.desc || ""),
        category: ["课程", "社团", "生活", "其他"].includes(t.category) ? t.category : "其他",
        priority: ["high", "medium", "low"].includes(t.priority) ? t.priority : "medium",
        tags: Array.isArray(t.tags) ? t.tags.map(String) : [],
        due: typeof t.due === "number" ? t.due : null,
        done: !!t.done,
        // 每个任务独立的提前提醒分钟数；0 = 不提醒。旧数据「严重」标记迁移为提前 1 天
        warnMin: typeof t.warnMin === "number" ? t.warnMin : (t.critical ? 1440 : 0),
        nextAction: String(t.nextAction || ""),
        planned: t.planned && t.planned.start ? t.planned : null,
        createdAt: typeof t.createdAt === "number" ? t.createdAt : Date.now(),
        completedAt: typeof t.completedAt === "number" ? t.completedAt : null,
        order: typeof t.order === "number" ? t.order : 0,
        demoOffsetH: typeof t.demoOffsetH === "number" ? t.demoOffsetH : null,
        focusMin: typeof t.focusMin === "number" ? t.focusMin : 0
      }));
    if (!out.pomodoro || typeof out.pomodoro !== "object") out.pomodoro = base.pomodoro;
    if (!out.schedule || typeof out.schedule !== "object") out.schedule = base.schedule;
    if (!Array.isArray(out.schedule.classes)) out.schedule.classes = [];
    out.schedule.classes = out.schedule.classes.map((c) => ({
      id: c.id, name: String(c.name || ""), day: c.day, start: c.start, end: c.end,
      location: String(c.location || ""), teacher: String(c.teacher || "")
    }));
    if (!out.settings || typeof out.settings !== "object") out.settings = base.settings;
    if (typeof out.settings.bufferMin !== "number") out.settings.bufferMin = base.settings.bufferMin;
    if (typeof out.settings.todayLimit !== "number") out.settings.todayLimit = base.settings.todayLimit;
    if (!out.focus || typeof out.focus !== "object") out.focus = base.focus;
    return out;
  }

  const store = {
    load() {
      try {
        const text = localStorage.getItem(STORAGE_KEY);
        if (!text) return defaultState();
        return sanitize(JSON.parse(text));
      } catch (e) {
        console.warn("状态解析失败，已重置为默认值", e);
        return defaultState();
      }
    },

    save(state) {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
        return true;
      } catch (e) {
        console.error("保存失败：localStorage 可能已满", e);
        return false;
      }
    },

    /* ---- 主题偏好 ---- */
    getTheme() {
      const t = localStorage.getItem(THEME_KEY);
      return t === "dark" || t === "light" ? t : "light";
    },
    setTheme(theme) {
      localStorage.setItem(THEME_KEY, theme);
    }
  };

  App.store = store;
})(window);
