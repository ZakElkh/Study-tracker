class StudyTracker {
  constructor() {
    this.subjects = ['Maths', 'Physics', 'Chemistry', 'English'];
    this.defaultSubjectGoal = 5; // hours per subject per day
    this.subjectGoal = 5;
    this.notificationsEnabled = false;
    this.reminderTime = '09:00';
    this.reminderEmailEnabled = false;
    this.emailjs = { service: 'service_4bzpy4p', template: '', user: '', to: '' };
    this.pomodoroSettings = { work: 25, short: 5, long: 15 };
    this.theme = { accent: '#3d7bfd', accentHover: '#2563eb' };
    this.timerColors = { text: '#ffffff', bg: '#000000' };
    
    // In-memory session state (not persisted across page reloads)
    this.activeTimers = {};
    
    // Pomodoro state
    this.pomodoro = {
      running: false,
      phase: 'work', // work | short | long
      remainingMs: 0,
      elapsedMs: 0, // actual elapsed time in current phase
      interval: null
    };
    
    this.loadData();
    this.setupEventListeners();
    this.initializeUI();
    
    // Set a tick timer for running timers
    this.tickInterval = setInterval(() => this.updateRunningTimers(), 1000);
    
    // Check if day changed (between sessions)
    this.checkDayRollover();
    
    // Schedule notifications
    this.scheduleNotifications();
    
    // Init EmailJS
    this.initEmailJS();
    
    // Apply saved theme
    this.applyTheme();
  }

  applyTheme() {
    const root = document.documentElement;
    const accent = this.theme.accent;
    root.style.setProperty('--accent', accent);
    root.style.setProperty('--accent-hover', this.theme.accentHover);
    
    // Build a full palette derived from the accent color
    const c = this.hexToRgb(accent);
    const isDarkBg = this.isDark(accent);
    
    // Darken the accent into deep backgrounds (tinted dark mode)
    const bgPrimary = this.mix(accent, '#000000', 0.85);   // mostly black, slight accent tint
    const bgSecondary = this.mix(accent, '#000000', 0.75);
    const bgCard = this.mix(accent, '#000000', 0.70);
    const border = this.mix(accent, '#000000', 0.55);
    
    // Readable text: light text on the dark tinted backgrounds (these are always dark-ish here)
    const textPrimary = '#f5f6fa';
    const textSecondary = 'rgba(245,246,250,0.65)';
    
    root.style.setProperty('--bg-primary', bgPrimary);
    root.style.setProperty('--bg-secondary', bgSecondary);
    root.style.setProperty('--bg-card', bgCard);
    root.style.setProperty('--border', border);
    root.style.setProperty('--progress-bg', this.mix(accent, '#000000', 0.55));
    root.style.setProperty('--text-primary', textPrimary);
    root.style.setProperty('--text-secondary', textSecondary);
    
    // If the accent is very light, darken the hover more for contrast on the accent-colored elements
    if (!isDarkBg) {
      root.style.setProperty('--accent-hover', this.darken(accent, 20));
    }
  }

  hexToRgb(hex) {
    const c = hex.replace('#', '');
    return {
      r: parseInt(c.substring(0,2), 16),
      g: parseInt(c.substring(2,4), 16),
      b: parseInt(c.substring(4,6), 16)
    };
  }

  // Mix two colors: mixAmount 0 = color2 only, 1 = color1 only
  mix(hex1, hex2, mixAmount) {
    const a = this.hexToRgb(hex1);
    const b = this.hexToRgb(hex2);
    const r = Math.round(a.r * mixAmount + b.r * (1 - mixAmount));
    const g = Math.round(a.g * mixAmount + b.g * (1 - mixAmount));
    const bl = Math.round(a.b * mixAmount + b.b * (1 - mixAmount));
    const pad = n => Math.max(0, Math.min(255, n)).toString(16).padStart(2, '0');
    return `#${pad(r)}${pad(g)}${pad(bl)}`;
  }

  applyTimerColors() {
    const overlay = document.getElementById('fullscreen-overlay');
    if (!overlay) return;
    overlay.style.background = this.timerColors.bg;
    overlay.style.color = this.timerColors.text;
    const display = document.getElementById('fs-display');
    const subject = document.getElementById('fs-subject');
    const pom = document.getElementById('fs-pomodoro');
    if (display) display.style.color = this.timerColors.text;
    if (subject) subject.style.color = this.timerColors.text;
    if (pom) pom.style.color = this.timerColors.text;
    // Style buttons based on colors
    const isDarkBg = this.isDark(this.timerColors.bg);
    document.querySelectorAll('.fs-btn').forEach(btn => {
      if (btn.classList.contains('danger')) return;
      btn.style.background = this.timerColors.bg;
      btn.style.color = this.timerColors.text;
      btn.style.border = `1px solid ${this.timerColors.text}`;
    });
  }

  isDark(hex) {
    if (!hex) return false;
    const c = hex.replace('#', '');
    const r = parseInt(c.substring(0,2), 16);
    const g = parseInt(c.substring(2,4), 16);
    const b = parseInt(c.substring(4,6), 16);
    return (r*0.299 + g*0.587 + b*0.114) < 128;
  }

  darken(hex, percent) {
    const c = hex.replace('#', '');
    let r = parseInt(c.substring(0,2), 16);
    let g = parseInt(c.substring(2,4), 16);
    let b = parseInt(c.substring(4,6), 16);
    r = Math.max(0, Math.round(r * (1 - percent/100)));
    g = Math.max(0, Math.round(g * (1 - percent/100)));
    b = Math.max(0, Math.round(b * (1 - percent/100)));
    const pad = n => String(n).toString(16).padStart(2, '0');
    return `#${pad(r)}${pad(g)}${pad(b)}`;
  }

  getTodayKey() {
    const now = new Date();
    return this.formatDateKey(now);
  }

  formatDateKey(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  getData() {
    // Returns the full data object, resetting today if needed
    this.checkDayRollover();
    return this.data;
  }

  checkDayRollover() {
    const today = this.getTodayKey();
    if (!this.data.lastActiveDate) {
      this.data.lastActiveDate = today;
      this.data.days = {};
    } else if (this.data.lastActiveDate !== today) {
      // New day started - start fresh today entry
      if (!this.data.days[today]) {
        this.data.days[today] = this.createEmptyDay();
      }
      this.data.lastActiveDate = today;
      this.saveData();
    }
  }

  createEmptyDay() {
    const day = {};
    this.subjects.forEach(s => {
      day[s] = { time: 0, sessions: [], pomodoros: 0 };
    });
    return day;
  }

  loadData() {
    const stored = localStorage.getItem('studyTracker');
    if (stored) {
      try {
        this.data = JSON.parse(stored);
      } catch (e) {
        this.data = this.getDefaultData();
      }
    } else {
      this.data = this.getDefaultData();
    }
    
    // Ensure settings loaded
    if (this.data.settings) {
      this.subjectGoal = this.data.settings.subjectGoal || this.defaultSubjectGoal;
      this.notificationsEnabled = this.data.settings.notificationsEnabled || false;
      this.reminderTime = this.data.settings.reminderTime || '09:00';
      this.reminderEmailEnabled = this.data.settings.reminderEmailEnabled || false;
      if (this.data.settings.emailjs) this.emailjs = {...this.emailjs, ...this.data.settings.emailjs};
      if (this.data.settings.pomodoroSettings) this.pomodoroSettings = {...this.pomodoroSettings, ...this.data.settings.pomodoroSettings};
      if (this.data.settings.theme) this.theme = {...this.theme, ...this.data.settings.theme};
      if (this.data.settings.timerColors) this.timerColors = {...this.timerColors, ...this.data.settings.timerColors};
    } else {
      this.data.settings = {
        subjectGoal: this.subjectGoal,
        notificationsEnabled: this.notificationsEnabled,
        reminderTime: this.reminderTime,
        reminderEmailEnabled: this.reminderEmailEnabled,
        emailjs: this.emailjs,
        pomodoroSettings: this.pomodoroSettings,
        theme: this.theme,
        timerColors: this.timerColors
      };
    }
    
    // Ensure subjects are set
    if (this.data.subjects && this.data.subjects.length > 0) {
      this.subjects = this.data.subjects;
    }
    
    this.saveData();
  }

  getDefaultData() {
    return {
      lastActiveDate: this.getTodayKey(),
      subjects: this.subjects,
      days: {
        [this.getTodayKey()]: this.createEmptyDay()
      },
      settings: {
        subjectGoal: this.defaultSubjectGoal,
        notificationsEnabled: false,
        reminderTime: '09:00',
        reminderEmailEnabled: false,
        emailjs: this.emailjs,
        pomodoroSettings: this.pomodoroSettings,
        theme: this.theme,
        timerColors: this.timerColors
      }
    };
  }

  saveData() {
    this.data.lastActiveDate = this.getTodayKey();
    if (!this.data.days[this.getTodayKey()]) {
      this.data.days[this.getTodayKey()] = this.createEmptyDay();
    }
    localStorage.setItem('studyTracker', JSON.stringify(this.data));
  }

  getDayData(dateKey = null) {
    const key = dateKey || this.getTodayKey();
    if (!this.data.days[key]) {
      this.data.days[key] = this.createEmptyDay();
      this.saveData();
    }
    return this.data.days[key];
  }

  getSubjectTime(dateKey, subject) {
    const day = this.getDayData(dateKey);
    return (day[subject] && day[subject].time) || 0;
  }

  getFormattedTime(ms) {
    const totalSeconds = Math.floor(ms / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    
    if (hours > 0) {
      return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
    } else {
      return minutes > 0 ? `${minutes}m` : `${totalSeconds}s`;
    }
  }

  formatTime(ms) {
    const totalSeconds = Math.floor(ms / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    return `${hours}h ${minutes}m`;
  }

  getSubjectPercentage(subject) {
    const currentWeekMs = this.getSubjectWeekTime(subject);
    const goalMs = this.subjectGoal * 3600000;
    return Math.min(100, (currentWeekMs / goalMs) * 100);
  }

  // Total time for a subject over the current week (all days in the current week)
  getSubjectWeekTime(subject) {
    const days = this.getWeekDays(0);
    let total = 0;
    days.forEach(day => {
      const key = this.formatDateKey(day);
      const dayData = this.getDayData(key);
      if (dayData[subject]) total += dayData[subject].time;
    });
    return total;
  }

  // Capped weekly time for a subject (max = weekly goal for that subject)
  getSubjectWeekTimeCapped(subject) {
    return Math.min(this.getSubjectWeekTime(subject), this.subjectGoal * 3600000);
  }

  // Real (uncapped) time a subject did today
  getSubjectTodayTime(subject) {
    return this.getSubjectTime(this.getTodayKey(), subject);
  }

  // Total capped weekly hours (sum of capped subject week times) - this drives the overall percentage
  getTotalTime() {
    return this.subjects.reduce((sum, s) => sum + this.getSubjectWeekTimeCapped(s), 0);
  }

  getTotalPercentage() {
    const totalMs = this.getTotalTime();
    const goalMs = this.subjectGoal * this.subjects.length * 3600000;
    if (goalMs === 0) return 0;
    return Math.min(100, (totalMs / goalMs) * 100);
  }

  getTotalGoal() {
    return this.subjectGoal * this.subjects.length;
  }

  addTime(subject, ms) {
    const today = this.getTodayKey();
    const day = this.getDayData(today);
    if (!day[subject]) {
      day[subject] = { time: 0, sessions: [], pomodoros: 0 };
    }
    if (day[subject].pomodoros === undefined) day[subject].pomodoros = 0;
    day[subject].time += ms;
    day[subject].sessions.push({
      ms,
      timestamp: Date.now()
    });
    
    // Save session history max 100 per subject per day
    if (day[subject].sessions.length > 100) {
      day[subject].sessions = day[subject].sessions.slice(-100);
    }
    this.saveData();
    this.refresh();
  }

  // Timer functions
  startTimer(subject) {
    if (this.activeTimers[subject]) return;
    this.activeTimers[subject] = {
      startTime: Date.now(),
      accumulated: 0
    };
    // Notify if subject reached goal
    const currentMs = this.getSubjectTime(this.getTodayKey(), subject);
    if (currentMs >= this.subjectGoal * 3600000) {
      // Already at goal but user started timer anyway - just continue
    }
  }

  stopTimer(subject) {
    if (!this.activeTimers[subject]) return;
    const timer = this.activeTimers[subject];
    const elapsed = Date.now() - timer.startTime;
    this.addTime(subject, elapsed);
    delete this.activeTimers[subject];
  }

  resetTimer(subject) {
    if (this.activeTimers[subject]) {
      delete this.activeTimers[subject];
    }
  }

  hasActiveTimer(subject) {
    return !!this.activeTimers[subject];
  }

  updateRunningTimers() {
    if (Object.keys(this.activeTimers).length === 0) return;
    
    let needsRefresh = false;
    Object.keys(this.activeTimers).forEach(subject => {
      // Check if reached goal while timer running
      const timer = this.activeTimers[subject];
      const elapsedMs = Date.now() - timer.startTime;
      const totalMs = this.getSubjectTime(this.getTodayKey(), subject) + elapsedMs;
      const goalMs = this.subjectGoal * 3600000;
      
      // Update timer display in modal / fullscreen
      if (this.currentModalSubject === subject) {
        const display = document.getElementById('timer-display');
        if (display) {
          display.textContent = this.formatTimer(elapsedMs);
        }
        if (!document.getElementById('fullscreen-overlay').classList.contains('hidden')) {
          const fs = document.getElementById('fs-display');
          if (fs) fs.textContent = this.formatTimer(elapsedMs);
        }
      }
      
      // Show completion notification when reaching goal
      const currentStationary = this.getSubjectTime(this.getTodayKey(), subject);
      if (currentStationary < goalMs && totalMs >= goalMs) {
        this.showNotification(`🎉 ${subject} study goal achieved for today!`);
        needsRefresh = true;
        // Don't loop - clear flag since added time will update
      }
    });
    
    if (needsRefresh) {
      this.refresh();
    }
  }

  formatTimer(ms) {
    const totalSeconds = Math.floor(ms / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const secs = totalSeconds % 60;
    
    const pad = n => String(n).padStart(2, '0');
    return `${pad(hours)}:${pad(minutes)}:${pad(secs)}`;
  }

  // Time-based reminder scheduling
  scheduleNotifications() {
    if (!this.notificationsEnabled) return;
    
    // Request notification permission on load if enabled
    this.requestNotificationPermission();
    
    // Check every minute
    this.notificationCheck = setInterval(() => this.checkReminder(), 60000);
    this.checkReminder();
  }

  checkReminder() {
    if (!this.notificationsEnabled) return;
    
    const now = new Date();
    const [hours, mins] = this.reminderTime.split(':').map(Number);
    const currentHour = now.getHours();
    const currentMins = now.getMinutes();
    
    // Check if current time matches reminder time (within 1 min window)
    if (currentHour === hours && currentMins === mins) {
      // Don't send same reminder twice in the same day
      const todayKey = this.getTodayKey();
      if (this.data.lastReminderSent === todayKey) return;
      this.data.lastReminderSent = todayKey;
      this.saveData();
      
      // Check each subject (against weekly goal)
      const belowGoal = [];
      this.subjects.forEach(subject => {
        const weekTime = this.getSubjectWeekTime(subject);
        const goalMs = this.subjectGoal * 3600000;
        if (weekTime < goalMs) {
          belowGoal.push({ subject, weekTime, remaining: goalMs - weekTime });
          this.showNotification(`${subject}: ${this.getFormattedTime(goalMs - weekTime)} left this week to hit your ${this.subjectGoal}h weekly goal.`);
        }
      });
      
      // Send email reminder if enabled & configured
      if (this.reminderEmailEnabled && belowGoal.length > 0) {
        this.sendReminderEmail(belowGoal);
      }
    }
  }

  buildReminderMessage(belowGoal) {
    let lines = [`Study Reminder — ${new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}`, ''];
    if (belowGoal.length === 0) {
      lines.push('Great job! All subjects have reached their weekly goal this week. 🎉');
    } else {
      lines.push('Weekly goal remaining:');
      belowGoal.forEach(item => {
        lines.push(`• ${item.subject}: ${this.getFormattedTime(item.remaining)} left (${this.formatTime(item.weekTime)} / ${this.subjectGoal}h)`);
      });
    }
    return lines.join('\n');
  }

  sendReminderEmail(belowGoal) {
    if (!this.isEmailConfigured()) return;
    const message = this.buildReminderMessage(belowGoal);
    this.sendEmail({
      to_email: this.emailjs.to,
      message: message,
      subject_name: 'Weekly Study Goal Reminder'
    });
  }

  isEmailConfigured() {
    return this.emailjs.service && this.emailjs.template && this.emailjs.user && this.emailjs.to;
  }

  initEmailJS() {
    if (typeof emailjs !== 'undefined' && this.emailjs.user) {
      try {
        emailjs.init({ publicKey: this.emailjs.user });
      } catch (e) {
        console.warn('EmailJS init failed:', e);
      }
    }
  }

  sendEmail(params) {
    if (!this.isEmailConfigured()) {
      console.warn('EmailJS not fully configured');
      return Promise.reject('EmailJS not fully configured');
    }
    if (typeof emailjs === 'undefined') {
      console.warn('EmailJS library not loaded');
      return Promise.reject('EmailJS library not loaded');
    }
    return emailjs.send(this.emailjs.service, this.emailjs.template, params)
      .then(res => ({ ok: true, res }))
      .catch(err => ({ ok: false, err }));
  }

  testEmail() {
    const statusEl = document.getElementById('email-status');
    if (!this.isEmailConfigured()) {
      statusEl.textContent = '⚠ Please fill in all EmailJS fields (Service, Template, User ID, and email address) first.';
      return;
    }
    statusEl.textContent = 'Sending test email...';
    this.sendEmail({
      to_email: this.emailjs.to,
      message: 'This is a test email from your Study Tracker. Email reminders are working! ✅'
    }).then(res => {
      statusEl.textContent = res.ok ? '✅ Test email sent!' : `❌ Failed: ${(res.err && res.err.text) || 'unknown error'}`;
    });
  }

  requestNotificationPermission() {
    if ('Notification' in window) {
      Notification.requestPermission();
    }
  }

  showNotification(message) {
    if (!this.notificationsEnabled) return;
    if ('Notification' in window && Notification.permission === 'granted') {
      new Notification('Study Tracker', { body: message });
    } else {
      // In-app notification fallback
      this.showToast(message);
    }
  }

  showToast(message) {
    let toast = document.getElementById('toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'toast';
      toast.style.cssText = `
        position: fixed;
        bottom: 20px;
        right: 20px;
        background: var(--bg-card);
        border: 1px solid var(--success);
        color: var(--text-primary);
        padding: 15px 20px;
        border-radius: 10px;
        box-shadow: var(--shadow);
        z-index: 2000;
        animation: slideIn 0.3s ease;
      `;
      document.body.appendChild(toast);
    }
    toast.textContent = message;
    toast.style.display = 'block';
    setTimeout(() => {
      toast.style.display = 'none';
    }, 4000);
  }

  // UI Functions
  setupEventListeners() {
    // Nav buttons
    document.querySelectorAll('.nav-btn').forEach(btn => {
      btn.addEventListener('click', () => this.switchView(btn.dataset.view));
    });
    
    // Timer modal controls
    document.getElementById('timer-start').addEventListener('click', () => this.handleTimerStart());
    document.getElementById('timer-stop').addEventListener('click', () => this.handleTimerStop());
    document.getElementById('timer-reset').addEventListener('click', () => this.handleTimerReset());
    document.getElementById('timer-close').addEventListener('click', () => this.closeTimerModal());
    document.getElementById('manual-add-btn').addEventListener('click', () => this.handleManualAdd());
    
    // Timer tabs
    document.querySelectorAll('.tab').forEach(tab => {
      tab.addEventListener('click', () => this.switchTimerTab(tab.dataset.tab));
    });
    
    // Pomodoro controls
    document.getElementById('pomodoro-start').addEventListener('click', () => this.handlePomodoroStart());
    document.getElementById('pomodoro-stop').addEventListener('click', () => this.handlePomodoroStop());
    document.getElementById('pomodoro-skip').addEventListener('click', () => this.handlePomodoroSkip());
    
    // Week navigation
    document.getElementById('prev-week').addEventListener('click', () => this.shiftWeek(-1));
    document.getElementById('next-week').addEventListener('click', () => this.shiftWeek(1));
    
    // Settings
    document.getElementById('save-settings').addEventListener('click', () => this.saveSettings());
    document.getElementById('add-subject').addEventListener('click', () => this.addSubjectEditor());
    document.getElementById('notifications-enabled').addEventListener('change', (e) => {
      document.getElementById('notification-settings').classList.toggle('hidden', !e.target.checked);
    });
    document.getElementById('test-email').addEventListener('click', () => this.testEmail());
    document.getElementById('backup-export').addEventListener('click', () => this.exportData());
    document.getElementById('backup-import').addEventListener('click', () => this.importData());
    document.getElementById('import-file').addEventListener('change', (e) => this.handleImportFile(e));
    
    // Theme swatches
    document.querySelectorAll('.theme-swatch').forEach(sw => {
      sw.addEventListener('click', () => {
        this.theme.accent = sw.dataset.accent;
        this.theme.accentHover = sw.dataset.accentHover;
        document.querySelectorAll('.theme-swatch').forEach(s => s.classList.toggle('active', s === sw));
        document.getElementById('theme-accent-custom').value = sw.dataset.accent;
        this.applyTheme();
      });
    });
    document.getElementById('theme-accent-custom').addEventListener('input', (e) => {
      this.theme.accent = e.target.value;
      this.theme.accentHover = this.darken(e.target.value, 15);
      document.querySelectorAll('.theme-swatch').forEach(s => s.classList.remove('active'));
      this.applyTheme();
    });
    
    // Fullscreen timer
    document.getElementById('timer-fullscreen').addEventListener('click', () => this.openFullscreen());
    document.getElementById('fullscreen-timer').addEventListener('click', () => this.openFullscreen());
    document.getElementById('fs-start').addEventListener('click', () => this.handleTimerStart());
    document.getElementById('fs-stop').addEventListener('click', () => this.handleTimerStop());
    document.getElementById('fs-reset').addEventListener('click', () => this.handleTimerReset());
    document.getElementById('fs-close').addEventListener('click', () => this.closeFullscreen());
    
    // Timer color pickers
    document.getElementById('timer-text-color').addEventListener('input', (e) => {
      this.timerColors.text = e.target.value;
    });
    document.getElementById('timer-bg-color').addEventListener('input', (e) => {
      this.timerColors.bg = e.target.value;
    });
    document.getElementById('timer-text-black').addEventListener('change', (e) => {
      if (e.target.checked) {
        this.timerColors.text = '#000000';
        this.timerColors.bg = '#ffffff';
        document.getElementById('timer-text-color').value = '#000000';
        document.getElementById('timer-bg-color').value = '#ffffff';
      }
    });
    
    // Close modal on outside click
    document.getElementById('timer-modal').addEventListener('click', (e) => {
      if (e.target === document.getElementById('timer-modal')) {
        this.closeTimerModal();
      }
    });
    
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        this.closeTimerModal();
      }
    });
  }

  switchView(view) {
    document.querySelectorAll('.nav-btn').forEach(b => {
      b.classList.toggle('active', b.dataset.view === view);
    });
    document.querySelectorAll('.view').forEach(v => {
      v.classList.toggle('active', v.id === `${view}-view`);
    });
    
    if (view === 'weekly') {
      this.currentWeekOffset = 0;
      this.renderWeekly();
    }
    if (view === 'settings') {
      this.renderSettings();
    }
  }

  initializeUI() {
    this.currentModalSubject = null;
    this.currentWeekOffset = 0;
    
    // Populate timer modal initially
    this.renderToday();
    this.renderWeekly();
    this.renderSettings();
  }

  renderToday() {
    const today = new Date();
    const dateStr = today.toLocaleDateString('en-US', { 
      month: 'long', 
      day: 'numeric'
    });
    document.getElementById('today-date').textContent = `TODAY — ${dateStr}`;
    
    const subjectsList = document.getElementById('subjects-list');
    subjectsList.innerHTML = '';
    
    this.subjects.forEach(subject => {
      const card = this.createSubjectCard(subject);
      subjectsList.appendChild(card);
    });
    
    // Total: capped weekly time vs weekly goal
    const totalMs = this.getTotalTime();
    const totalPct = this.getTotalPercentage();
    const totalGoal = this.getTotalGoal();
    
    document.getElementById('total-bar').style.width = `${Math.min(100, totalPct)}%`;
    document.getElementById('total-percentage').textContent = `${totalPct.toFixed(1)}%`;
    document.getElementById('total-time').textContent = `${this.formatTime(totalMs)} / ${totalGoal}h this week`;
  }

  createSubjectCard(subject) {
    const card = document.createElement('div');
    card.className = 'subject-card';
    card.id = `subject-${subject.toLowerCase().replace(/\s+/g, '-')}`;
    
    const todayMs = this.getSubjectTodayTime(subject);
    const weekMs = this.getSubjectWeekTime(subject);
    const weekCapped = this.getSubjectWeekTimeCapped(subject);
    const pct = this.getSubjectPercentage(subject);
    const goal = this.subjectGoal;
    const isRunning = this.hasActiveTimer(subject);
    const reachedGoal = weekCapped >= goal * 3600000;
    
    card.innerHTML = `
      <div class="subject-header">
        <span class="subject-name">${subject} ${reachedGoal ? '✅' : ''}</span>
        <button class="timer-btn ${isRunning ? 'running' : ''}" data-subject="${this.escapeAttr(subject)}">
          ${isRunning ? '⏱ Running' : '▶ Start'}
        </button>
      </div>
      <div class="subject-detail-row">
        <span class="detail-label">Today</span>
        <span class="detail-value">${this.formatTime(todayMs)}</span>
      </div>
      <div class="progress-container">
        <div class="progress-info">
          <span>Week: ${this.formatTime(weekMs)} / ${goal}h</span>
          <span>${pct.toFixed(0)}%</span>
        </div>
        <div class="progress-bar-bg">
          <div class="progress-bar" style="width: ${Math.min(100, pct)}%"></div>
        </div>
      </div>
    `;
    
    const btn = card.querySelector('.timer-btn');
    btn.addEventListener('click', () => {
      this.openTimerModal(subject);
    });
    
    return card;
  }

  escapeAttr(str) {
    return str.replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  // Timer Modal
  openTimerModal(subject) {
    this.currentModalSubject = subject;
    document.getElementById('timer-subject-name').textContent = subject;
    
    const isRunning = this.hasActiveTimer(subject);
    document.getElementById('timer-start').disabled = isRunning;
    document.getElementById('timer-stop').disabled = !isRunning;
    
    if (isRunning) {
      const elapsed = Date.now() - this.activeTimers[subject].startTime;
      document.getElementById('timer-display').textContent = this.formatTimer(elapsed);
    } else {
      document.getElementById('timer-display').textContent = '00:00:00';
    }
    
    // Reset pomodoro display for this subject
    this.resetPomodoroForSubject();
    this.renderPomodoroCount();
    
    document.getElementById('timer-modal').classList.remove('hidden');
  }

  closeTimerModal() {
    // Pause pomodoro if running when closing
    if (this.pomodoro.running) {
      this.handlePomodoroStop();
    }
    document.getElementById('timer-modal').classList.add('hidden');
    this.currentModalSubject = null;
  }

  switchTimerTab(tab) {
    document.querySelectorAll('.tab').forEach(t => {
      t.classList.toggle('active', t.dataset.tab === tab);
    });
    document.querySelectorAll('.tab-panel').forEach(p => {
      p.classList.toggle('active', p.id === `tab-${tab}`);
    });
  }

  resetPomodoroForSubject() {
    // Stop any running pomodoro
    if (this.pomodoro.running) {
      this.pomodoroStop();
    }
    this.pomodoro.phase = 'work';
    this.pomodoro.remainingMs = this.pomodoroSettings.work * 60000;
    this.pomodoro.elapsedMs = 0;
    this.renderPomodoroDisplay(false);
  }

  renderPomodoroDisplay(isRunning) {
    const displayEl = document.getElementById('pomodoro-display');
    const phaseEl = document.getElementById('pomodoro-phase');
    const startBtn = document.getElementById('pomodoro-start');
    const stopBtn = document.getElementById('pomodoro-stop');
    
    const totalSecs = Math.max(0, Math.ceil(this.pomodoro.remainingMs / 1000));
    const mins = Math.floor(totalSecs / 60);
    const secs = totalSecs % 60;
    const pad = n => String(n).padStart(2, '0');
    displayEl.textContent = `${pad(mins)}:${pad(secs)}`;
    
    const isBreak = this.pomodoro.phase !== 'work';
    phaseEl.textContent = isBreak ? (this.pomodoro.phase === 'long' ? 'Long Break' : 'Short Break') : 'Work';
    displayEl.classList.toggle('work', !isBreak);
    displayEl.classList.toggle('break', isBreak);
    phaseEl.classList.toggle('work', !isBreak);
    phaseEl.classList.toggle('break', isBreak);
    
    startBtn.disabled = isRunning;
    stopBtn.disabled = !isRunning;
  }

  renderPomodoroCount() {
    const subject = this.currentModalSubject;
    if (!subject) return;
    const day = this.getDayData(this.getTodayKey());
    const count = (day[subject] && day[subject].pomodoros) || 0;
    document.getElementById('pomodoro-count').textContent = `🍅 ${count} completed today`;
  }

  pomodoroStart() {
    this.pomodoro.running = true;
    this.pomodoro.lastTick = Date.now();
    this.pomodoro.interval = setInterval(() => this.pomodoroTick(), 1000);
    this.renderPomodoroDisplay(true);
  }

  pomodoroStop() {
    this.pomodoro.running = false;
    if (this.pomodoro.interval) {
      clearInterval(this.pomodoro.interval);
      this.pomodoro.interval = null;
    }
    this.renderPomodoroDisplay(false);
  }

  pomodoroTick() {
    if (!this.pomodoro.running) return;
    const now = Date.now();
    const delta = now - (this.pomodoro.lastTick || now);
    this.pomodoro.lastTick = now;
    this.pomodoro.remainingMs -= delta;
    this.pomodoro.elapsedMs += delta;
    
    if (this.pomodoro.remainingMs <= 0) {
      // Phase complete
      this.completePomodoroPhase();
    } else {
      this.renderPomodoroDisplay(true);
    }
  }

  completePomodoroPhase() {
    const phase = this.pomodoro.phase;
    this.pomodoro.running = false;
    if (this.pomodoro.interval) {
      clearInterval(this.pomodoro.interval);
      this.pomodoro.interval = null;
    }
    
    if (phase === 'work') {
      // For a natural completion use the full work duration; for a skip only the elapsed time
      const workMs = this.pomodoro.elapsedMs > 0 && this.pomodoro.remainingMs > 0
        ? this.pomodoro.elapsedMs
        : this.pomodoroSettings.work * 60000;
      if (this.currentModalSubject && workMs > 0) {
        this.addPomodoroToSubject(this.currentModalSubject, workMs);
        this.renderPomodoroCount();
        this.showNotification(`✅ ${this.formatTimeStopped(workMs)} added to ${this.currentModalSubject}.`);
        this.playChime();
      }
      // Move to break
      this.pomodoro.phase = 'short';
      this.pomodoro.remainingMs = this.pomodoroSettings.short * 60000;
      this.pomodoro.elapsedMs = 0;
    } else {
      // Break done - back to work
      this.pomodoro.phase = 'work';
      this.pomodoro.remainingMs = this.pomodoroSettings.work * 60000;
      this.pomodoro.elapsedMs = 0;
      this.showNotification('🍅 Break over — back to work!');
      this.playChime();
    }
    
    this.renderPomodoroDisplay(false);
  }

  formatTimeStopped(ms) {
    const totalSeconds = Math.floor(ms / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const secs = totalSeconds % 60;
    if (minutes === 0) return `${secs}s`;
    return secs > 0 ? `${minutes}m ${secs}s` : `${minutes}m`;
  }

  pomodoroSkip() {
    // Skip the current phase: for work, add only elapsed time (not full duration)
    this.completePomodoroPhase();
  }

  addPomodoroToSubject(subject, ms) {
    const today = this.getTodayKey();
    const day = this.getDayData(today);
    if (!day[subject]) {
      day[subject] = { time: 0, sessions: [], pomodoros: 0 };
    }
    if (day[subject].pomodoros === undefined) day[subject].pomodoros = 0;
    day[subject].pomodoros += 1;
    day[subject].time += ms;
    day[subject].sessions.push({ ms, timestamp: Date.now(), type: 'pomodoro' });
    this.saveData();
    this.refresh();
  }

  playChime() {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.frequency.value = 880;
      osc.type = 'sine';
      gain.gain.setValueAtTime(0.3, ctx.currentTime);
      osc.start();
      osc.stop(ctx.currentTime + 0.4);
    } catch (e) { /* audio not supported */ }
  }

  handlePomodoroStart() {
    if (!this.currentModalSubject) return;
    if (!this.pomodoro.running) {
      this.pomodoroStart();
    }
  }

  handlePomodoroStop() {
    this.pomodoroStop();
  }

  handlePomodoroSkip() {
    this.pomodoroSkip();
  }

  openFullscreen() {
    if (!this.currentModalSubject) return;
    this.applyTimerColors();
    document.getElementById('fs-subject').textContent = this.currentModalSubject;
    const isRunning = this.hasActiveTimer(this.currentModalSubject);
    document.getElementById('fs-start').disabled = isRunning;
    document.getElementById('fs-stop').disabled = !isRunning;
    this.updateFullscreenClock();
    document.getElementById('fullscreen-overlay').classList.remove('hidden');
    // Try to request browser fullscreen
    if (document.documentElement.requestFullscreen) {
      document.documentElement.requestFullscreen().catch(() => {});
    }
  }

  closeFullscreen() {
    document.getElementById('fullscreen-overlay').classList.add('hidden');
    if (document.exitFullscreen && document.fullscreenElement) {
      document.exitFullscreen().catch(() => {});
    }
  }

  updateFullscreenClock() {
    if (!this.currentModalSubject) return;
    const subject = this.currentModalSubject;
    const display = document.getElementById('fs-display');
    if (this.hasActiveTimer(subject)) {
      const elapsed = Date.now() - this.activeTimers[subject].startTime;
      display.textContent = this.formatTimer(elapsed);
    } else {
      display.textContent = '00:00:00';
    }
    // Show today's total for this subject
    const total = this.getSubjectTime(this.getTodayKey(), subject);
    const goal = this.subjectGoal;
    document.getElementById('fs-pomodoro').textContent = `Today: ${this.formatTime(total)} / ${goal}h`;
  }

  handleTimerStart() {
    if (!this.currentModalSubject) return;
    this.startTimer(this.currentModalSubject);
    document.getElementById('timer-start').disabled = true;
    document.getElementById('timer-stop').disabled = false;
    if (!document.getElementById('fullscreen-overlay').classList.contains('hidden')) {
      document.getElementById('fs-start').disabled = true;
      document.getElementById('fs-stop').disabled = false;
      this.updateFullscreenClock();
    }
    this.refresh();
  }

  handleTimerStop() {
    if (!this.currentModalSubject) return;
    this.stopTimer(this.currentModalSubject);
    document.getElementById('timer-start').disabled = false;
    document.getElementById('timer-stop').disabled = true;
    document.getElementById('timer-display').textContent = '00:00:00';
    if (!document.getElementById('fullscreen-overlay').classList.contains('hidden')) {
      document.getElementById('fs-start').disabled = false;
      document.getElementById('fs-stop').disabled = true;
      this.updateFullscreenClock();
    }
    this.closeTimerModal();
  }

  handleTimerReset() {
    if (!this.currentModalSubject) return;
    this.resetTimer(this.currentModalSubject);
    document.getElementById('timer-start').disabled = false;
    document.getElementById('timer-stop').disabled = true;
    document.getElementById('timer-display').textContent = '00:00:00';
    if (!document.getElementById('fullscreen-overlay').classList.contains('hidden')) {
      document.getElementById('fs-start').disabled = false;
      document.getElementById('fs-stop').disabled = true;
      this.updateFullscreenClock();
    }
    this.refresh();
  }

  handleManualAdd() {
    if (!this.currentModalSubject) return;
    const hours = parseFloat(document.getElementById('manual-hours').value) || 0;
    const minutes = parseFloat(document.getElementById('manual-minutes').value) || 0;
    const ms = (hours * 3600 + minutes * 60) * 1000;
    
    if (ms > 0) {
      this.addTime(this.currentModalSubject, ms);
      document.getElementById('manual-hours').value = '';
      document.getElementById('manual-minutes').value = '';
      
      // Update modal display with new total
      const totalMs = this.getSubjectTime(this.getTodayKey(), this.currentModalSubject);
      const isRunning = this.hasActiveTimer(this.currentModalSubject);
      const displayEl = document.getElementById('timer-display');
      if (isRunning) {
        const elapsed = Date.now() - this.activeTimers[this.currentModalSubject].startTime;
        displayEl.textContent = this.formatTimer(elapsed);
      } else {
        displayEl.textContent = '00:00:00';
      }
      
      // Notify if reached goal
      const goalMs = this.subjectGoal * 3600000;
      if (totalMs >= goalMs) {
        this.showNotification(`🎉 ${this.currentModalSubject} study goal achieved!`);
      }
    }
  }

  // Weekly View
  getWeekDays(offset = 0) {
    // Get Monday of current week + offset
    const now = new Date();
    const monday = new Date(now);
    const day = now.getDay(); // 0=Sun
    const diff = day === 0 ? 6 : day - 1; // days since Monday
    monday.setDate(now.getDate() - diff + offset * 7);
    monday.setHours(12, 0, 0, 0); // Avoid timezone issues
    
    const days = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(monday);
      d.setDate(monday.getDate() + i);
      days.push(d);
    }
    return days;
  }

  renderWeekly() {
    const days = this.getWeekDays(this.currentWeekOffset || 0);
    
    // Week label
    const start = days[0].toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    const end = days[6].toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    const year = days[0].getFullYear();
    document.getElementById('week-label').textContent = `${start} — ${end}, ${year}`;
    
    const grid = document.getElementById('weekly-grid');
    grid.innerHTML = '';
    
    const todayKey = this.getTodayKey();
    
    days.forEach(day => {
      const key = this.formatDateKey(day);
      const dayData = this.getDayData(key);
      const isToday = key === todayKey;
      const dayName = day.toLocaleDateString('en-US', { weekday: 'short' });
      const dayNum = day.getDate();
      
      const col = document.createElement('div');
      col.className = `day-column ${isToday ? 'today' : ''}`;
      
      let html = `
        <div class="day-header">
          ${dayName}
          <span class="day-date">${dayNum}</span>
        </div>
      `;
      
      this.subjects.forEach(subject => {
        const timeMs = (dayData[subject] && dayData[subject].time) || 0;
        html += `
          <div class="day-subject">
            <span class="day-subject-name">${subject}</span>
            <span class="day-subject-time">${this.formatCompactTime(timeMs)}</span>
          </div>
        `;
      });
      
      col.innerHTML = html;
      grid.appendChild(col);
    });
    
    this.renderWeeklySummary(days);
  }

  formatCompactTime(ms) {
    const totalSeconds = Math.floor(ms / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    if (hours === 0) {
      return minutes > 0 ? `${minutes}m` : `${totalSeconds}s`;
    }
    return `${hours}h ${minutes}m`;
  }

  renderWeeklySummary(days) {
    // Calculate weekly totals for each subject (real, uncapped)
    const weeklyTotals = {};
    let cappedTotal = 0;

    this.subjects.forEach(subject => {
      let total = 0;
      days.forEach(day => {
        const key = this.formatDateKey(day);
        const dayData = this.getDayData(key);
        if (dayData[subject]) total += dayData[subject].time;
      });
      weeklyTotals[subject] = total;
      // Cap for the overall total: an overachieving subject counts only up to its own weekly goal
      cappedTotal += Math.min(total, this.subjectGoal * 3600000);
    });

    const goalMs = this.subjectGoal * this.subjects.length * 3600000;
    const overallPct = goalMs > 0 ? (cappedTotal / goalMs) * 100 : 0;
    
    // Render
    let html = '<div class="summary-grid">';
    
    this.subjects.forEach(subject => {
      const total = weeklyTotals[subject];
      const goalPct = Math.min(100, (total / (this.subjectGoal * 3600000)) * 100);
      const hit = total >= this.subjectGoal * 3600000;
      html += `
        <div class="summary-item ${hit ? 'hit' : ''}">
          <div class="summary-label">${subject} ${hit ? '✅' : ''}</div>
          <div class="summary-value">${this.formatCompactTime(total)}</div>
          <div class="summary-label sub">goal ${this.subjectGoal}h — ${goalPct.toFixed(0)}%</div>
        </div>
      `;
    });
    
    html += `
      <div class="summary-item overall">
        <div class="summary-label">Weekly total (capped)</div>
        <div class="summary-value">${this.formatCompactTime(cappedTotal)}</div>
        <div class="summary-label sub">${overallPct.toFixed(1)}% of ${this.getTotalGoal()}h</div>
      </div>
    `;
    
    html += '</div>';
    
    document.getElementById('weekly-averages').innerHTML = html;
  }

  shiftWeek(dir) {
    this.currentWeekOffset = (this.currentWeekOffset || 0) + dir;
    this.renderWeekly();
  }

  // Settings
  renderSettings() {
    document.getElementById('subject-goal').value = this.subjectGoal;
    document.getElementById('notifications-enabled').checked = this.notificationsEnabled;
    document.getElementById('reminder-time').value = this.reminderTime;
    document.getElementById('reminder-email-enabled').checked = this.reminderEmailEnabled;
    document.getElementById('notification-settings').classList.toggle('hidden', !this.notificationsEnabled);
    
    document.getElementById('pomodoro-work').value = this.pomodoroSettings.work;
    document.getElementById('pomodoro-short').value = this.pomodoroSettings.short;
    document.getElementById('pomodoro-long').value = this.pomodoroSettings.long;
    
    document.getElementById('emailjs-service').value = this.emailjs.service;
    document.getElementById('emailjs-template').value = this.emailjs.template;
    document.getElementById('emailjs-user').value = this.emailjs.user;
    document.getElementById('emailjs-to').value = this.emailjs.to;
    
    // Theme
    document.getElementById('theme-accent-custom').value = this.theme.accent;
    document.querySelectorAll('.theme-swatch').forEach(s => {
      s.classList.toggle('active', s.dataset.accent === this.theme.accent);
    });
    
    // Timer colors
    document.getElementById('timer-text-color').value = this.timerColors.text;
    document.getElementById('timer-bg-color').value = this.timerColors.bg;
    document.getElementById('timer-text-black').checked = 
      this.timerColors.text === '#000000' && this.timerColors.bg === '#ffffff';
    
    this.renderSubjectEditor();
  }

  renderSubjectEditor() {
    const editor = document.getElementById('subjects-editor');
    editor.innerHTML = '';
    
    this.subjects.forEach(subject => {
      const row = document.createElement('div');
      row.className = 'subject-editor';
      row.innerHTML = `
        <input type="text" value="${this.escapeAttr(subject)}" class="subject-input"/>
        <button class="remove-btn">✕</button>
      `;
      
      const removeBtn = row.querySelector('.remove-btn');
      removeBtn.addEventListener('click', () => {
        // Can't remove if only 1 subject left
        if (this.subjects.length <= 1) {
          this.showToast('Must have at least 1 subject.');
          return;
        }
        row.remove();
      });
      
      editor.appendChild(row);
    });
  }

  addSubjectEditor() {
    const editor = document.getElementById('subjects-editor');
    const row = document.createElement('div');
    row.className = 'subject-editor';
    row.innerHTML = `
      <input type="text" value="New Subject" class="subject-input"/>
      <button class="remove-btn">✕</button>
    `;
    
    const removeBtn = row.querySelector('.remove-btn');
    removeBtn.addEventListener('click', () => {
      if (this.subjects.length <= 1) {
        this.showToast('Must have at least 1 subject.');
        return;
      }
      row.remove();
    });
    
    // Select text on focus
    const input = row.querySelector('input');
    input.addEventListener('focus', () => input.select());
    
    editor.appendChild(row);
  }

  saveSettings() {
    const goal = parseFloat(document.getElementById('subject-goal').value);
    if (!goal || goal < 0.25 || goal > 24) {
      this.showToast('Please enter a valid daily goal (0.25 - 24 hours).');
      return;
    }
    
    // Gather subjects from editor
    const subjectInputs = document.querySelectorAll('.subject-editor .subject-input');
    const newSubjects = [];
    subjectInputs.forEach(input => {
      const name = input.value.trim();
      if (name) newSubjects.push(name);
    });
    
    if (newSubjects.length === 0) {
      this.showToast('Please enter at least one subject.');
      return;
    }
    
    const oldSubjects = [...this.subjects];
    this.subjectGoal = goal;
    this.subjects = newSubjects;
    this.notificationsEnabled = document.getElementById('notifications-enabled').checked;
    this.reminderTime = document.getElementById('reminder-time').value;
    this.reminderEmailEnabled = document.getElementById('reminder-email-enabled').checked;
    
    this.pomodoroSettings = {
      work: parseInt(document.getElementById('pomodoro-work').value) || 25,
      short: parseInt(document.getElementById('pomodoro-short').value) || 5,
      long: parseInt(document.getElementById('pomodoro-long').value) || 15
    };
    
    this.emailjs = {
      service: document.getElementById('emailjs-service').value.trim(),
      template: document.getElementById('emailjs-template').value.trim(),
      user: document.getElementById('emailjs-user').value.trim(),
      to: document.getElementById('emailjs-to').value.trim()
    };
    this.initEmailJS();
    
    // Remove deleted subjects from historical data
    const todayKey = this.getTodayKey();
    this.data.subjects = newSubjects;
    this.data.days = this.data.days || {};
    
    Object.keys(this.data.days).forEach(dayKey => {
      const day = this.data.days[dayKey];
      Object.keys(day).forEach(subj => {
        if (!newSubjects.includes(subj)) {
          delete day[subj];
        }
      });
      // Add new subjects with zero time to empty days
      newSubjects.forEach(subj => {
        if (!day[subj]) {
          day[subj] = { time: 0, sessions: [], pomodoros: 0 };
        }
      });
    });
    
    this.data.settings = {
      subjectGoal: goal,
      notificationsEnabled: this.notificationsEnabled,
      reminderTime: this.reminderTime,
      reminderEmailEnabled: this.reminderEmailEnabled,
      emailjs: this.emailjs,
      pomodoroSettings: this.pomodoroSettings,
      theme: {
        accent: document.getElementById('theme-accent-custom').value || this.theme.accent,
        accentHover: this.theme.accentHover
      },
      timerColors: {
        text: this.timerColors.text,
        bg: this.timerColors.bg
      }
    };
    
    // Ensure theme applied from the custom picker
    this.theme.accent = this.data.settings.theme.accent;
    this.applyTheme();
    
    this.saveData();
    
    // Reset any running timers for removed subjects
    Object.keys(this.activeTimers).forEach(subject => {
      if (!newSubjects.includes(subject)) {
        delete this.activeTimers[subject];
      }
    });
    
    // Restart notification scheduling
    clearInterval(this.notificationCheck);
    this.scheduleNotifications();
    
    this.showToast('Settings saved!');
    this.renderToday();
    this.switchView('today');
  }

  exportData() {
    const data = JSON.stringify(this.data, null, 2);
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `study-tracker-backup-${this.getTodayKey()}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    this.showToast('Data exported to JSON file.');
  }

  importData() {
    document.getElementById('import-file').click();
  }

  handleImportFile(e) {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const imported = JSON.parse(ev.target.result);
        if (!imported.days || !imported.subjects) {
          throw new Error('Invalid backup file');
        }
        if (confirm('This will replace all current data. Continue?')) {
          localStorage.setItem('studyTracker', JSON.stringify(imported));
          this.loadData();
          this.initEmailJS();
          this.renderSettings();
          this.renderToday();
          this.switchView('today');
          this.showToast('Data imported successfully!');
        }
      } catch (err) {
        this.showToast('Import failed: invalid file.');
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  }

  // Global refresh for today view
  refresh() {
    // If on today view
    if (document.getElementById('today-view').classList.contains('active')) {
      this.renderToday();
    }
    // If weekly view, update it too
    if (document.getElementById('weekly-view').classList.contains('active')) {
      this.renderWeekly();
    }
  }
}

// Initialize the app
document.addEventListener('DOMContentLoaded', () => {
  window.studyTracker = new StudyTracker();
});