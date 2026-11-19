/* =========================================================
   app.js —— 应用入口：初始化全局状态、路由、时钟、提醒
   ========================================================= */

(function (global) {
  "use strict";
  const App = (global.App = global.App || {});

  const SEED_FLAG = "campus-task:seeded:v8";

  /* ---------- 全局状态与顶层 API ---------- */
  App.state = App.store.load();
  App.filters = { view: "all", category: "all", keyword: "", sort: "due-asc" };

  App.save = function () { return App.store.save(App.state); };
  App.render = function () { App.view.render(); };

  /* ---------- 主题初始化 ---------- */
  function initTheme() {
    const theme = App.store.getTheme();
    document.documentElement.setAttribute("data-theme", theme);
    document.querySelector("[data-theme-icon]").textContent = theme === "dark" ? "☀️" : "🌙";
  }

  /* ---------- 番茄钟跨天清零 ---------- */
  function refreshPomodoroDay() {
    const p = App.state.pomodoro;
    const today = new Date().toDateString();
    if (p.lastSessionDay !== today) {
      p.lastSessionDay = today;
      p.sessionsToday = 0;
      App.save();
    }
  }

  /* ---------- 今日专注跨天清零 ---------- */
  function refreshFocusDay() {
    const f = App.state.focus;
    const today = new Date().toDateString();
    if (f.date !== today) {
      f.date = today;
      f.totalMin = 0;
      f.distract = 0;
      App.save();
    }
  }

  /* ---------- 演示数据：按当前时间动态锚定 ----------
     每条示例任务记录一个相对偏移（demoOffsetH，单位小时），
     每次启动时按当前时刻重算截止时间，保证任意一天打开都满足演示统计：
     逾期 2 件 / 24 小时内 3 件 / 未来 7 天共 10 件 / 高优先级 5 件 */
  function refreshDemoDates() {
    const now = Date.now();
    let changed = false;
    App.state.tasks.forEach((t) => {
      if (typeof t.demoOffsetH !== "number") return;
      t.due = now + t.demoOffsetH * 3600000;
      changed = true;
    });
    if (changed) App.save();
  }

  function seedIfNeeded() {
    if (localStorage.getItem(SEED_FLAG)) return;
    const now = Date.now();
    const H = 3600000;
    const mk = (title, desc, category, priority, offsetH, done, agoDays, warnMin, nextAction) => ({
      id: App.utils.uid(),
      title, desc, category, priority, tags: [],
      due: now + offsetH * H,
      demoOffsetH: offsetH,
      done,
      warnMin: warnMin || 0,
      nextAction: nextAction || "",
      planned: null,
      createdAt: now - agoDays * 86400000,
      completedAt: done ? now - 2 * H : null,
      order: 0, focusMin: 0
    });

    App.state.tasks = [
      // —— 逾期 2 件（只进建议面板的「逾期未完成」）——
      mk("交实验报告", "上周的实验报告还没交", "课程", "high", -30, false, 3, 1440),
      mk("补交作业", "老师催过一次了", "课程", "high", -55, false, 2, 60),
      // —— 24 小时内截止 3 件（进今日必做）——
      mk("背单词 50 个", "每天打卡", "课程", "medium", 3, false, 0, 15),
      mk("复习操作系统第三章", "今晚把进程调度过一遍", "课程", "high", 9, false, 0, 30, "先看 20 页教材"),
      mk("整理宿舍与倒垃圾", "每周例行", "生活", "low", 21, false, 2, 0),
      // —— 未来 2~6 天 7 件（本周截止合计 10 件）——
      mk("概率论习题 3.1-3.5", "独立完成并订正", "课程", "medium", 48, false, 1, 0),
      mk("写课程设计报告初稿", "至少完成前三节", "课程", "high", 60, false, 1, 1440, "先列提纲"),
      mk("社团招新海报设计", "使用 Figma 完成初稿", "社团", "low", 72, false, 4, 0),
      mk("复习高等数学第三章", "重点：定积分与不定积分", "课程", "high", 96, false, 5, 1440),
      mk("准备英语四级词汇", "每天背 50 个单词", "课程", "medium", 108, false, 2, 0),
      mk("数据结构实验：链表与栈", "完成实验并提交报告", "课程", "low", 120, false, 3, 0),
      mk("社团例会材料整理", "整理上周活动总结", "社团", "medium", 144, false, 1, 0),
      // —— 已逾期但已完成（不计数）——
      mk("提交英语四级报名", "已提交并确认", "课程", "low", -20, true, 7, 0),
      mk("晨跑 5 公里", "坚持锻炼", "生活", "low", -4, true, 1, 0)
    ];
    App.state.tasks.forEach((t, i) => (t.order = i));

    // 示例课表：每天 3 节，保证任意一天都有课可展示
    const cls = (name, d, sh, sm, eh, em, location, teacher) => ({
      id: App.utils.uid(), name, day: d, start: sh * 60 + sm, end: eh * 60 + em, location, teacher
    });
    App.state.schedule.classes = [
      cls("高等数学", 1, 8, 0, 9, 40, "教学楼 A101", "张老师"),
      cls("大学英语", 1, 10, 10, 11, 50, "教学楼 B202", "李老师"),
      cls("Web 程序设计", 1, 14, 0, 15, 40, "机房 G303", "周老师"),
      cls("数据结构", 2, 8, 0, 9, 40, "教学楼 C301", "王老师"),
      cls("计算机组成原理", 2, 10, 10, 11, 50, "实验楼 D204", "赵老师"),
      cls("大学体育", 2, 14, 0, 15, 40, "操场", "孙老师"),
      cls("操作系统", 3, 8, 0, 9, 40, "教学楼 E105", "刘老师"),
      cls("概率论", 3, 10, 10, 11, 50, "教学楼 F302", "陈老师"),
      cls("数据库原理", 3, 14, 0, 15, 40, "机房 G303", "吴老师"),
      cls("高等数学", 4, 8, 0, 9, 40, "教学楼 A101", "张老师"),
      cls("大学英语", 4, 10, 10, 11, 50, "教学楼 B202", "李老师"),
      cls("Web 程序设计", 4, 14, 0, 15, 40, "机房 G303", "周老师"),
      cls("数据结构", 5, 8, 0, 9, 40, "教学楼 C301", "王老师"),
      cls("操作系统", 5, 10, 10, 11, 50, "教学楼 E105", "刘老师"),
      cls("软件工程", 5, 14, 0, 15, 40, "教学楼 D201", "郑老师"),
      cls("概率论", 6, 9, 0, 10, 40, "教学楼 F302", "陈老师"),
      cls("英语听力", 6, 14, 0, 15, 40, "语音室 B105", "李老师"),
      cls("创新创业讲座", 6, 16, 0, 17, 40, "报告厅", "外聘"),
      cls("高等数学", 7, 9, 0, 10, 40, "教学楼 A101", "张老师"),
      cls("数据结构", 7, 14, 0, 15, 40, "教学楼 C301", "王老师"),
      cls("自习", 7, 16, 0, 17, 40, "图书馆", "—")
    ];

    App.state.focus = { date: new Date().toDateString(), totalMin: 0, distract: 0 };

    App.save();
    localStorage.setItem(SEED_FLAG, "1");
  }

  /* ---------- 实时时钟 ---------- */
  function initClock() {
    const el = document.getElementById("clock");
    const WEEK = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
    const p = (n) => String(n).padStart(2, "0");
    function tick() {
      const d = new Date();
      el.textContent = `${d.getMonth() + 1}月${d.getDate()}日 ${WEEK[d.getDay()]} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
    }
    tick();
    setInterval(tick, 1000);
  }

  /* ---------- 预警提醒调度器：按每个任务自己设置的提前时间触发 ---------- */
  function initReminders() {
    const notified = new Set();

    function check() {
      const now = Date.now();

      App.state.tasks.forEach((t) => {
        if (t.done || notified.has(t.id)) return;
        const lead = (t.warnMin || 0) * 60000;
        if (!t.due || !lead) return;              // 未设置提醒
        const diff = t.due - now;
        if (diff > lead) return;                  // 还没到提醒窗口
        if (diff < -10 * 60000) return;           // 已过去太久，不重复提醒

        notified.add(t.id);
        const msg = `「${t.title}」${diff > 0 ? "还有 " + App.utils.relativeDue(t.due) + "到期" : "已逾期"}`;
        App.view.toast(msg);
        notify(msg);
      });
    }

    function notify(msg) {
      if ("Notification" in window && Notification.permission === "granted") {
        new Notification("课业待办提醒", { body: msg });
      }
    }

    check();
    setInterval(check, 30000);
  }

  /* ---------- 启动 ---------- */
  function bootstrap() {
    initTheme();
    refreshPomodoroDay();
    refreshFocusDay();
    seedIfNeeded();
    refreshDemoDates();
    App.view.bind();
    App.pomodoro.init();
    App.router.init();
    initClock();
    initReminders();
    App.render();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bootstrap);
  } else {
    bootstrap();
  }
})(window);
