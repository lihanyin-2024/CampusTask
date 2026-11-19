/* =========================================================
   view.js —— 视图层：表格清单、批量管理、预设视图、专注、今日一屏
   ========================================================= */

(function (global) {
  "use strict";
  const App = (global.App = global.App || {});
  const U = App.utils;
  const M = App.model;

  const PRIORITY_LABEL = { high: "高", medium: "中", low: "低" };
  const CLASS_COLORS = ["#16a34a", "#22c55e", "#0ea5e9", "#f59e0b", "#10b981", "#84cc16", "#14b8a6", "#4ade80"];
  const VIEW_EMPTY = {
    all: "还没有任务，点击右下角「＋」添加一条吧",
    today: "今天没有截止的任务",
    week: "未来 7 天内没有截止的任务",
    overdue: "没有逾期任务，太棒了！",
    important: "没有标记为「重要」的任务",
    done: "还没有已完成的任务",
    undone: "所有任务都已完成 🎉"
  };
  let toastTimer = null;

  const view = {
    _quoteLoaded: false,
    batchMode: false,
    selected: new Set(),

    // 今日一屏状态
    todayPanel: "main",   // main | suggest | quit
    suggestSelected: new Set(),
    quitChoices: {},
    quitSummary: null,
    editingId: null,
    expandedToday: false,
    showDone: false,
    suggestOffset: 0,
    nowIndex: 0,

    /* ============ 顶层渲染 ============ */
    render() {
      this.renderStats();
      this.renderViews();
      this.renderTasks();
      if (App.pomodoro && App.pomodoro._render) App.pomodoro._render();
    },

    renderStats() {
      const s = M.computeStats(App.state.tasks);
      document.getElementById("stat-total").textContent = s.total;
      document.getElementById("stat-done").textContent = s.done;
      document.getElementById("stat-pending").textContent = s.pending;
      document.getElementById("stat-overdue").textContent = s.overdue;
    },

    renderViews() {
      M.PRESETS.forEach((p) => {
        const n = M.query(App.state.tasks, { view: p.key, category: "all" }).length;
        const el = document.querySelector(`[data-count="${p.key}"]`);
        if (el) el.textContent = n;
      });
      document.querySelectorAll(".view-item").forEach((b) =>
        b.classList.toggle("view-item--active", b.dataset.view === App.filters.view)
      );
    },

    /* ============ 任务表格（清单页） ============ */
    renderTasks() {
      const tbody = document.getElementById("task-list");
      const emptyEl = document.getElementById("empty-state");
      document.getElementById("th-select").hidden = !this.batchMode;

      const list = M.query(App.state.tasks, App.filters);
      tbody.innerHTML = list.map((t) => this._taskRowHTML(t)).join("");
      emptyEl.hidden = list.length !== 0;
      document.getElementById("empty-text").textContent = VIEW_EMPTY[App.filters.view] || VIEW_EMPTY.all;
      if (this.batchMode) this._updateBatchUI();
    },

    _taskRowHTML(t) {
      const selCell = this.batchMode
        ? `<td class="col-sel"><input type="checkbox" class="task-select" data-id="${t.id}" ${this.selected.has(t.id) ? "checked" : ""} /></td>`
        : "";

      let dueBadge = "";
      if (t.due) {
        let cls = "badge--due";
        let label = U.formatDateTime(t.due);
        if (!t.done) {
          if (M.isOverdue(t)) { cls = "badge--due--overdue"; label = "已逾期 " + U.relativeDue(t.due); }
          else if (M.isDueSoon(t)) { cls = "badge--due--soon"; label = "剩 " + U.relativeDue(t.due); }
        }
        dueBadge = `<span class="badge ${cls}">${label}</span>`;
      }

      const warn = t.warnMin ? `<span class="badge badge--warn">🔔 ${M.warnLabel(t.warnMin)}</span>` : "";
      const tags = (t.tags || []).map((tag) => `<span class="badge badge--tag">#${U.escapeHtml(tag)}</span>`).join(" ");

      return `
        <tr class="task${t.done ? " task--done" : ""}" data-id="${t.id}">
          ${selCell}
          <td class="col-check">
            <button class="task__check" data-action="toggle" title="${t.done ? "标记为未完成" : "标记为完成"}">
              <svg viewBox="0 0 24 24"><path fill="none" stroke="currentColor" stroke-width="3" d="M5 13l4 4L19 7"/></svg>
            </button>
          </td>
          <td class="col-title">
            <div class="task__title">${U.escapeHtml(t.title)}</div>
            ${t.desc ? `<div class="task__desc">${U.escapeHtml(t.desc)}</div>` : ""}
          </td>
          <td><span class="badge badge--cat">${U.escapeHtml(t.category)}</span></td>
          <td><span class="badge badge--${t.priority}">${PRIORITY_LABEL[t.priority]}</span>${warn}</td>
          <td class="col-due">${dueBadge}</td>
          <td class="col-tags">${tags || "—"}</td>
          <td class="col-actions">
            <button class="act" data-action="edit" title="编辑">✎</button>
            <button class="act act-del" data-action="delete" title="删除">🗑</button>
          </td>
        </tr>`;
    },

    /* ============ 专注页 / 每日一言 ============ */
    renderFocus() {
      if (!this._quoteLoaded) this._loadQuote();
    },

    async _getQuotes() {
      const fallback = [
        { text: "自律给我自由。", author: "佚名" },
        { text: "把复杂的事情简单做，你就是专家。", author: "佚名" },
        { text: "今天的努力，是明天幸运的伏笔。", author: "佚名" },
        { text: "种一棵树最好的时间是十年前，其次是现在。", author: "非洲谚语" },
        { text: "循序渐进，方得始终。", author: "佚名" },
        { text: "不积跬步，无以至千里。", author: "荀子" },
        { text: "业精于勤，荒于嬉。", author: "韩愈" }
      ];
      try {
        const res = await fetch("data/quotes.json");
        if (res.ok) return await res.json();
      } catch (e) { /* file:// 环境降级 */ }
      return fallback;
    },

    async _loadQuote() {
      const textEl = document.getElementById("quote-text");
      const authorEl = document.getElementById("quote-author");
      if (!textEl) return;
      this._quoteLoaded = true;

      const quotes = await this._getQuotes();
      const today = new Date().toISOString().slice(0, 10);
      let idx;
      try {
        const raw = localStorage.getItem("campus-task:quote");
        if (raw) { const o = JSON.parse(raw); if (o.date === today) idx = o.index; }
      } catch (e) { /* ignore */ }
      if (idx == null) {
        idx = Math.floor(Math.random() * quotes.length);
        localStorage.setItem("campus-task:quote", JSON.stringify({ date: today, index: idx }));
      }
      const q = quotes[idx % quotes.length];
      textEl.textContent = "“" + q.text + "”";
      authorEl.textContent = "—— " + q.author;
    },

    /* ============ 今日一屏 ============ */
    renderPlan() {
      this.renderHero();
      this.renderTodaySchedule();
      this.renderNow();
      this.renderTodayTasks();
      this.renderTodayFooter();
      this.renderClasses();
      this._renderTodayModal();
    },

    /** 「现在做什么」：自动推荐一个任务，给一句人话理由 */
    renderNow() {
      const el = document.getElementById("now-card");
      if (!el) return;
      const list = M.rankNowTasks(Date.now());
      if (!list.length) { el.innerHTML = ""; el.hidden = true; return; }
      el.hidden = false;
      const idx = this.nowIndex % list.length;
      const pick = list[idx];
      const t = pick.task;
      el.innerHTML = `
        <div class="now__label">▶ 现在做</div>
        <div class="now__title">${U.escapeHtml(t.nextAction || t.title)}</div>
        <div class="now__reason">${U.escapeHtml(pick.reason)}</div>
        <div class="now__actions">
          <button class="btn btn--primary btn--sm" data-act="now-start" data-id="${t.id}">开始专注</button>
          <button class="btn btn--sm" data-act="now-shuffle">换一个</button>
        </div>`;
    },

    renderHero() {
      const now = Date.now();
      const h = new Date(now).getHours();
      const hello = h < 6 ? "夜深了" : h < 11 ? "早上好" : h < 14 ? "中午好" : h < 18 ? "下午好" : h < 23 ? "晚上好" : "夜深了";
      const el1 = document.getElementById("hero-hello");
      const el2 = document.getElementById("hero-date");
      const el3 = document.getElementById("hero-tip");
      if (!el1) return;
      el1.textContent = hello + "，今天也要好好安排 🌿";
      el2.textContent = `${new Date(now).getFullYear()} 年 ${new Date(now).getMonth() + 1} 月 ${new Date(now).getDate()} 日 · ${U.weekdayCn(now)}`;
      const t = M.todayTasks(now);
      const cls = M.todayTimeline(now);
      const freeCount = cls.filter((b) => b.type === "free").length;
      const classesCount = cls.filter((b) => b.type === "class").length;
      let tip;
      if (!t.total) tip = "24 小时内没有要截止的任务，放松一下 ☕";
      else if (t.overdue.length) tip = `${t.total} 件待办 · ${t.overdue.length} 件已逾期`;
      else tip = `${t.total} 件待办 · 今日 ${classesCount} 节课 · ${freeCount} 段空闲`;
      el3.textContent = tip;
    },

    renderTodaySchedule() {
      const el = document.getElementById("today-schedule");
      if (!el) return;
      const now = Date.now();
      const blocks = M.todayTimeline(now);
      const sum = document.getElementById("sched-summary");
      if (sum) {
        const nClass = blocks.filter((b) => b.type === "class").length;
        const nFree = blocks.filter((b) => b.type === "free").length;
        const freeMin = blocks.filter((b) => b.type === "free").reduce((s, b) => s + b.duration, 0);
        sum.innerHTML = `<span>📘 ${nClass} 节课</span><span>🌿 ${nFree} 段空闲 · ${this._dur(freeMin)}</span>`;
      }
      if (!blocks.length) { el.innerHTML = `<div class="empty">今天没有课，全天空闲</div>`; return; }
      let colorIdx = 0;
      const colorOf = () => CLASS_COLORS[colorIdx++ % CLASS_COLORS.length];
      el.innerHTML = blocks.map((b) => {
        if (b.type === "class") {
          return `<div class="sched sched--class" style="background:${colorOf()}">
            <div class="sched__time">${M.minToStr(b.start)}–${M.minToStr(b.end)}</div>
            <div class="sched__name">${U.escapeHtml(b.name)}${b.location ? " · " + U.escapeHtml(b.location) : ""}</div>
          </div>`;
        }
        if (b.type === "fragment") {
          return `<div class="sched sched--frag">
            <div class="sched__time">${M.minToStr(b.start)}</div>
            <div class="sched__name">碎片 ${b.duration}min</div>
          </div>`;
        }
        return `<div class="sched sched--free">
          <div class="sched__time">${M.minToStr(b.start)}</div>
          <div class="sched__name">空闲 ${this._dur(b.duration)}</div>
        </div>`;
      }).join("");
    },

    _dur(min) {
      const h = Math.floor(min / 60), m = min % 60;
      return h ? `${h}h${m ? m + "m" : ""}` : `${m}m`;
    },

    renderTodayTasks() {
      const el = document.getElementById("today-tasks");
      if (!el) return;
      const now = Date.now();
      const t = M.todayTasks(now);

      if (!t.all.length) {
        const hasOverdue = t.overdue.length > 0;
        if (t.doneCount > 0) {
          // 今天的任务刚刚全部完成
          el.innerHTML = `
            <div class="card__title">今日必做 <span class="card__sub">24 小时内截止</span></div>
            <div class="empty">
              <p class="done-line">✅ 今天 ${t.doneCount} 件全部完成</p>
              <button class="btn btn--primary" data-act="suggest">看看还有什么可以推进</button>
              <button class="fold-btn" data-act="toggle-done">${this.showDone ? "▴ 收起" : "▾ 查看"}已完成的 ${t.doneCount} 件</button>
            </div>
            ${this.showDone ? `<div class="task-list">${t.done.map((x) => this._todayTaskRow(x, false)).join("")}</div>` : ""}`;
        } else {
          el.innerHTML = `
            <div class="card__title">今日必做 <span class="card__sub">24 小时内截止</span></div>
            <div class="empty">
              <p>24 小时内没有要截止的任务</p>
              <input class="quick-add" placeholder="输入任务，回车添加（默认今天截止）…" />
              ${hasOverdue ? `<p class="muted" style="margin-top:10px">另有 ${t.overdue.length} 件任务已逾期</p>
              <button class="btn btn--ghost" data-act="suggest" style="margin-top:6px">查看逾期与建议</button>` : ""}
            </div>`;
        }
        this._maybeOpenSuggest(t);
        return;
      }

      const limit = App.state.settings.todayLimit || 5;
      const show = (t.all.length <= limit || this.expandedToday) ? t.all : t.all.slice(0, limit);
      const hidden = t.all.length - show.length;
      const listHTML = show.map((x) => this._todayTaskRow(x, false)).join("");
      const doneHTML = this.showDone ? t.done.map((x) => this._todayTaskRow(x, false)).join("") : "";

      el.innerHTML = `
        <div class="card__title">今日必做 <span class="card__sub">24 小时内截止</span> <b class="count">${t.total} 件</b></div>
        <input class="quick-add quick-add--inline" placeholder="＋ 快速添加（试试：明天下午3点交报告 高优先）" />
        <div class="task-list">
          ${listHTML}
          ${hidden > 0 ? `<button class="fold-btn" data-act="expand">▾ 还有 ${hidden} 件</button>` : ""}
        </div>
        ${t.doneCount > 0 ? `<button class="fold-btn done-fold" data-act="toggle-done">${this.showDone ? "▴ 收起已完成" : "▾ 已完成 " + t.doneCount + " 件"}</button>` : ""}
        ${doneHTML ? `<div class="task-list">${doneHTML}</div>` : ""}
        <div class="today-tasks__foot">
          <button class="btn btn--ghost" data-act="suggest">从全部任务中挑选</button>
        </div>`;
      this._maybeOpenSuggest(t);
    },

    /**
     * 今日必做完成（从有到无）时，自动弹出建议面板
     * 只在状态发生转变时触发一次，避免每次渲染都弹
     */
    _maybeOpenSuggest(t) {
      const hasUrgent = t.undone.length > 0;
      if (this._hadUrgent === undefined) { this._hadUrgent = hasUrgent; return; }
      if (this._hadUrgent && !hasUrgent && this.todayPanel === "main") {
        this._hadUrgent = false;
        setTimeout(() => this._openSuggest(), 260);
        return;
      }
      this._hadUrgent = hasUrgent;
    },

    _todayTaskRow(t, isOverdue) {
      const dueText = isOverdue ? U.relativeDue(t.due) : (t.due ? this._dueText(t.due) : "无截止");
      const metaCls = isOverdue ? "meta--overdue" : (t.due && M.isDueToday(t, Date.now()) ? "meta--today" : "meta--normal");
      const editor = this.editingId === t.id ? this._editorHTML(t) : "";
      return `
        <div class="task ${t.done ? "is-done" : ""}" data-id="${t.id}">
          <div class="task__row">
            <button class="check" data-act="toggle" data-id="${t.id}">${t.done ? "✓" : ""}</button>
            <div class="task__info" data-act="edit" data-id="${t.id}">
              <div class="task__title">${U.escapeHtml(t.title)}</div>
              ${t.nextAction ? `<div class="task__next">→ ${U.escapeHtml(t.nextAction)}</div>` : ""}
              <div class="task__meta ${metaCls}">${isOverdue ? "⚠ " : ""}${dueText} · ${PRIORITY_LABEL[t.priority]}${t.warnMin ? " · 🔔" : ""}</div>
            </div>
          </div>
          ${editor}
        </div>`;
    },

    _dueText(due) {
      const today = U.startOfDay(Date.now());
      const diff = Math.round((U.startOfDay(due) - today) / 86400000);
      const tm = U.fmtTime(due);
      if (diff === 0) return "今天" + (tm !== "23:59" ? " " + tm : "");
      if (diff === 1) return "明天 " + tm;
      return `${U.dateLabel(due)} ${tm}`;
    },

    _editorHTML(t) {
      return `<div class="task-editor">
        <label>优先级 <select data-edit-pri data-id="${t.id}">
          ${["high", "medium", "low"].map((p) => `<option value="${p}" ${t.priority === p ? "selected" : ""}>${PRIORITY_LABEL[p]}</option>`).join("")}
        </select></label>
        <label>截止 <select data-edit-due data-id="${t.id}">
          <option value="today" ${M.isDueToday(t, Date.now()) ? "selected" : ""}>今天</option>
          <option value="tomorrow" ${this._isDueNDay(t.due, 1) ? "selected" : ""}>明天</option>
          <option value="week" ${this._isDueNDay(t.due, 2) || this._isDueNDay(t.due, 3) ? "selected" : ""}>本周</option>
          <option value="none" ${!t.due ? "selected" : ""}>无截止</option>
        </select></label>
        <button class="btn btn--sm" data-act="editor-done" data-id="${t.id}">完成</button>
        <button class="btn btn--sm btn--danger" data-act="del" data-id="${t.id}">删除</button>
      </div>`;
    },

    _isDueNDay(due, n) {
      if (!due) return false;
      const today = U.startOfDay(Date.now());
      return U.startOfDay(due) === today + n * 86400000;
    },

    _suggestReason(task) {
      if (task.due && this._isDueNDay(task.due, 1)) return "明天有课，提前过一遍更轻松";
      if (!task.due) return `放了 ${Math.max(1, Math.floor((Date.now() - task.createdAt) / 86400000))} 天没动，趁现在清掉`;
      return U.dateLabel(task.due) + "截止，提前准备";
    },

    renderTodayFooter() {
      const el = document.getElementById("today-footer");
      if (!el) return;
      el.innerHTML = `<button class="btn btn--primary" data-act="quit">今日收工</button>`;
    },

    renderClasses() {
      const listEl = document.getElementById("class-list");
      if (!listEl) return;
      const arr = App.state.schedule.classes.slice().sort((a, b) => a.day - b.day || a.start - b.start);
      listEl.innerHTML = arr.length
        ? arr.map((c) => `<li>
            <span class="plan-item__main">${U.escapeHtml(c.name)}</span>
            <span class="plan-item__sub">${U.escapeHtml(c.location || "未填地点")} · ${U.escapeHtml(c.teacher || "未填老师")}</span>
            <span class="plan-item__time">${M.DAYS[c.day - 1]} ${M.minToStr(c.start)}-${M.minToStr(c.end)}</span>
            <button class="act act-del" data-act="del-class" data-id="${c.id}">✕</button>
          </li>`).join("")
        : `<li class="plan-empty">暂无课程，先添加课程。</li>`;
    },

    /* ============ 今日一屏模态（建议 / 收工） ============ */
    _renderTodayModal() {
      const mask = document.getElementById("today-modal");
      const body = document.getElementById("today-modal-body");
      if (!mask) return;
      if (this.todayPanel === "suggest") { mask.hidden = false; body.innerHTML = this._suggestHTML(); return; }
      if (this.todayPanel === "quit") { mask.hidden = false; body.innerHTML = this._quitHTML(); return; }
      mask.hidden = true;
    },

    _suggestHTML() {
      const s = M.suggestions(Date.now());
      const item = (t, tag) => `
        <label class="suggest-item">
          <input type="checkbox" data-act="suggest-pick" data-id="${t.id}" ${this.suggestSelected.has(t.id) ? "checked" : ""} />
          <span class="suggest-item__title">${U.escapeHtml(t.title)}</span>
          <span class="suggest-item__meta">${tag}</span>
        </label>`;
      const overdue = s.overdue.map((t) => item(t, U.relativeDue(t.due) + " · " + PRIORITY_LABEL[t.priority])).join("");
      const suggest = s.suggest.map((t) => item(t, this._suggestReason(t))).join("");
      return `
        <div class="modal__head">挑选建议任务<button class="icon-btn" data-act="close">✕</button></div>
        <div class="suggest-body">
          ${s.overdue.length ? `<div class="suggest-group">⚠ 逾期未完成</div>${overdue}` : ""}
          ${s.suggest.length ? `<div class="suggest-group">建议</div>${suggest}` : ""}
          ${!s.overdue.length && !s.suggest.length ? `<p class="empty">暂时没有建议任务</p>` : ""}
        </div>
        <div class="modal__foot">
          <button class="btn btn--primary" data-act="join-today">加入今日</button>
          <button class="btn" data-act="close">关闭</button>
        </div>`;
    },

    _quitHTML() {
      const now = Date.now();
      const t = M.todayTasks(now);
      const left = [...t.overdue, ...t.undone];
      this.quitChoices = this.quitChoices || {};
      left.forEach((x) => { if (!this.quitChoices[x.id]) this.quitChoices[x.id] = "tomorrow"; });
      const f = App.state.focus;
      const rows = left.map((x) => {
        const over = M.isOverdue(x, now);
        return `<div class="quit-item">
          <div class="quit-item__title">${over ? "⚠ " : ""}${U.escapeHtml(x.title)}<span class="muted">${over ? "（逾期" + U.relativeDue(x.due).replace("逾期", "") + "）" : "（今天截止）"}</span></div>
          <div class="quit-item__opts">
            ${["tomorrow", "week", "discard"].map((k) => `
              <label><input type="radio" name="q-${x.id}" value="${k}" data-act="quit-choice" data-id="${x.id}" ${this.quitChoices[x.id] === k ? "checked" : ""} />${k === "tomorrow" ? "顺延到明天" : k === "week" ? "移到本周" : "放弃"}</label>
            `).join("")}
          </div>
        </div>`;
      }).join("");
      return `
        <div class="modal__head">今天到此为止</div>
        <div class="quit-summary">完成 ${t.doneCount} 件</div>
        ${left.length ? `<div class="quit-left">逾期 ${t.overdue.length} 件 · 未完成 ${t.undone.length} 件，怎么处理？</div><div class="quit-list">${rows}</div>` : ""}
        <div class="modal__foot">
          <button class="btn btn--primary" data-act="confirm-quit">确认收工</button>
          <button class="btn" data-act="close">再想想</button>
        </div>`;
    },

    _quitDoneHTML() {
      const now = Date.now();
      const q = this.quitSummary || { done: 0, focus: 0 };
      const t0 = U.startOfDay(now);
      const tomorrow = t0 + 86400000;
      const tomorrowCount = App.state.tasks.filter((x) => !x.done && x.due && x.due >= tomorrow && x.due < tomorrow + 86400000).length;
      const d = new Date(now);
      return `
        <div class="focus focus--done">
          <div class="focus__label">${d.getMonth() + 1}月${d.getDate()}日 ${U.weekdayCn(now)}</div>
          <div class="focus__task">今天到此为止</div>
          <div class="focus__sub">完成 ${q.done} 件</div>
          <div class="focus__sub">明天还有 ${tomorrowCount} 件待办</div>
          <div class="focus__actions focus__actions--col">
            <button class="btn btn--primary" data-act="quit-rest">现在歇着</button>
            <button class="btn" data-act="quit-tomorrow">再看一眼明天</button>
          </div>
        </div>`;
    },

    /* ============ 弹窗 ============ */
    openModal(task) {
      document.getElementById("modal-title").textContent = task ? "编辑任务" : "新建任务";
      document.getElementById("f-id").value = task ? task.id : "";
      document.getElementById("f-title").value = task ? task.title : "";
      document.getElementById("f-desc").value = task ? task.desc : "";
      document.getElementById("f-category").value = task ? task.category : "课程";
      document.getElementById("f-priority").value = task ? task.priority : "medium";
      document.getElementById("f-warn").value = String(task ? task.warnMin || 0 : 0);
      document.getElementById("f-next").value = task ? task.nextAction || "" : "";
      document.getElementById("f-tags").value = task ? (task.tags || []).join(", ") : "";
      document.getElementById("f-due").value = task && task.due ? toLocalInput(task.due) : "";
      document.getElementById("modal").hidden = false;
      setTimeout(() => document.getElementById("f-title").focus(), 50);
    },

    closeModal() {
      document.getElementById("modal").hidden = true;
      document.getElementById("task-form").reset();
    },

    _showDetail(title, bodyHTML) {
      document.getElementById("detail-title").textContent = title;
      document.getElementById("detail-body").innerHTML = bodyHTML;
      document.getElementById("detail-modal").hidden = false;
    },
    _closeDetail() { document.getElementById("detail-modal").hidden = true; },

    _taskDetailHTML(t) {
      return `
        <div class="detail-row"><span>标题</span><b>${U.escapeHtml(t.title)}</b></div>
        ${t.desc ? `<div class="detail-row"><span>描述</span><b>${U.escapeHtml(t.desc)}</b></div>` : ""}
        <div class="detail-row"><span>分类</span><b>${U.escapeHtml(t.category)}</b></div>
        <div class="detail-row"><span>优先级</span><b>${PRIORITY_LABEL[t.priority]}</b></div>
        <div class="detail-row"><span>截止时间</span><b>${t.due ? U.formatDateTime(t.due) : "无"}</b></div>
        <div class="detail-row"><span>提前提醒</span><b>${t.warnMin ? M.warnLabel(t.warnMin) : "不提醒"}</b></div>
        ${t.nextAction ? `<div class="detail-row"><span>下一步</span><b>${U.escapeHtml(t.nextAction)}</b></div>` : ""}
        <div class="detail-row"><span>标签</span><b>${(t.tags || []).length ? t.tags.map((x) => U.escapeHtml(x)).join("、") : "无"}</b></div>`;
    },

    toast(msg) {
      const el = document.getElementById("toast");
      el.textContent = msg;
      el.classList.add("toast--show");
      clearTimeout(toastTimer);
      toastTimer = setTimeout(() => el.classList.remove("toast--show"), 2400);
    },

    /* ============ 事件绑定 ============ */
    bind() {
      const $ = (id) => document.getElementById(id);

      // 弹窗
      $("btn-add").addEventListener("click", () => this.openModal());
      $("modal-close").addEventListener("click", () => this.closeModal());
      $("modal-cancel").addEventListener("click", () => this.closeModal());
      $("modal").addEventListener("click", (e) => { if (e.target.id === "modal") this.closeModal(); });
      $("task-form").addEventListener("submit", (e) => this._onSubmit(e));

      // 详情弹窗
      $("detail-close").addEventListener("click", () => this._closeDetail());
      $("detail-done").addEventListener("click", () => this._closeDetail());
      $("detail-modal").addEventListener("click", (e) => { if (e.target.id === "detail-modal") this._closeDetail(); });

      // 任务表格（事件委托）
      $("task-list").addEventListener("click", (e) => this._onTaskClick(e));

      // 预设视图
      $("view-presets").addEventListener("click", (e) => {
        const b = e.target.closest(".view-item");
        if (!b) return;
        App.filters.view = b.dataset.view;
        this.renderViews();
        this.renderTasks();
      });

      // 分类 / 排序 / 搜索
      $("filter-category").addEventListener("change", (e) => { App.filters.category = e.target.value; this.renderTasks(); });
      $("sort-select").addEventListener("change", (e) => { App.filters.sort = e.target.value; this.renderTasks(); });
      const searchInput = $("search-input");
      searchInput.addEventListener("input", U.debounce(() => { App.filters.keyword = searchInput.value; this.renderTasks(); }, 200));

      // 批量管理
      $("btn-batch").addEventListener("click", () => (this.batchMode ? this._exitBatch() : this._enterBatch()));
      $("select-all").addEventListener("change", (e) => this._onSelectAll(e));
      $("batch-all").addEventListener("click", () => this._onSelectAll(null, true));
      $("batch-done").addEventListener("click", () => this._onBatchDone());
      $("batch-delete").addEventListener("click", () => this._onBatchDelete());
      $("batch-exit").addEventListener("click", () => this._exitBatch());
      $("btn-clear-done").addEventListener("click", () => this._onClearDone());

      // 主题
      $("btn-theme").addEventListener("click", () => this._toggleTheme());

      // 课程表
      $("class-form").addEventListener("submit", (e) => this._onClassSubmit(e));
      $("class-list").addEventListener("click", (e) => this._onClassListDel(e));

      // 今日一屏：统一委托到 document（处理 data-act）
      document.addEventListener("click", (e) => this._onTodayClick(e));
      document.addEventListener("change", (e) => this._onTodayChange(e));
      document.addEventListener("keydown", (e) => this._onTodayQuickAdd(e));

      // 今日一屏模态遮罩
      $("today-modal").addEventListener("click", (e) => { if (e.target.id === "today-modal") this._closeTodayModal(); });

      // 移动端抽屉
      $("hamburger").addEventListener("click", () => this._toggleDrawer(true));
      $("backdrop").addEventListener("click", () => this._toggleDrawer(false));
      $("nav").addEventListener("click", () => this._toggleDrawer(false));

      if ("Notification" in window && Notification.permission === "default") {
        Notification.requestPermission();
      }
    },

    _toggleDrawer(open) {
      document.body.classList.toggle("drawer-open", open);
      document.getElementById("backdrop").hidden = !open;
    },

    /* ============ 清单页事件 ============ */
    _onSubmit(e) {
      e.preventDefault();
      const id = document.getElementById("f-id").value;
      const title = document.getElementById("f-title").value.trim();
      if (!title) { this.toast("请填写任务标题"); document.getElementById("f-title").focus(); return; }

      const data = {
        title,
        desc: document.getElementById("f-desc").value,
        category: document.getElementById("f-category").value,
        priority: document.getElementById("f-priority").value,
        tags: document.getElementById("f-tags").value,
        due: document.getElementById("f-due").value,
        warnMin: document.getElementById("f-warn").value,
        nextAction: document.getElementById("f-next").value
      };

      if (id) {
        const t = App.state.tasks.find((x) => x.id === id);
        if (t) M.updateTask(t, data);
        this.toast("已更新任务");
      } else {
        App.state.tasks.push(M.createTask(data));
        this.toast("已添加任务");
      }
      this.closeModal();
      App.save();
      this.render();
    },

    _onTaskClick(e) {
      const tr = e.target.closest("tr.task");
      if (!tr) return;
      const id = tr.dataset.id;
      const t = App.state.tasks.find((x) => x.id === id);
      if (!t) return;

      if (this.batchMode) { this._toggleSelect(id); return; }

      const btn = e.target.closest("button[data-action]");
      if (!btn) return;
      switch (btn.dataset.action) {
        case "toggle":
          M.toggleDone(t);
          this.toast(t.done ? "已完成 ✅" : "已恢复为进行中");
          break;
        case "edit":
          this.openModal(t);
          return;
        case "delete":
          App.state.tasks = App.state.tasks.filter((x) => x.id !== id);
          this.toast("已删除任务");
          break;
      }
      App.save();
      this.render();
    },

    /* ---- 批量 ---- */
    _enterBatch() {
      this.batchMode = true;
      this.selected = new Set();
      document.getElementById("th-select").hidden = false;
      document.getElementById("batch-bar").hidden = false;
      document.getElementById("btn-batch").textContent = "退出批量";
      this.renderTasks();
    },
    _exitBatch() {
      this.batchMode = false;
      this.selected = new Set();
      document.getElementById("th-select").hidden = true;
      document.getElementById("batch-bar").hidden = true;
      document.getElementById("btn-batch").textContent = "批量管理";
      document.getElementById("select-all").checked = false;
      this.renderTasks();
    },
    _toggleSelect(id) {
      this.selected.has(id) ? this.selected.delete(id) : this.selected.add(id);
      this._updateBatchUI();
    },
    _updateBatchUI() {
      document.getElementById("batch-count").textContent = this.selected.size;
      document.querySelectorAll("tr.task").forEach((tr) => {
        const id = tr.dataset.id;
        const on = this.selected.has(id);
        tr.classList.toggle("selected", on);
        const cb = tr.querySelector(".task-select");
        if (cb) cb.checked = on;
      });
    },
    _onSelectAll(e, forceAll) {
      const list = M.query(App.state.tasks, App.filters);
      const all = forceAll ? true : e.target.checked;
      if (all) list.forEach((t) => this.selected.add(t.id));
      else list.forEach((t) => this.selected.delete(t.id));
      this._updateBatchUI();
    },
    _onBatchDone() {
      App.state.tasks.forEach((t) => { if (this.selected.has(t.id) && !t.done) M.toggleDone(t); });
      App.save(); this._exitBatch(); this.render(); this.toast("已批量标记完成");
    },
    _onBatchDelete() {
      const n = this.selected.size;
      if (!n) { this.toast("请先勾选任务"); return; }
      if (!confirm(`确定删除选中的 ${n} 项任务？`)) return;
      App.state.tasks = App.state.tasks.filter((t) => !this.selected.has(t.id));
      App.save(); this._exitBatch(); this.render(); this.toast(`已删除 ${n} 项任务`);
    },
    _onClearDone() {
      const done = App.state.tasks.filter((t) => t.done);
      if (!done.length) { this.toast("没有已完成的任务"); return; }
      if (!confirm(`确定清除全部 ${done.length} 项已完成任务？`)) return;
      App.state.tasks = App.state.tasks.filter((t) => !t.done);
      App.save(); this.render(); this.toast(`已清除 ${done.length} 项已完成任务`);
    },

    /* ---- 课程表 ---- */
    _onClassSubmit(e) {
      e.preventDefault();
      const name = document.getElementById("cls-name").value.trim();
      const start = M.strToMin(document.getElementById("cls-start").value);
      const end = M.strToMin(document.getElementById("cls-end").value);
      if (!name) { this.toast("请输入课程名称"); return; }
      if (end <= start) { this.toast("结束时间需晚于开始时间"); return; }
      App.state.schedule.classes.push({
        id: U.uid(), name,
        day: +document.getElementById("cls-day").value,
        start, end,
        location: document.getElementById("cls-location").value.trim(),
        teacher: document.getElementById("cls-teacher").value.trim()
      });
      document.getElementById("cls-name").value = "";
      document.getElementById("cls-location").value = "";
      document.getElementById("cls-teacher").value = "";
      App.save(); this.renderPlan(); this.toast("已添加课程");
    },
    _onClassListDel(e) {
      const btn = e.target.closest('button[data-act="del-class"]');
      if (!btn) return;
      App.state.schedule.classes = App.state.schedule.classes.filter((x) => x.id !== btn.dataset.id);
      App.save(); this.renderPlan();
    },

    /* ============ 今日一屏事件 ============ */
    _onTodayClick(e) {
      const el = e.target.closest("[data-act]");
      if (!el) return;
      const act = el.dataset.act;
      const id = el.dataset.id;

      if (act === "toggle") { this._todayToggle(id); return; }
      if (act === "toggle-done") { this.showDone = !this.showDone; this.renderPlan(); return; }
      if (act === "now-start") {
        const t = App.state.tasks.find((x) => x.id === id);
        App.router.go("focus");
        this.toast(t ? `开始专注：${t.title}` : "开始专注");
        return;
      }
      if (act === "now-shuffle") { this.nowIndex += 1; this.renderNow(); return; }
      if (act === "edit") { this.editingId = this.editingId === id ? null : id; this.renderPlan(); return; }
      if (act === "expand") { this.expandedToday = true; this.renderPlan(); return; }
      if (act === "del") { this._todayDelete(id); return; }
      if (act === "editor-done") { this._todayDone(id); return; }
      if (act === "quit") { this._openQuit(); return; }
      if (act === "all") { App.router.go("home"); return; }
      if (act === "suggest") { this._openSuggest(); return; }
      if (act === "suggest-shuffle") { this.suggestOffset += 3; this.renderPlan(); return; }
      if (act === "del-class") return;
      if (act === "close") { this._closeTodayModal(); return; }
      if (act === "suggest-pick") {
        this.suggestSelected.has(id) ? this.suggestSelected.delete(id) : this.suggestSelected.add(id);
        return;
      }
      if (act === "join-today") { this._joinToday(); return; }
      if (act === "quit-choice") { this.quitChoices[id] = el.value; this.renderPlan(); return; }
      if (act === "confirm-quit") { this._confirmQuit(); return; }
      if (act === "quit-rest") { this._closeTodayModal(); return; }
      if (act === "quit-tomorrow") { this._closeTodayModal(); App.router.go("home"); return; }
    },

    _onTodayChange(e) {
      const el = e.target.closest("[data-edit-pri], [data-edit-due]");
      if (!el) return;
      const id = el.dataset.id;
      const t = App.state.tasks.find((x) => x.id === id);
      if (!t) return;
      if (el.dataset.editPri !== undefined) { t.priority = el.value; }
      else { this._applyDue(t, el.value); }
      App.save();
      this.renderPlan();
    },

    _applyDue(t, val) {
      const t0 = U.startOfDay(Date.now());
      if (val === "today") t.due = t0 + 23 * 3600000 + 59 * 60000;
      else if (val === "tomorrow") t.due = t0 + 86400000 + 23 * 3600000 + 59 * 60000;
      else if (val === "week") t.due = t0 + 6 * 86400000 + 23 * 3600000 + 59 * 60000;
      else t.due = null;
    },

    _onTodayQuickAdd(e) {
      if (e.key !== "Enter") return;
      const el = e.target;
      if (!el.classList || !el.classList.contains("quick-add")) return;
      const raw = el.value.trim();
      if (!raw) return;
      const now = Date.now();
      // 自然语言解析：明天下午3点交实验报告 高优先
      const parsed = M.parseQuickInput(raw, now);
      if (!parsed) return;
      const t0 = U.startOfDay(now);
      App.state.tasks.push(M.createTask({
        title: parsed.title,
        due: parsed.due || (t0 + 23 * 3600000 + 59 * 60000),
        priority: parsed.priority
      }));
      el.value = "";
      App.save();
      this.renderPlan();
      this.toast(`已添加「${parsed.title}」`);
    },

    _todayToggle(id) {
      const t = App.state.tasks.find((x) => x.id === id);
      if (t) M.toggleDone(t);
      App.save(); this.render();
      if (App.router._last === "plan") this.renderPlan();
    },

    _todayDone(id) {
      const t = App.state.tasks.find((x) => x.id === id);
      if (t && !t.done) M.toggleDone(t);
      this.editingId = null;
      App.save(); this.renderPlan();
    },

    _todayDelete(id) {
      const t = App.state.tasks.find((x) => x.id === id);
      App.state.tasks = App.state.tasks.filter((x) => x.id !== id);
      App.save(); this.renderPlan();
      this.toast(`已删除「${t ? t.title : ""}」`);
    },

    _openSuggest() {
      this.suggestSelected = new Set();
      this.todayPanel = "suggest";
      this._renderTodayModal();
    },

    _joinToday() {
      const t0 = U.startOfDay(Date.now());
      this.suggestSelected.forEach((tid) => {
        const t = App.state.tasks.find((x) => x.id === tid);
        if (t) t.due = t0 + 23 * 3600000 + 59 * 60000;
      });
      this.suggestSelected.clear();
      App.save();
      this._closeTodayModal();
    },

    _openQuit() {
      this.quitChoices = {};
      this.todayPanel = "quit";
      this._renderTodayModal();
    },

    _confirmQuit() {
      const now = Date.now();
      const t = M.todayTasks(now);
      this.quitSummary = { done: t.doneCount, focus: App.state.focus.totalMin };
      const left = [...t.overdue, ...t.undone];
      left.forEach((x) => {
        const c = this.quitChoices[x.id] || "tomorrow";
        if (c === "tomorrow") M.postponeTomorrow(x);
        else if (c === "week") M.moveThisWeek(x);
        else App.state.tasks = App.state.tasks.filter((y) => y.id !== x.id);
      });
      this.quitChoices = {};
      App.save();
      const body = document.getElementById("today-modal-body");
      body.innerHTML = this._quitDoneHTML();
    },

    _closeTodayModal() {
      this.todayPanel = "main";
      const mask = document.getElementById("today-modal");
      if (mask) mask.hidden = true;
      this.renderPlan();
    },

    /* ---- 主题 ---- */
    _toggleTheme() {
      const root = document.documentElement;
      const next = root.getAttribute("data-theme") === "dark" ? "light" : "dark";
      root.setAttribute("data-theme", next);
      document.querySelector("[data-theme-icon]").textContent = next === "dark" ? "☀️" : "🌙";
      App.store.setTheme(next);
    }
  };

  function toLocalInput(ts) {
    const d = new Date(ts);
    const p = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
  }

  App.view = view;
})(window);
