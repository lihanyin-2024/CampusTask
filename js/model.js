/* =========================================================
   model.js —— 任务数据模型、业务逻辑与本周计划（纯函数）
   ========================================================= */

(function (global) {
  "use strict";
  const App = (global.App = global.App || {});
  const U = App.utils;

  const CATEGORIES = ["课程", "社团", "生活", "其他"];
  const PRIORITIES = { high: "高", medium: "中", low: "低" };
  const PRIORITY_WEIGHT = { high: 0, medium: 1, low: 2 };
  const DAYS = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"];

  const DAY_START = 7 * 60, DAY_END = 23 * 60, BUFFER_MIN = 30;

  // 每个任务可选的提前提醒时间
  const WARN_OPTIONS = [
    { min: 0, label: "不提醒" },
    { min: 15, label: "提前 15 分钟" },
    { min: 30, label: "提前 30 分钟" },
    { min: 60, label: "提前 1 小时" },
    { min: 180, label: "提前 3 小时" },
    { min: 1440, label: "提前 1 天" }
  ];

  const PRESETS = [
    { key: "all", label: "全部" },
    { key: "today", label: "今天截止" },
    { key: "week", label: "本周截止" },
    { key: "overdue", label: "已逾期" },
    { key: "important", label: "重要" },
    { key: "done", label: "已完成" },
    { key: "undone", label: "未完成" }
  ];

  const model = {
    CATEGORIES, PRIORITIES, DAYS, WARN_OPTIONS, DAY_START, DAY_END, BUFFER_MIN, PRESETS,

    /* ============ 任务 CRUD ============ */
    createTask(data) {
      const now = Date.now();
      return {
        id: U.uid(),
        title: String(data.title || "").trim(),
        desc: String(data.desc || "").trim(),
        category: CATEGORIES.includes(data.category) ? data.category : "其他",
        priority: PRIORITIES[data.priority] ? data.priority : "medium",
        tags: parseTags(data.tags),
        due: data.due ? new Date(data.due).getTime() : null,
        done: false,
        warnMin: parseInt(data.warnMin, 10) || 0,
        nextAction: String(data.nextAction || "").trim(),
        planned: null,
        createdAt: now,
        completedAt: null,
        order: now,
        focusMin: 0
      };
    },

    updateTask(task, data) {
      Object.assign(task, {
        title: String(data.title).trim(),
        desc: String(data.desc || "").trim(),
        category: CATEGORIES.includes(data.category) ? data.category : "其他",
        priority: PRIORITIES[data.priority] ? data.priority : "medium",
        tags: parseTags(data.tags),
        due: data.due ? new Date(data.due).getTime() : null,
        warnMin: parseInt(data.warnMin, 10) || 0,
        nextAction: String(data.nextAction || "").trim()
      });
      return task;
    },

    toggleDone(task) {
      task.done = !task.done;
      task.completedAt = task.done ? Date.now() : null;
      return task;
    },

    isOverdue(task, now) {
      const n = now || Date.now();
      return !task.done && !!task.due && task.due < n;
    },
    isDueSoon(task) {
      if (task.done || !task.due) return false;
      const diff = task.due - Date.now();
      return diff > 0 && diff < 86400000;
    },
    isDueToday(task) {
      if (task.done || !task.due) return false;
      const t0 = U.startOfDay(Date.now());
      return task.due >= t0 && task.due < t0 + 86400000;
    },
    isDueThisWeek(task) {
      if (task.done || !task.due) return false;
      const now = Date.now();
      return task.due >= now && task.due < now + 7 * 86400000;
    },

    /* ============ 查询 ============ */
    query(tasks, filters) {
      const { view = "all", category = "all", keyword = "", sort = "due-asc" } = filters || {};
      const kw = keyword.trim().toLowerCase();

      let list = tasks.filter((t) => {
        if (view === "today" && !model.isDueToday(t)) return false;
        if (view === "week" && !model.isDueThisWeek(t)) return false;
        if (view === "overdue" && !model.isOverdue(t)) return false;
        if (view === "done" && !t.done) return false;
        if (view === "undone" && t.done) return false;
        if (view === "important" && (t.done || t.priority !== "high")) return false;
        if (view !== "all" && view !== "done" && t.done) return false;

        if (category !== "all" && t.category !== category) return false;
        if (kw) {
          const hay = (t.title + " " + t.desc + " " + t.tags.join(" ")).toLowerCase();
          if (!hay.includes(kw)) return false;
        }
        return true;
      });

      const sorters = {
        "due-asc": (a, b) => (a.due || Infinity) - (b.due || Infinity),
        "due-desc": (a, b) => (b.due || -Infinity) - (a.due || -Infinity),
        priority: (a, b) => PRIORITY_WEIGHT[a.priority] - PRIORITY_WEIGHT[b.priority] || (a.due || Infinity) - (b.due || Infinity),
        "created-desc": (a, b) => (b.createdAt || 0) - (a.createdAt || 0),
        order: (a, b) => (a.order || 0) - (b.order || 0)
      };
      list.sort(sorters[sort] || sorters["due-asc"]);
      return list;
    },

    computeStats(tasks) {
      const total = tasks.length;
      const done = tasks.filter((t) => t.done).length;
      const overdue = tasks.filter((t) => model.isOverdue(t)).length;
      const pending = total - done;
      const rate = total ? Math.round((done / total) * 100) : 0;
      return { total, done, pending, overdue, rate };
    },

    /* ============ 时间管理 ============ */
    minToStr(min) {
      const p = (n) => String(n).padStart(2, "0");
      return `${p(Math.floor(min / 60))}:${p(min % 60)}`;
    },
    strToMin(str) {
      if (!str) return 0;
      const [h, m] = str.split(":").map(Number);
      return (h || 0) * 60 + (m || 0);
    },

    /** 本周周一的零点时间戳（课程按自然周对齐时可用） */
    startOfWeek(now) {
      const d = new Date(now);
      const diff = (d.getDay() + 6) % 7;
      return U.startOfDay(now) - diff * 86400000;
    },

    /** 未来 7 天（从今天起），返回 { ts, dayIdx, label, isToday }；dayIdx 为该天对应的星期（1=周一…7=周日） */
    weekDays(now) {
      const start = U.startOfDay(now);
      const out = [];
      for (let i = 0; i < 7; i++) {
        const ts = start + i * 86400000;
        const d = new Date(ts);
        const dayIdx = ((d.getDay() + 6) % 7) + 1;
        out.push({
          ts,
          dayIdx,
          label: `${d.getMonth() + 1}/${d.getDate()} ${DAYS[dayIdx - 1]}`,
          isToday: i === 0
        });
      }
      return out;
    },

    /** 时间戳 → 当日分钟数（0~1440） */
    minutesOfDay(ts) {
      const d = new Date(ts);
      return d.getHours() * 60 + d.getMinutes();
    },

    /** 某一天的占用区间（课程 + 已计划任务），分钟坐标，按开始时间排序 */
    dayBusy(now, dayIdx) {
      const day = model.weekDays(now).find((w) => w.dayIdx === dayIdx);
      const busy = [];
      App.state.schedule.classes.forEach((c) => { if (c.day === dayIdx) busy.push({ start: c.start, end: c.end, type: "class" }); });
      App.state.tasks.forEach((t) => {
        if (!t.planned) return;
        const s = t.planned.start, e = t.planned.end;
        if (!day || s < day.ts || s >= day.ts + 86400000) return;
        busy.push({ start: model.minutesOfDay(s), end: model.minutesOfDay(e), type: "task" });
      });
      busy.sort((a, b) => a.start - b.start);
      return busy;
    },

    /** 某一天的空闲区间（除去占用后剩余的 07:00~23:00 时间） */
    dayFree(now, dayIdx) {
      const busy = model.dayBusy(now, dayIdx);
      const free = [];
      let cur = DAY_START;
      busy.forEach((b) => {
        const s = Math.max(DAY_START, b.start);
        const e = Math.min(DAY_END, b.end);
        if (e <= s) return;
        if (s > cur) free.push({ start: cur, end: s });
        cur = Math.max(cur, e);
      });
      if (cur < DAY_END) free.push({ start: cur, end: DAY_END });
      return free;
    },

    /** 给空闲区间施加「任务 ↔ 课程」之间 30 分钟缓冲，返回仍可用的区间 */
    applyBuffer(free, busy) {
      return free
        .map((f) => {
          let s = f.start, e = f.end;
          if (busy.some((b) => b.type === "class" && b.end === f.start)) s += BUFFER_MIN;
          if (busy.some((b) => b.type === "class" && b.start === f.end)) e -= BUFFER_MIN;
          return { start: s, end: e };
        })
        .filter((f) => f.end - f.start > 0);
    },

    /** 单个空闲块的可用范围（已扣除与课程相邻的缓冲）；完全被缓冲占用时返回 null */
    slotUsable(now, dayIdx, start, end) {
      const busy = model.dayBusy(now, dayIdx);
      const usable = model.applyBuffer([{ start, end }], busy);
      return usable.length ? usable[0] : null;
    },

    /* ============ 今日一屏 ============ */
    /** 今日课表结构：课程 + 碎片(<2h) + 空闲(≥2h)，只考虑课程与缓冲，不显示休息/任务 */
    todayTimeline(now) {
      const dayIdx = ((new Date(now).getDay() + 6) % 7) + 1;
      const buf = App.state.settings.bufferMin || 30;
      const classes = App.state.schedule.classes.filter((c) => c.day === dayIdx).sort((a, b) => a.start - b.start);
      const blocks = classes.map((c) => ({
        type: "class", start: c.start, end: c.end, name: c.name, location: c.location, id: c.id
      }));
      const busy = classes.map((c) => ({ start: c.start - buf, end: c.end + buf })).sort((a, b) => a.start - b.start);
      const merged = [];
      busy.forEach((b) => {
        const s = Math.max(DAY_START, b.start), e = Math.min(DAY_END, b.end);
        if (e <= s) return;
        const last = merged[merged.length - 1];
        if (last && s <= last.end) last.end = Math.max(last.end, e);
        else merged.push({ start: s, end: e });
      });
      let cur = DAY_START;
      merged.forEach((b) => {
        if (b.start > cur) blocks.push(this._gapBlock(cur, b.start));
        cur = Math.max(cur, b.end);
      });
      if (cur < DAY_END) blocks.push(this._gapBlock(cur, DAY_END));
      blocks.sort((a, b) => a.start - b.start);
      return blocks;
    },

    _gapBlock(start, end) {
      const dur = end - start;
      return { type: dur >= 120 ? "free" : "fragment", start, end, duration: dur };
    },

    /** 今日必做：24 小时内截止的任务（已过期置顶），已完成单独统计 */
    todayTasks(now) {
      const deadline = now + 86400000;
      // 今日必做只含 24 小时内截止的任务，不含已逾期
      const undone = App.state.tasks
        .filter((t) => !t.done && t.due && t.due >= now && t.due < deadline)
        .sort((a, b) => a.due - b.due);
      const dayAgo = now - 86400000;
      const done = App.state.tasks
        .filter((t) => t.done && (t.completedAt || 0) >= dayAgo)
        .sort((a, b) => (b.completedAt || 0) - (a.completedAt || 0));
      // 逾期任务单独统计，不进入今日必做，仅在建议面板中呈现
      const overdue = App.state.tasks
        .filter((t) => !t.done && t.due && t.due < now)
        .sort((a, b) => a.due - b.due);
      return { overdue, undone, done, all: undone, total: undone.length, doneCount: done.length };
    },

    /** 建议任务：逾期未完成置顶 + 建议（未来一天内截止、或长期未动） */
    suggestions(now) {
      const tomorrow = now + 86400000;
      // 逾期：已过截止时间且未完成
      const overdue = App.state.tasks
        .filter((t) => !t.done && t.due && t.due < now)
        .sort((a, b) => a.due - b.due);
      // 建议：24 小时以后才截止的任务，或创建超过 3 天仍未完成的无截止任务
      const suggest = App.state.tasks.filter((t) => {
        if (t.done) return false;
        if (t.due && t.due < tomorrow) return false;          // 已在必做或逾期里
        if (t.due) return true;                               // 未来任务
        return now - (t.createdAt || now) > 3 * 86400000;     // 无截止且搁置已久
      });
      return { overdue, suggest };
    },

    postponeTomorrow(task) { task.due = U.startOfDay(Date.now()) + 86400000 + 23 * 3600000 + 59 * 60000; },
    moveThisWeek(task) { task.due = U.startOfDay(Date.now()) + 6 * 86400000 + 23 * 3600000 + 59 * 60000; },

    /**
     * 「现在做什么」：分层排序
     *   第一层：24 小时内截止（最优先）
     *   第二层：已逾期
     *   第三层：其他任务
     * 层内按「截止时间升序 → 优先级」排列
     * 返回 [{ task, score, reason }]
     */
    rankNowTasks(now) {
      const deadline = now + 86400000;
      const pending = App.state.tasks.filter((t) => !t.done);
      const curFree = model.currentFreeBlock(now);
      const W = PRIORITY_WEIGHT;

      // 所属层：0 = 24 小时内截止，1 = 已逾期，2 = 其他
      const tierOf = (t) => {
        if (t.due == null) return 2;
        if (t.due >= now && t.due < deadline) return 0;
        if (t.due < now) return 1;
        return 2;
      };

      const scored = pending.map((t) => {
        const tier = tierOf(t);
        const hours = t.due != null ? (t.due - now) / 3600000 : null;
        const reasons = [];

        if (tier === 0) {
          reasons.push(hours < 1 ? "不到 1 小时截止" : `${Math.round(hours)} 小时内截止`);
        } else if (tier === 1) {
          const d = Math.floor((now - t.due) / 86400000);
          reasons.push(d >= 1 ? `已逾期 ${d} 天` : "刚刚逾期");
        } else if (t.due != null) {
          reasons.push(U.dateLabel(t.due) + "截止");
        } else {
          reasons.push("无截止时间");
        }

        if (t.priority === "high") reasons.push("高优先级");
        else if (t.priority === "low") reasons.push("低优先级");

        const idleDays = Math.floor((now - (t.createdAt || now)) / 86400000);
        if (tier === 2 && idleDays >= 5) reasons.push(`放了 ${idleDays} 天没动`);

        return { task: t, tier, reasons };
      });

      // 层内：截止时间升序（无截止排最后）→ 优先级 → 创建时间
      scored.sort((a, b) =>
        a.tier - b.tier ||
        (a.task.due == null ? Infinity : a.task.due) - (b.task.due == null ? Infinity : b.task.due) ||
        W[a.task.priority] - W[b.task.priority] ||
        (a.task.createdAt || 0) - (b.task.createdAt || 0)
      );

      return scored.map((s) => ({
        task: s.task,
        tier: s.tier,
        score: 3 - s.tier,
        reason: s.reasons.slice(0, 2).join("，") || (curFree ? "现在有空，适合推进" : "抽空推进一下")
      }));
    },

    /** 当前时刻所处的空闲块（基于今日课表结构）；不在空闲块内返回 null */
    currentFreeBlock(now) {
      const m = new Date(now).getHours() * 60 + new Date(now).getMinutes();
      return model.todayTimeline(now).find((b) => b.type === "free" && m >= b.start && m < b.end) || null;
    },

    /**
     * 自然语言快速解析：
     * 「明天下午3点交实验报告 高优先」→ { title, due, priority }
     */
    parseQuickInput(text, now) {
      const src = String(text || "").trim();
      if (!src) return null;
      let rest = src;
      const t0 = U.startOfDay(now);
      const cur = new Date(now);
      const todayIdx = ((cur.getDay() + 6) % 7) + 1;   // 1=周一 … 7=周日
      let day = null;
      let eveningHint = false;                          // 「今晚 / 明晚」暗示晚间

      // ---- 日期 ----
      // 相对日
      const rel = [
        [/大后天/, 3], [/后天/, 2], [/明天|明日|明早|明晚/, 1], [/今天|今日|今晚|今早/, 0]
      ];
      for (const [re, offset] of rel) {
        const m = rest.match(re);
        if (m) {
          day = t0 + offset * 86400000;
          if (/晚/.test(m[0])) eveningHint = true;
          rest = rest.replace(m[0], "");
          break;
        }
      }
      // 「下周三」「周五」「星期三」
      if (day == null) {
        const wm = rest.match(/(下)?(?:周|星期)([一二三四五六日天])(?:之?前)?/);
        if (wm) {
          const idx = "一二三四五六日".indexOf(wm[2].replace("天", "日")) + 1;
          let diff = idx - todayIdx;
          if (wm[1]) diff += 7;                 // 下周
          else if (diff < 0) diff += 7;         // 本周已过则取下周
          day = t0 + diff * 86400000;
          rest = rest.replace(wm[0], "");
        }
      }

      // ---- 时间：下午3点 / 15:30 / 晚上8点 ----
      let hh = null, mm = 0;
      const tm = rest.match(/(上午|早上|早晨|中午|下午|傍晚|晚上|晚)?\s*(\d{1,2})\s*[:：点时]\s*(\d{1,2})?\s*分?/);
      if (tm) {
        hh = parseInt(tm[2], 10);
        mm = tm[3] ? parseInt(tm[3], 10) : 0;
        const seg = tm[1] || "";
        if (/下午|傍晚|晚上|晚/.test(seg) && hh < 12) { hh += 12; eveningHint = true; }
        else if (seg === "中午" && hh < 11) hh += 12;
        else if (eveningHint && hh < 12) hh += 12;   // 「今晚8点」
        rest = rest.replace(tm[0], "");
      } else if (eveningHint) {
        hh = 20;                                     // 只说了「今晚」没说时间
      }

      // ---- 优先级 ----
      let priority = null;
      if (/高优先|紧急|重要|加急/.test(rest)) { priority = "high"; rest = rest.replace(/高优先[级]?|紧急|重要|加急/g, ""); }
      else if (/低优先/.test(rest)) { priority = "low"; rest = rest.replace(/低优先[级]?/g, ""); }
      else if (/中优先/.test(rest)) { priority = "medium"; rest = rest.replace(/中优先[级]?/g, ""); }

      const title = rest.replace(/\s+/g, " ").replace(/^[，,。\s]+|[，,。\s]+$/g, "").trim();
      if (!title) return null;

      // ---- 计算截止时间 ----
      let due = null;
      if (hh != null) {
        const base = day != null ? day : (hh > cur.getHours() ? t0 : t0 + 86400000);
        due = base + hh * 3600000 + mm * 60000;
      } else if (day != null) {
        due = day + 23 * 3600000 + 59 * 60000;
      }

      return { title, due, priority: priority || "medium" };
    },

    warnLabel(min) {
      if (!min) return "";
      if (min < 60) return min + " 分钟前";
      if (min < 1440) return Math.round(min / 60) + " 小时前";
      return Math.round(min / 1440) + " 天前";
    },

    formatFocus(totalMin) {
      if (!totalMin) return "0min";
      if (totalMin < 60) return `${totalMin}min`;
      const h = Math.floor(totalMin / 60), m = totalMin % 60;
      return m ? `${h}.${Math.round(m / 6)}h` : `${h}h`;
    },

    recordFocus(min, taskId, distract) {
      const f = App.state.focus;
      f.totalMin += min;
      if (distract) f.distract += distract;
      if (taskId) {
        const t = App.state.tasks.find((x) => x.id === taskId);
        if (t) t.focusMin = (t.focusMin || 0) + min;
      }
    }
  };

  function parseTags(str) {
    if (Array.isArray(str)) return [...new Set(str.map((s) => String(s).trim()).filter(Boolean))];
    return [...new Set(String(str || "").split(/[,，]/).map((s) => s.trim()).filter(Boolean))];
  }

  App.model = model;
})(window);
