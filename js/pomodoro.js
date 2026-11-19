/* =========================================================
   pomodoro.js —— 番茄钟
   关键设计：基于 Date.now() 时间戳计时（而非累计 setInterval），
   即使浏览器后台节流定时器，剩余时间依然精确无漂移。
   附带 Web Audio 提示音与浏览器通知。
   ========================================================= */

(function (global) {
  "use strict";
  const App = (global.App = global.App || {});
  const CIRCUMFERENCE = 2 * Math.PI * 52; // SVG 半径 52

  const pomodoro = {
    mode: "focus",     // focus | break
    running: false,
    endTime: null,     // 结束时间戳
    remainMs: 0,       // 暂停时的剩余毫秒
    timer: null,

    /** 初始化：从持久化状态恢复并渲染 */
    init() {
      this.remainMs = this._durationMs();
      const input = document.getElementById("pomodoro-focus-min");
      if (input) input.value = App.state.pomodoro.focusMin;
      this._render();
      this._bind();
    },

    _durationMs() {
      const p = App.state.pomodoro;
      return (this.mode === "focus" ? p.focusMin : p.breakMin) * 60000;
    },

    /** 开始 / 暂停 */
    toggle() {
      if (this.running) {
        this.pause();
      } else {
        this.start();
      }
    },

    start() {
      if (this.running) return;
      this.running = true;
      this.endTime = Date.now() + this.remainMs;
      this.timer = setInterval(() => this._tick(), 250);
      this._render();
    },

    pause() {
      if (!this.running) return;
      this.running = false;
      this.remainMs = Math.max(0, this.endTime - Date.now());
      clearInterval(this.timer);
      this._render();
    },

    reset() {
      this.running = false;
      clearInterval(this.timer);
      this.remainMs = this._durationMs();
      this._render();
    },

    /** 核心计时：剩余时间始终由结束时间戳反推，杜绝漂移 */
    _tick() {
      const remain = this.endTime - Date.now();
      if (remain <= 0) {
        this.remainMs = 0;
        this._complete();
      } else {
        this.remainMs = remain;
      }
      this._render();
    },

    /** 一轮结束：切换专注/休息，累计统计，提示 */
    _complete() {
      this.running = false;
      clearInterval(this.timer);

      const p = App.state.pomodoro;
      if (this.mode === "focus") {
        p.sessionsToday += 1;
        p.totalMinutes += p.focusMin;
        this.mode = "break";
        this._beep();
        this._notify("🎉 专注完成！休息一下吧", `已完成 ${p.focusMin} 分钟专注`);
      } else {
        this.mode = "focus";
        this._beep();
        this._notify("⏰ 休息结束，继续加油", "开始下一轮专注");
      }
      this.remainMs = this._durationMs();
      App.save();
      App.render();
    },

    /** Web Audio 播放提示音 */
    _beep() {
      try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        const play = (freq, start, dur) => {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.type = "sine";
          osc.frequency.value = freq;
          gain.gain.setValueAtTime(0.001, ctx.currentTime + start);
          gain.gain.exponentialRampToValueAtTime(0.3, ctx.currentTime + start + 0.02);
          gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + start + dur);
          osc.connect(gain).connect(ctx.destination);
          osc.start(ctx.currentTime + start);
          osc.stop(ctx.currentTime + start + dur + 0.05);
        };
        play(880, 0, 0.18);
        play(1108.7, 0.22, 0.3);
      } catch (e) { /* 忽略音频异常 */ }
    },

    /** 浏览器通知（需用户授权） */
    _notify(title, body) {
      if ("Notification" in window && Notification.permission === "granted") {
        new Notification(title, { body });
      }
    },

    /** 渲染时间、进度环、统计 */
    _render() {
      const p = App.state.pomodoro;
      const total = this._durationMs();
      const remain = Math.max(0, this.remainMs);
      const sec = Math.ceil(remain / 1000);
      const mm = String(Math.floor(sec / 60)).padStart(2, "0");
      const ss = String(sec % 60).padStart(2, "0");

      const timeEl = document.getElementById("pomodoro-time");
      const modeEl = document.getElementById("pomodoro-mode");
      const progEl = document.getElementById("pomodoro-progress");
      const toggleBtn = document.getElementById("pomodoro-toggle");

      if (timeEl) timeEl.textContent = `${mm}:${ss}`;
      if (modeEl) {
        modeEl.textContent = this.mode === "focus" ? "专注中" : "休息中";
        modeEl.style.color = this.mode === "focus" ? "var(--brand)" : "var(--ok)";
      }
      if (progEl) {
        const progress = total ? (total - remain) / total : 0;
        progEl.style.strokeDasharray = String(CIRCUMFERENCE);
        progEl.style.strokeDashoffset = String(CIRCUMFERENCE * (1 - progress));
        progEl.style.stroke = this.mode === "focus" ? "var(--brand)" : "var(--ok)";
      }
      if (toggleBtn) {
        toggleBtn.textContent = this.running ? "暂停" : (this.remainMs < total ? "继续" : "开始");
      }

      const sEl = document.getElementById("pomodoro-sessions");
      const mEl = document.getElementById("pomodoro-minutes");
      if (sEl) sEl.textContent = p.sessionsToday;
      if (mEl) mEl.textContent = p.totalMinutes;
    },

    _bind() {
      document.getElementById("pomodoro-toggle").addEventListener("click", () => this.toggle());
      document.getElementById("pomodoro-reset").addEventListener("click", () => this.reset());
      document.getElementById("pomodoro-apply").addEventListener("click", () => this._applyDuration());
    },

    /** 自定义专注时长 */
    _applyDuration() {
      const input = document.getElementById("pomodoro-focus-min");
      let min = parseInt(input.value, 10);
      if (!min || min < 1) min = 25;
      min = Math.min(180, min);
      App.state.pomodoro.focusMin = min;
      input.value = min;
      this.mode = "focus";
      this.running = false;
      clearInterval(this.timer);
      this.remainMs = this._durationMs();
      App.save();
      this._render();
      App.view.toast(`专注时长已设为 ${min} 分钟`);
    }
  };

  App.pomodoro = pomodoro;
})(window);
