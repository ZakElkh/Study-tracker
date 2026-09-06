class StudyTracker {
  constructor() {
    this.subjects = ['Maths', 'Physics', 'Chemistry', 'English'];
    this.defaultSubjectGoal = 5; // hours per subject per day
    this.subjectGoal = 5;
    this.notificationsEnabled = false;
    this.reminderTime = '09:00';
    this.pomodoroSettings = { work: 25, short: 5, long: 15 };
    this.theme = { accent: '#d97706', accentHover: '#b45309' };
    this.timerColors = { text: '#ffffff', bg: '#000000' };
    
    // In-memory session state (not persisted across page reloads)
    this.activeTimers = {};
    
    // Document Picture-in-Picture window (the floating always-on-top mini)
    this.pipWindow = null;

    // Custom note the user writes in the timer (shown in modal / fullscreen / mini)
    this.timerNote = '';

    // Real-file storage (File System Access API). When active, the app loads and
    // saves to an actual data.json file instead of only browser localStorage.
    this.fileHandle = null;
    this.fileStorageActive = false;

    // GitHub sync (links profiles/browsers/PCs via a shared repo + personal access token)
    this.syncConfig = null;
    this.syncState = { updatedAt: 0, sha: null };
    this.syncTimer = null;
    this.syncPollInterval = null;
    
    // Pomodoro state
    this.pomodoro = {
      running: false,
      phase: 'work', // work | short | long
      remainingMs: 0,
      elapsedMs: 0, // actual elapsed time in current phase
      interval: null
    };
    
    // Keep-awake (Screen Wake Lock)
    this.wakeLock = null;
    this.wakeLockSupported = 'wakeLock' in navigator;
    
    this.loadData();
    this.setupEventListeners();
    this.initializeUI();
    
    // Set a tick timer for running timers
    this.tickInterval = setInterval(() => this.updateRunningTimers(), 1000);
    
    // Check if day changed (between sessions)
    this.checkDayRollover();
    
    // Schedule notifications
    this.scheduleNotifications();
    
    // Apply saved theme
    this.applyTheme();
    
    // Initialise keep-awake indicator & re-acquire wake lock when tab becomes visible again
    this.updateAwakeIndicator(false);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        this.updateKeepAwake();
      }
    });

    // Recover any timer that was running when the page closed unexpectedly (crash/shutdown)
    this.recoverActiveTimer();

    // Commit running timers automatically when the page closes (refresh, tab close, navigate away)
    const autoSave = () => {
      if (Object.keys(this.activeTimers).length > 0) {
        this.commitActiveTimers();
        this.saveData();
      }
    };
    window.addEventListener('beforeunload', autoSave);
    window.addEventListener('pagehide', autoSave);

    // Initialise GitHub sync (pull linked data on startup, poll for changes)
    this.initSync();
    this.initSyncUI();

    // Initialise file storage (auto-loads/restores a shared data.json when possible)
    this.initFileStorage();
  }

  applyTheme() {
    const root = document.documentElement;
    const accent = this.theme.accent;
    root.style.setProperty('--accent', accent);
    root.style.setProperty('--accent-hover', this.theme.accentHover);

    // Warm, cozy, airy light palette derived from the accent.
    // Backgrounds are soft cream/off-white tones so the app feels inviting,
    // not a heavy dark "*fishy" wall of color.
    const cream = '#faf6ef';       // warm off-white base
    const cream2 = '#f3ece0';      // slightly deeper cream for secondary surfaces
    const sand = '#fffdf8';        // card / raised surface
    const warmBorder = '#e6dcc9';  // soft warm border

    // Text: warm dark brown-grey for readability on light backgrounds
    const textPrimary = '#3a322a';
    const textSecondary = '#776a58';

    // Progress track that fits the light theme
    root.style.setProperty('--bg-primary', cream);
    root.style.setProperty('--bg-secondary', cream2);
    root.style.setProperty('--bg-card', sand);
    root.style.setProperty('--border', warmBorder);
    root.style.setProperty('--progress-bg', '#e9dfcd');
    root.style.setProperty('--text-primary', textPrimary);
    root.style.setProperty('--text-secondary', textSecondary);
    root.style.setProperty('--scrollbar', '#d9cdb6');
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
    void isDarkBg;
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
    this.rollRepeatingTasks();
  }

  // ---- CHECKLISTS ----

  // Get all checklist lists for a subject key (key = '__main__' for the global/main list)
  getSubjectChecklists(subjectKey) {
    this.ensureChecklistsExams();
    if (!this.data.checklists[subjectKey]) this.data.checklists[subjectKey] = [];
    return this.data.checklists[subjectKey];
  }

  addChecklist(subjectKey, name) {
    const lists = this.getSubjectChecklists(subjectKey);
    lists.push({
      id: this.nextSessionId(),
      name: name || 'New list',
      tasks: []
    });
    this.saveData();
    this.refreshTaskViews();
  }

  renameChecklist(subjectKey, listId, newName) {
    const lists = this.getSubjectChecklists(subjectKey);
    const list = lists.find(l => l.id === listId);
    if (list) {
      list.name = newName;
      this.saveData();
    }
  }

  deleteChecklist(subjectKey, listId) {
    const lists = this.getSubjectChecklists(subjectKey);
    this.data.checklists[subjectKey] = lists.filter(l => l.id !== listId);
    this.saveData();
    this.refreshTaskViews();
  }

  addTask(subjectKey, listId, text, dueMs = null, repeat = 'none') {
    const list = this.getSubjectChecklists(subjectKey).find(l => l.id === listId);
    if (!list) return;
    list.tasks.push({
      id: this.nextSessionId(),
      text,
      due: dueMs,          // epoch ms timestamp or null
      repeat,              // 'none' | 'daily' | 'weekly'
      done: false,
      doneDate: null
    });
    this.saveData();
    this.refreshTaskViews();
  }

  toggleTask(subjectKey, listId, taskId) {
    const list = this.getSubjectChecklists(subjectKey).find(l => l.id === listId);
    if (!list) return;
    const task = list.tasks.find(t => t.id === taskId);
    if (!task) return;
    // Overdue handling: touching an overdue task deletes it
    if (task.due && task.due < Date.now() && !task.done) {
      this.deleteTask(subjectKey, listId, taskId);
      return;
    }
    task.done = !task.done;
    task.doneDate = task.done ? Date.now() : null;
    this.saveData();
    this.refreshTaskViews();
  }

  deleteTask(subjectKey, listId, taskId) {
    const list = this.getSubjectChecklists(subjectKey).find(l => l.id === listId);
    if (!list) return;
    list.tasks = list.tasks.filter(t => t.id !== taskId);
    this.saveData();
    this.refreshTaskViews();
  }

  isTaskOverdue(task) {
    return !!task.due && task.due < Date.now() && !task.done;
  }

  // Cycle-based repeat: completed daily/weekly tasks reappear (unchecked) on the new cycle
  rollRepeatingTasks() {
    if (!this.data.checklists) this.data.checklists = {};
    this.ensureChecklistsExams();
    const MAX_RECUR = 500; // safety cap
    Object.keys(this.data.checklists).forEach(subjectKey => {
      this.data.checklists[subjectKey].forEach(list => {
        list.tasks.forEach(task => {
          if (!task.done) return;
          if (!task.repeat || task.repeat === 'none') return;
          let shouldRoll = false;
          if (task.repeat === 'daily') {
            if (!task.doneDate) { task.done = false; return; }
            const doneDay = this.formatDateKey(new Date(task.doneDate));
            if (doneDay !== this.getTodayKey()) shouldRoll = true;
          } else if (task.repeat === 'weekly') {
            if (!task.doneDate) { task.done = false; return; }
            const doneMonday = this.getMondayKey(new Date(task.doneDate));
            if (doneMonday !== this.getMondayKey(new Date())) shouldRoll = true;
          }
          if (shouldRoll) {
            task.done = false;
            task.doneDate = null;
          }
        });
        // Enforce cap
        if (list.tasks.length > MAX_RECUR) list.tasks = list.tasks.slice(-MAX_RECUR);
      });
    });
    this.saveData();
  }

  getMondayKey(date) {
    const d = new Date(date);
    const day = d.getDay();
    const diff = day === 0 ? 6 : day - 1;
    d.setDate(d.getDate() - diff);
    return this.formatDateKey(d);
  }

  // ---- EXAMS ----

  getExams() {
    this.ensureChecklistsExams();
    return this.data.exams;
  }

  addExam(subject, name, dateIso, reviewTarget = '') {
    this.ensureChecklistsExams();
    this.data.exams.push({
      id: this.nextSessionId(),
      subject,
      name,
      date: dateIso,       // ISO datetime
      reviewTarget,
      created: Date.now()
    });
    this.saveData();
    this.refreshTaskViews();
  }

  deleteExam(examId) {
    this.ensureChecklistsExams();
    this.data.exams = this.data.exams.filter(e => e.id !== examId);
    this.saveData();
    this.refreshTaskViews();
  }

  getExamCountdown(exam) {
    const target = new Date(exam.date).getTime();
    const now = Date.now();
    const diff = target - now;
    if (diff <= 0) return { passed: true, label: 'DONE' };
    const days = Math.floor(diff / 86400000);
    const hours = Math.floor((diff % 86400000) / 3600000);
    const mins = Math.floor((diff % 3600000) / 60000);
    let label;
    if (days > 0) label = `${days}d ${hours}h`;
    else if (hours > 0) label = `${hours}h ${mins}m`;
    else label = `${mins}m`;
    return { passed: false, label, urgent: days === 0 };
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
      if (this.data.settings.pomodoroSettings) this.pomodoroSettings = {...this.pomodoroSettings, ...this.data.settings.pomodoroSettings};
      if (this.data.settings.theme) this.theme = {...this.theme, ...this.data.settings.theme};
      if (this.data.settings.timerColors) this.timerColors = {...this.timerColors, ...this.data.settings.timerColors};
    } else {
      this.data.settings = {
        subjectGoal: this.subjectGoal,
        notificationsEnabled: this.notificationsEnabled,
        reminderTime: this.reminderTime,
        pomodoroSettings: this.pomodoroSettings,
        theme: this.theme,
        timerColors: this.timerColors
      };
    }
    
    // Ensure subjects are set
    if (this.data.subjects && this.data.subjects.length > 0) {
      this.subjects = this.data.subjects;
    }
    
    // Ensure checklists & exams exist
    this.ensureChecklistsExams();
    this.rollRepeatingTasks();
    
    // Persist normalised data WITHOUT bumping the sync timestamp (pure load, not an edit)
    this.saveData(false);
  }

  getDefaultData() {
    return {
      lastActiveDate: this.getTodayKey(),
      subjects: this.subjects,
      days: {
        [this.getTodayKey()]: this.createEmptyDay()
      },
      checklists: {},
      exams: [],
      settings: {
        subjectGoal: this.defaultSubjectGoal,
        notificationsEnabled: false,
        reminderTime: '09:00',
        pomodoroSettings: this.pomodoroSettings,
        theme: this.theme,
        timerColors: this.timerColors
      }
    };
  }

    // Ensure checklists and exams structures exist (for backward compatibility with older saves)
    ensureChecklistsExams() {
      if (!this.data.checklists) this.data.checklists = {};
      if (!Array.isArray(this.data.exams)) this.data.exams = [];
    }

  saveData(bumpMod = true) {
    this.data.lastActiveDate = this.getTodayKey();
    if (!this.data.days[this.getTodayKey()]) {
      this.data.days[this.getTodayKey()] = this.createEmptyDay();
    }
    if (bumpMod) {
      this.data.lastModified = Date.now();
    }
    // Keep a localStorage mirror as a safety net, but the real store is the file
    localStorage.setItem('studyTracker', JSON.stringify(this.data));
    // Persist to the real data.json file when one is active
    if (this.fileStorageActive && this.fileHandle) {
      this.writeFileData();
    }
    // Debounced push to the linked GitHub repo (only for real changes)
    if (bumpMod) this.scheduleSyncPush();
  }

  // ---- REAL FILE STORAGE (File System Access API) ----

  supportsFileApi() {
    return 'showOpenFilePicker' in window && 'showSaveFilePicker' in window;
  }

  initFileStorage() {
    if (!this.supportsFileApi()) return;
    // Bind the Settings buttons
    const openBtn = document.getElementById('file-open');
    const newBtn = document.getElementById('file-new');
    const offBtn = document.getElementById('file-off');
    if (openBtn) openBtn.addEventListener('click', () => this.chooseDataFile());
    if (newBtn) newBtn.addEventListener('click', () => this.createDataFile());
    if (offBtn) offBtn.addEventListener('click', () => this.unlinkFile());
    try {
      const raw = localStorage.getItem('studyTrackerFileHandle');
      if (raw) this.restoreFileHandle(JSON.parse(raw));
    } catch (e) {}
  }

  async restoreFileHandle(desc) {
    // Browsers do not let a page silently re-acquire a file handle across sessions,
    // so we only remember that the user previously chose a file. On each new open
    // of the app they pick the same file once (browser security), then auto-saving
    // to it resumes. We surface this in the Settings status line.
    this.fileHandle = null;
    this.fileStorageActive = false;
    this.updateFileStatus('A file was used before. Open your data.json again to resume auto-saving to it.');
  }

  updateFileStatus(msg) {
    const el = document.getElementById('file-status');
    if (el) el.innerHTML = msg;
  }

  async chooseDataFile() {
    if (!this.supportsFileApi()) {
      this.showToast('This browser does not support file storage. Use Chrome/Edge.');
      return false;
    }
    try {
      const [handle] = await window.showOpenFilePicker({
        types: [{ description: 'Study data', accept: { 'application/json': ['.json'] } }],
        multiple: false
      });
      this.fileHandle = handle;
      let loaded = false;
      // Try to read existing content from it
      try {
        const file = await handle.getFile();
        const text = await file.text();
        if (text && text.trim()) {
          const parsed = JSON.parse(text);
          if (parsed && parsed.days) {
            this.data = parsed;
            loaded = true;
          }
        }
      } catch (e) {}
      if (!loaded) {
        // New/empty file: adopt current in-memory data
      }
      this.fileStorageActive = true;
      try { localStorage.setItem('studyTrackerFileHandle', JSON.stringify({ name: handle.name })); } catch (e) {}
      await this.writeFileData();
      this.reloadAfterSync();
      this.showToast('Now saving to ' + handle.name + '.');
      return true;
    } catch (e) {
      if (e && (e.name === 'NotAllowedError' || e.name === 'SecurityError' || (e.message && /denied|blocked|permission/i.test(e.message)))) {
        this.showToast('Blocked by the browser. Allow file access in Site settings (lock icon) and try again.');
      }
      // Otherwise the user simply cancelled the picker
      return false;
    }
  }

  async createDataFile() {
    if (!this.supportsFileApi()) {
      this.showToast('This browser does not support file storage. Use Chrome/Edge.');
      return false;
    }
    try {
      const suggested = 'data.json';
      const handle = await window.showSaveFilePicker({
        suggestedName: suggested,
        types: [{ description: 'Study data', accept: { 'application/json': ['.json'] } }]
      });
      this.fileHandle = handle;
      this.fileStorageActive = true;
      try { localStorage.setItem('studyTrackerFileHandle', JSON.stringify({ name: handle.name })); } catch (e) {}
      await this.writeFileData();
      this.reloadAfterSync();
      this.showToast('Now saving to ' + handle.name + '.');
      return true;
    } catch (e) {
      if (e && (e.name === 'NotAllowedError' || e.name === 'SecurityError' || (e.message && /denied|blocked|permission/i.test(e.message)))) {
        this.showToast('Blocked by the browser. Allow file access in Site settings (lock icon) and try again.');
      }
      // Otherwise the user simply cancelled the picker
      return false;
    }
  }

  async writeFileData() {
    if (!this.fileHandle) return;
    try {
      const writable = await this.fileHandle.createWritable();
      await writable.write(JSON.stringify(this.data, null, 2));
      await writable.close();
    } catch (e) {}
  }

  unlinkFile() {
    this.fileHandle = null;
    this.fileStorageActive = false;
    try { localStorage.removeItem('studyTrackerFileHandle'); } catch (e) {}
    this.showToast('File storage turned off — using local browser storage.');
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
    let addMs = ms;
    // Don't let a single recorded time push the day's total into extreme negative
    if (day[subject].time + addMs < 0) addMs = -day[subject].time;
    day[subject].time += addMs;
    if (addMs > 0) {
      day[subject].sessions.push({
        id: this.nextSessionId(),
        ms: addMs,
        timestamp: Date.now()
      });
    }
    
    // Save session history max 100 per subject per day
    if (day[subject].sessions.length > 100) {
      day[subject].sessions = day[subject].sessions.slice(-100);
    }
    this.saveData();
    this.refresh();
  }

  nextSessionId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  // Remove a session by id for a subject on a given dateKey (defaults to today)
  removeSession(subject, sessionId, dateKey = null) {
    const key = dateKey || this.getTodayKey();
    const day = this.getDayData(key);
    if (!day[subject] || !day[subject].sessions) return false;
    const idx = day[subject].sessions.findIndex(s => String(s.id) === String(sessionId));
    if (idx === -1) return false;
    const removed = day[subject].sessions[idx];
    day[subject].time = Math.max(0, day[subject].time - removed.ms);
    if (removed.type === 'pomodoro') {
      day[subject].pomodoros = Math.max(0, (day[subject].pomodoros || 0) - 1);
    }
    day[subject].sessions.splice(idx, 1);
    this.saveData();
    this.refresh();
    return true;
  }

  // Adjust a specific session by a delta (positive adds, negative removes)
  adjustSession(subject, sessionId, deltaMs, dateKey = null) {
    const key = dateKey || this.getTodayKey();
    const day = this.getDayData(key);
    if (!day[subject] || !day[subject].sessions) return false;
    const s = day[subject].sessions.find(x => String(x.id) === String(sessionId));
    if (!s) return false;
    const newMs = s.ms + deltaMs;
    if (newMs < 0) deltaMs = -s.ms; // clamp to zero
    const applied = deltaMs;
    day[subject].time = Math.max(0, day[subject].time + applied);
    s.ms += applied;
    this.saveData();
    this.refresh();
    return true;
  }

  // List today's sessions for a subject
  getTodaySessions(subject) {
    const day = this.getDayData(this.getTodayKey());
    if (!day[subject] || !day[subject].sessions) return [];
    return [...day[subject].sessions].reverse(); // newest first
  }

  // Timer functions
  startTimer(subject) {
    // Resume if paused, otherwise start fresh
    if (this.activeTimers[subject]) {
      const timer = this.activeTimers[subject];
      if (!timer.running) {
        timer.running = true;
        timer.startedAt = Date.now();
      }
    } else {
      this.activeTimers[subject] = {
        base: 0,
        running: true,
        startedAt: Date.now()
      };
    }
    this.requestKeepAwake();
  }

  pauseTimer(subject) {
    if (!this.activeTimers[subject]) return;
    const timer = this.activeTimers[subject];
    if (timer.running) {
      timer.base = this.getTimerElapsed(subject);
      timer.running = false;
    }
    this.updateKeepAwake();
  }

  // Compute the accumulated elapsed ms (frozen while paused, live while running)
  getTimerElapsed(subject) {
    const timer = this.activeTimers[subject];
    if (!timer) return 0;
    if (timer.running) {
      return timer.base + (Date.now() - timer.startedAt);
    }
    return timer.base;
  }

  isTimerPaused(subject) {
    return !!(this.activeTimers[subject] && !this.activeTimers[subject].running);
  }

  // Save the accumulated time to the subject, then clear the stopwatch
  finishTimer(subject) {
    if (!this.activeTimers[subject]) return;
    const elapsed = this.getTimerElapsed(subject);
    if (elapsed > 0) {
      this.addTime(subject, elapsed);
    }
    delete this.activeTimers[subject];
    this.updateKeepAwake();
  }

  resetTimer(subject) {
    if (this.activeTimers[subject]) {
      delete this.activeTimers[subject];
    }
    this.updateKeepAwake();
  }

  // ---- AUTO-SAVE ON REFRESH / UNEXPECTED CLOSE ----
  // Persist the first (or current) running timer so its elapsed time isn't lost
  // if the page closes (refresh, tab close, or PC shutdown) before pressing Done.
  saveActiveTimerState() {
    const subjects = Object.keys(this.activeTimers);
    if (subjects.length === 0) return;
    const subject = subjects[0];
    const t = this.activeTimers[subject];
    if (!t) return;
    const state = {
      subject,
      base: t.base,
      running: t.running,
      startedAt: t.startedAt,
      savedAt: Date.now()
    };
    try { localStorage.setItem('studyTrackerActiveTimer', JSON.stringify(state)); } catch (e) {}
  }

  clearActiveTimerState() {
    try { localStorage.removeItem('studyTrackerActiveTimer'); } catch (e) {}
  }

  // Commit all running timers to their subjects (used on page exit).
  commitActiveTimers() {
    Object.keys(this.activeTimers).forEach(subject => {
      const elapsed = this.getTimerElapsed(subject);
      if (elapsed > 0) {
        this.addTime(subject, elapsed);
      }
      delete this.activeTimers[subject];
    });
    this.clearActiveTimerState();
    this.updateKeepAwake();
  }

  // If the page closed without running pagehide (hard crash / sudden shutdown),
  // the persisted timer state is still there — commit its elapsed time once on reload.
  recoverActiveTimer() {
    let state = null;
    try { state = JSON.parse(localStorage.getItem('studyTrackerActiveTimer')); } catch (e) { state = null; }
    if (!state || !state.subject) return;
    if (!this.subjects.includes(state.subject)) {
      this.clearActiveTimerState();
      return;
    }
    let elapsed = state.base;
    if (state.running) {
      elapsed += Date.now() - state.startedAt;
    }
    this.clearActiveTimerState();
    if (elapsed > 0) {
      this.addTime(state.subject, elapsed);
      this.saveData();
      this.showToast(`🔁 Recovered ${this.formatTimer(elapsed)} in ${state.subject} from an unexpected close.`);
    }
  }

  hasActiveTimer(subject) {
    return !!this.activeTimers[subject];
  }

  // Keep-screen-awake logic (prevents the PC from sleeping while a timer is running)
  async requestKeepAwake() {
    if (!this.wakeLockSupported) return;
    if (this.wakeLock) return; // already held
    try {
      this.wakeLock = await navigator.wakeLock.request('screen');
      this.updateAwakeIndicator(true);
      this.wakeLock.addEventListener('release', () => {
        this.wakeLock = null;
        // Re-acquire if a timer is still running (can auto-release on tab switch)
        if (this.anyTimerRunning() || this.pomodoro.running) {
          this.requestKeepAwake();
        } else {
          this.updateAwakeIndicator(false);
        }
      });
    } catch (err) {
      this.wakeLock = null;
      this.updateAwakeIndicator(false);
    }
  }

  releaseKeepAwake() {
    if (this.wakeLock) {
      try { this.wakeLock.release(); } catch (e) {}
      this.wakeLock = null;
    }
    this.updateAwakeIndicator(false);
  }

  anyTimerRunning() {
    return Object.keys(this.activeTimers).length > 0;
  }

  updateKeepAwake() {
    const shouldHold = this.anyTimerRunning() || this.pomodoro.running;
    if (shouldHold) {
      this.requestKeepAwake();
    } else {
      this.releaseKeepAwake();
    }
  }

  updateAwakeIndicator(active) {
    const el = document.getElementById('awake-indicator');
    if (!el) return;
    if (active) {
      el.classList.add('active');
      el.textContent = '🟢 Keep-awake active — PC won\'t sleep while timer runs';
    } else {
      el.classList.remove('active');
      el.textContent = 'Keep-awake (prevents PC sleep while a timer runs)';
    }
    el.title = this.wakeLockSupported
      ? (active ? 'Screen will stay awake' : 'Wake lock released')
      : 'Screen Wake Lock not supported in this browser';
  }

  updateRunningTimers() {
    if (Object.keys(this.activeTimers).length === 0) {
      // No running timers left — make sure a stale persisted state doesn't linger
      try { localStorage.removeItem('studyTrackerActiveTimer'); } catch (e) {}
      return;
    }
    
    let needsRefresh = false;
    Object.keys(this.activeTimers).forEach(subject => {
      const timer = this.activeTimers[subject];
      const elapsedMs = this.getTimerElapsed(subject);
      const totalMs = this.getSubjectTime(this.getTodayKey(), subject) + elapsedMs;
      const goalMs = this.subjectGoal * 3600000;
      
      // Update timer display in modal / fullscreen / mini
      if (this.currentModalSubject === subject) {
        const display = document.getElementById('timer-display');
        if (display) {
          display.textContent = this.formatTimer(elapsedMs);
        }
      }
      
      // Update fullscreen clocks live
      if (!document.getElementById('fullscreen-overlay').classList.contains('hidden')) {
        const fs = document.getElementById('fs-display');
        if (fs) fs.textContent = this.formatTimer(elapsedMs);
      }
      // Sync the floating Picture-in-Picture window live
      if (this.pipWindow && this.currentModalSubject === subject) {
        this.syncPipAll();
      }
      
      this.updateTimerButtonStates(subject);
      
      // Persist the running timer so a refresh/crash doesn't lose it
      this.saveActiveTimerState();
      
      // Show completion notification when reaching goal
      const currentStationary = this.getSubjectTime(this.getTodayKey(), subject);
      if (currentStationary < goalMs && totalMs >= goalMs) {
        this.showNotification(`🎉 ${subject} study goal achieved for today!`);
        needsRefresh = true;
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
      this.subjects.forEach(subject => {
        const weekTime = this.getSubjectWeekTime(subject);
        const goalMs = this.subjectGoal * 3600000;
        if (weekTime < goalMs) {
          this.showNotification(`${subject}: ${this.getFormattedTime(goalMs - weekTime)} left this week to hit your ${this.subjectGoal}h weekly goal.`);
        }
      });
    }
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
    const goTasks = document.getElementById('today-go-tasks');
    if (goTasks) goTasks.addEventListener('click', () => this.switchView('tasks'));
    
    // Timer modal controls
    document.getElementById('timer-start').addEventListener('click', () => this.handleTimerStart());
    document.getElementById('timer-pause').addEventListener('click', () => this.handleTimerPause());
    document.getElementById('timer-done').addEventListener('click', () => this.handleTimerDone());
    document.getElementById('timer-reset').addEventListener('click', () => this.handleTimerReset());
    document.getElementById('timer-close').addEventListener('click', () => this.closeTimerModal());
    document.getElementById('timer-mini').addEventListener('click', () => this.openMini());
    document.getElementById('manual-add-btn').addEventListener('click', () => this.handleManualAdd());
    document.getElementById('remove-time-btn').addEventListener('click', () => this.handleRemoveTime());

    // Custom note for the timer
    const noteInput = document.getElementById('timer-note');
    if (noteInput) {
      noteInput.addEventListener('input', (e) => {
        this.timerNote = e.target.value;
        this.applyTimerNote();
      });
    }
    
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
    document.getElementById('fs-start').addEventListener('click', () => this.handleTimerStart());
    document.getElementById('fs-pause').addEventListener('click', () => this.handleTimerPause());
    document.getElementById('fs-done').addEventListener('click', () => this.handleTimerDone());
    document.getElementById('fs-reset').addEventListener('click', () => this.handleTimerReset());
    document.getElementById('fs-mini').addEventListener('click', () => this.openMini());
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
    
    // ---- Tasks & Exams listeners ----
    document.getElementById('add-exam-btn').addEventListener('click', () => this.openExamModal());
    document.getElementById('exam-modal-close').addEventListener('click', () => this.closeExamModal());
    document.getElementById('exam-modal-cancel').addEventListener('click', () => this.closeExamModal());
    document.getElementById('exam-modal-save').addEventListener('click', () => this.saveExam());
    document.getElementById('exam-modal').addEventListener('click', (e) => {
      if (e.target === document.getElementById('exam-modal')) this.closeExamModal();
    });
    
    document.getElementById('list-modal-close').addEventListener('click', () => this.closeListModal());
    document.getElementById('list-modal-cancel').addEventListener('click', () => this.closeListModal());
    document.getElementById('list-modal-save').addEventListener('click', () => this.saveList());
    document.getElementById('list-modal').addEventListener('click', (e) => {
      if (e.target === document.getElementById('list-modal')) this.closeListModal();
    });
    
    document.getElementById('task-modal-close').addEventListener('click', () => this.closeTaskModal());
    document.getElementById('task-modal-cancel').addEventListener('click', () => this.closeTaskModal());
    document.getElementById('task-modal-save').addEventListener('click', () => this.saveTask());
    document.getElementById('task-modal').addEventListener('click', (e) => {
      if (e.target === document.getElementById('task-modal')) this.closeTaskModal();
    });
    
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        this.closeTimerModal();
        this.closeMini();
        this.closeAllModals();
      }
    });
    
    // When browser fullscreen is left (e.g. via Escape), hide our overlay too
    document.addEventListener('fullscreenchange', () => {
      if (!document.fullscreenElement) {
        document.getElementById('fullscreen-overlay').classList.add('hidden');
      }
    });
  }

  closeAllModals() {
    ['list-modal', 'task-modal', 'exam-modal'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.classList.add('hidden');
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
    if (view === 'tasks') {
      this.renderTasks();
    }
    if (view === 'today') {
      this.renderToday();
    }
  }

  initializeUI() {
    this.currentModalSubject = null;
    this.currentWeekOffset = 0;
    this.currentTaskSubject = '__main__';
    
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

    this.renderTodayTasks();
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

    const noteInput = document.getElementById('timer-note');
    if (noteInput) noteInput.value = this.timerNote;
    this.applyTimerNote();
    
    document.getElementById('timer-display').textContent = this.formatTimer(this.getTimerElapsed(subject));
    this.updateTimerButtonStates(subject);
    
    // Reset pomodoro display for this subject
    this.resetPomodoroForSubject();
    this.renderPomodoroCount();
    this.renderSessions(subject);
    
    document.getElementById('timer-modal').classList.remove('hidden');
  }

  // Central updater for stopwatch button states (modal, fullscreen, mini)
  updateTimerButtonStates(subject) {
    if (!this.currentModalSubject) return;
    const running = this.hasActiveTimer(subject) && !this.isTimerPaused(subject);
    const paused = this.isTimerPaused(subject);
    const active = this.hasActiveTimer(subject);

    // Modal
    const mStart = document.getElementById('timer-start');
    const mPause = document.getElementById('timer-pause');
    const mDone = document.getElementById('timer-done');
    if (mStart) { mStart.disabled = running; mStart.textContent = paused ? 'Resume' : 'Start'; }
    if (mPause) { mPause.disabled = !running; mPause.textContent = paused ? 'Paused' : 'Pause'; }
    if (mDone) mDone.disabled = !active;

    // Fullscreen
    const fStart = document.getElementById('fs-start');
    const fPause = document.getElementById('fs-pause');
    const fDone = document.getElementById('fs-done');
    if (fStart) { fStart.disabled = running; fStart.textContent = paused ? 'Resume' : 'Start'; }
    if (fPause) { fPause.disabled = !running; fPause.textContent = paused ? 'Paused' : 'Pause'; }
    if (fDone) fDone.disabled = !active;

    // Floating Picture-in-Picture buttons
    this.updatePipButtonStates();
  }

  renderSessions(subject) {
    const list = document.getElementById('sessions-list');
    if (!list) return;
    const sessions = this.getTodaySessions(subject);
    if (sessions.length === 0) {
      list.innerHTML = '<div class="session-empty">No sessions recorded today yet.</div>';
      return;
    }
    list.innerHTML = '';
    sessions.forEach(s => {
      const row = document.createElement('div');
      row.className = 'session-row';
      const label = s.type === 'pomodoro' ? `🍅 ${this.formatTimeStopped(s.ms)}` : this.formatCompactTime(s.ms);
      row.innerHTML = `
        <span class="session-info">
          <span class="session-time">${label}</span>
          <button class="session-btn minus" data-id="${s.id}">− 5m</button>
          <button class="session-btn minus" data-id="${s.id}">− 30m</button>
        </span>
        <button class="session-delete" data-id="${s.id}" title="Delete this session">✕</button>
      `;
      // Adjust buttons
      row.querySelectorAll('.session-btn.minus').forEach(btn => {
        btn.addEventListener('click', () => {
          const mins = btn.textContent.includes('5') ? 5 : 30;
          this.adjustSession(subject, btn.dataset.id, -mins * 60000);
          this.renderSessions(subject);
          this.renderTimerMetrics();
        });
      });
      // Delete button
      row.querySelector('.session-delete').addEventListener('click', () => {
        this.removeSession(subject, row.querySelector('.session-delete').dataset.id);
        this.renderSessions(subject);
        this.renderTimerMetrics();
      });
      list.appendChild(row);
    });
  }

  renderTimerMetrics() {
    if (!this.currentModalSubject) return;
    // Keep the daily-readout in the card in sync
    this.refresh();
  }

  handleRemoveTime() {
    if (!this.currentModalSubject) return;
    const hours = parseFloat(document.getElementById('remove-hours').value) || 0;
    const minutes = parseFloat(document.getElementById('remove-minutes').value) || 0;
    const ms = (hours * 3600 + minutes * 60) * 1000;
    if (ms <= 0) {
      this.showToast('Enter an amount to remove.');
      return;
    }
    this.addTime(this.currentModalSubject, -ms);
    document.getElementById('remove-hours').value = '';
    document.getElementById('remove-minutes').value = '';
    this.renderSessions(this.currentModalSubject);
    this.refresh();
    this.showToast(`Removed ${this.formatCompactTime(ms)} from ${this.currentModalSubject}.`);
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
    this.requestKeepAwake();
  }

  pomodoroStop() {
    this.pomodoro.running = false;
    if (this.pomodoro.interval) {
      clearInterval(this.pomodoro.interval);
      this.pomodoro.interval = null;
    }
    this.renderPomodoroDisplay(false);
    this.updateKeepAwake();
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
    this.updateKeepAwake();
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
    day[subject].sessions.push({ id: this.nextSessionId(), ms, timestamp: Date.now(), type: 'pomodoro' });
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
    this.applyTimerNote();
    this.updateTimerButtonStates(this.currentModalSubject);
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
    display.textContent = this.formatTimer(this.getTimerElapsed(subject));
    // Show today's total for this subject
    const total = this.getSubjectTime(this.getTodayKey(), subject);
    const goal = this.subjectGoal;
    document.getElementById('fs-pomodoro').textContent = `Today: ${this.formatTime(total)} / ${goal}h`;
  }

  // Show the user's custom note in the timer modal, fullscreen and mini
  applyTimerNote() {
    const note = this.timerNote || '';
    const fsNote = document.getElementById('fs-note');
    if (fsNote) {
      fsNote.textContent = note;
      fsNote.style.display = note ? '' : 'none';
    }
    // Sync the floating Picture-in-Picture window
    if (this.pipWindow && this.pipWindow.document) {
      const pipNote = this.pipWindow.document.getElementById('pip-note');
      if (pipNote) {
        pipNote.textContent = note;
        pipNote.style.display = note ? '' : 'none';
      }
    }
  }

  handleTimerStart() {
    if (!this.currentModalSubject) return;
    this.startTimer(this.currentModalSubject);
    this.updateTimerButtonStates(this.currentModalSubject);
    this.updateTimerDisplays();
    this.refresh();
  }

  handleTimerPause() {
    if (!this.currentModalSubject) return;
    this.pauseTimer(this.currentModalSubject);
    this.updateTimerButtonStates(this.currentModalSubject);
    this.updateTimerDisplays();
  }

  handleTimerDone() {
    if (!this.currentModalSubject) return;
    this.finishTimer(this.currentModalSubject);
    this.clearActiveTimerState();
    this.updateTimerButtonStates(this.currentModalSubject);
    this.updateTimerDisplays();
    // Close any open surfaces for this subject
    this.closeFullscreen();
    this.closeMini();
    this.closeTimerModal();
    this.refresh();
  }

  handleTimerReset() {
    if (!this.currentModalSubject) return;
    const elapsed = this.getTimerElapsed(this.currentModalSubject);
    if (elapsed > 0) {
      const ok = confirm(`Reset the ${this.currentModalSubject} timer?\n\nThis will DISCARD the elapsed time (${this.formatTimer(elapsed)}) WITHOUT saving it.`);
      if (!ok) return;
    }
    this.resetTimer(this.currentModalSubject);
    try { localStorage.removeItem('studyTrackerActiveTimer'); } catch (e) {}
    this.updateTimerButtonStates(this.currentModalSubject);
    this.updateTimerDisplays();
    this.refresh();
  }

  // Update the running-clock displays in modal, fullscreen and mini
  updateTimerDisplays() {
    const subject = this.currentModalSubject;
    if (!subject) return;
    const text = this.formatTimer(this.getTimerElapsed(subject));
    const m = document.getElementById('timer-display');
    if (m) m.textContent = text;
    const f = document.getElementById('fs-display');
    if (f && !document.getElementById('fullscreen-overlay').classList.contains('hidden')) f.textContent = text;
    // Sync the floating Picture-in-Picture window
    this.syncPipClock();
  }

  // ---- MINI MODE (Document Picture-in-Picture floating window) ----
  openMini() {
    if (!this.currentModalSubject) return;
    // Close the normal timer modal and fullscreen so mini is the view
    document.getElementById('timer-modal').classList.add('hidden');
    this.closeFullscreen();
    // A floating window is already open: just re-point it at the current subject
    if (this.pipWindow) {
      this.syncPipAll();
      return;
    }
    // Float a real always-on-top window (Document Picture-in-Picture)
    if (window.documentPictureInPicture) {
      this.openMiniPip();
    }
  }

  // Float a real, always-on-top window over EVERYTHING on the screen (browser-native)
  async openMiniPip() {
    const subject = this.currentModalSubject;
    if (!subject) return;
    try {
      const pipWin = await window.documentPictureInPicture.requestWindow({
        width: 280,
        height: 320,
        copyStyleSheets: true
      });
      pipWin.document.title = 'Study Timer';
      const doc = pipWin.document;

      // Re-apply the Google Fonts so Space Grotesk / Inter render in the float too
      const fontLink = doc.createElement('link');
      fontLink.rel = 'stylesheet';
      fontLink.href = 'https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;600;700&family=Inter:wght@400;500;600;700&display=swap';
      doc.head.appendChild(fontLink);

      // Pull the live warm theme so the float is decorated to match, even though
      // the PiP window can't reliably inherit the page's stylesheet variables.
      const rootCS = getComputedStyle(document.documentElement);
      const accent = this.theme.accent || rootCS.getPropertyValue('--accent').trim() || '#d97706';
      const cardBg = this.timerColors.bg || '#000000';
      const cardText = this.timerColors.text || '#ffffff';
      const fontMain = "'Space Grotesk','Inter',sans-serif";

      // Build the floating mini UI with fully inline styles (guaranteed decoration)
      const mkStyle = (extra) => `font-family:${fontMain};letter-spacing:0.3px;${extra}`;
      doc.body.style.margin = '0';
      doc.body.style.padding = '0';
      doc.body.style.overflow = 'hidden';
      doc.body.style.background = 'rgba(20, 18, 16, 0.92)';
      doc.body.style.color = cardText;

      doc.body.innerHTML = `
        <div style="box-sizing:border-box;height:100vh;${mkStyle('display:flex;flex-direction:column;padding:18px 16px;gap:12px;background:linear-gradient(160deg,#2a241f 0%,' + cardBg + ' 100%);border:1px solid rgba(255,255,255,0.14);border-radius:20px;')}">
          <div style="display:flex;align-items:center;gap:8px;min-height:28px;">
            <span id="pip-subject" style="flex:1;font-weight:700;font-size:0.95rem;text-transform:uppercase;letter-spacing:1.2px;color:${cardText};opacity:0.92;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;"></span>
            <button id="pip-fullscreen" title="Fullscreen" style="width:28px;height:28px;border-radius:8px;border:1px solid rgba(255,255,255,0.35);background:transparent;color:${cardText};cursor:pointer;font-size:0.85rem;opacity:0.85;">&#x26F6;</button>
            <button id="pip-close" title="Close mini" style="width:28px;height:28px;border-radius:8px;border:1px solid rgba(255,255,255,0.35);background:transparent;color:${cardText};cursor:pointer;font-size:0.85rem;opacity:0.85;">&#x2715;</button>
          </div>
          <div id="pip-note" style="display:none;font-family:${fontMain};font-style:italic;font-size:0.85rem;color:${cardText};opacity:0.95;text-align:center;padding:6px 10px;border-radius:10px;background:rgba(255,255,255,0.10);"></div>
          <div id="pip-display" style="font-family:'Space Grotesk',monospace;font-weight:700;font-size:2.9rem;color:${cardText};text-align:center;line-height:1.15;margin:6px 0 2px;font-variant-numeric:tabular-nums;">00:00:00</div>
          <div id="pip-pomodoro" style="font-family:${fontMain};font-size:0.8rem;text-align:center;color:${cardText};opacity:0.75;"></div>
          <div style="display:flex;gap:8px;margin-top:auto;">
            <button id="pip-start" style="flex:1;padding:10px 0;border-radius:12px;border:none;background:${accent};color:#1c1917;font-family:${fontMain};font-weight:700;font-size:0.85rem;cursor:pointer;">Start</button>
            <button id="pip-pause" style="flex:1;padding:10px 0;border-radius:12px;border:1px solid rgba(255,255,255,0.35);background:transparent;color:${cardText};font-family:${fontMain};font-weight:600;font-size:0.85rem;cursor:pointer;">Pause</button>
            <button id="pip-done" style="flex:1;padding:10px 0;border-radius:12px;border:1px solid ${accent};background:rgba(217,119,6,0.15);color:${cardText};font-family:${fontMain};font-weight:700;font-size:0.85rem;cursor:pointer;">Done</button>
            <button id="pip-reset" style="flex:1;padding:10px 0;border-radius:12px;border:1px solid rgba(255,255,255,0.35);background:transparent;color:${cardText};font-family:${fontMain};font-weight:600;font-size:0.85rem;cursor:pointer;">Reset</button>
          </div>
        </div>
      `;

      // Respect the warm accent for the Done button border fill
      const pipDone = doc.getElementById('pip-done');
      if (pipDone) pipDone.style.borderColor = accent;

      // Keep the floating clock in sync every tick
      this.pipWindow = pipWin;
      this.syncPipAll();

      // Wire controls: each button reflects back into the main tracker (same page)
      doc.getElementById('pip-start').addEventListener('click', () => this.handleTimerStart());
      doc.getElementById('pip-pause').addEventListener('click', () => this.handleTimerPause());
      doc.getElementById('pip-done').addEventListener('click', () => this.handleTimerDone());
      doc.getElementById('pip-reset').addEventListener('click', () => this.handleTimerReset());
      doc.getElementById('pip-fullscreen').addEventListener('click', () => this.openFullscreen());
      doc.getElementById('pip-close').addEventListener('click', () => this.closeMini());

      // Closing the floating window commits the elapsed time so it is saved.
      pipWin.addEventListener('pagehide', () => {
        if (this.pipTick) { clearInterval(this.pipTick); this.pipTick = null; }
        this.pipWindow = null;
        const subject = this.currentModalSubject;
        if (subject && this.activeTimers[subject]) {
          this.finishTimer(subject);
          this.clearActiveTimerState();
          this.updateTimerButtonStates(subject);
          this.updateTimerDisplays();
        }
      });

      // Extra safety sync (covers paused timers / goal text while the page is idle)
      this.pipTick = setInterval(() => this.syncPipClock(), 1000);
    } catch (e) {
      this.pipWindow = null;
    }
  }

  closeMini() {
    if (this.pipWindow) {
      try { this.pipWindow.close(); } catch (e) {}
      if (this.pipTick) { clearInterval(this.pipTick); this.pipTick = null; }
      this.pipWindow = null;
    }
  }

  // Refresh everything in the floating window (subject, clock, note, buttons)
  syncPipAll() {
    if (!this.pipWindow || !this.pipWindow.document) return;
    const subject = this.currentModalSubject;
    if (!subject) return;
    const doc = this.pipWindow.document;
    const s = doc.getElementById('pip-subject');
    if (s) s.textContent = subject;
    const note = doc.getElementById('pip-note');
    if (note) {
      note.textContent = this.timerNote || '';
      note.style.display = this.timerNote ? '' : 'none';
    }
    this.syncPipClock();
    this.updatePipButtonStates();
  }

  // Live clock + pomodoro text in the floating window
  syncPipClock() {
    if (!this.pipWindow || !this.pipWindow.document) return;
    const subject = this.currentModalSubject;
    if (!subject) return;
    const doc = this.pipWindow.document;
    const d = doc.getElementById('pip-display');
    if (d) d.textContent = this.formatTimer(this.getTimerElapsed(subject));
    const pom = doc.getElementById('pip-pomodoro');
    if (pom) {
      const total = this.getSubjectTime(this.getTodayKey(), subject);
      pom.textContent = `Today: ${this.formatTime(total)} / ${this.subjectGoal}h`;
    }
  }

  // Enable/disable the floating window's buttons to match the main timer state
  updatePipButtonStates() {
    if (!this.pipWindow || !this.pipWindow.document) return;
    const subject = this.currentModalSubject;
    const doc = this.pipWindow.document;
    const running = !!(this.activeTimers[subject] && this.activeTimers[subject].running);
    const paused = this.isTimerPaused(subject);
    const active = !!this.activeTimers[subject];
    const start = doc.getElementById('pip-start');
    const pause = doc.getElementById('pip-pause');
    const done = doc.getElementById('pip-done');
    const reset = doc.getElementById('pip-reset');
    if (start) { start.disabled = running; start.textContent = paused ? 'Resume' : 'Start'; }
    if (pause) { pause.disabled = !running; pause.textContent = paused ? 'Paused' : 'Pause'; }
    if (done) done.disabled = !active;
    if (reset) reset.disabled = !active;
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
      document.getElementById('timer-display').textContent = this.formatTimer(this.getTimerElapsed(this.currentModalSubject));
      
      // Refresh sessions list in modal
      this.renderSessions(this.currentModalSubject);
      
      // Notify if reached weekly goal
      const weekCapped = this.getSubjectWeekTimeCapped(this.currentModalSubject);
      const goalMs = this.subjectGoal * 3600000;
      if (weekCapped >= goalMs) {
        this.showNotification(`🎉 ${this.currentModalSubject} weekly goal reached!`);
      }
    }
  }

  // ---- TASKS & EXAMS RENDERING ----

  renderTasks() {
    if (!document.getElementById('subject-tabs')) return;
    this.rollRepeatingTasks();
    this.renderSubjectTabs('');
    this.renderChecklists('');
    this.renderExams('');
  }

  // Refresh tasks content in both the Tasks tab and the Today view
  refreshTaskViews() {
    if (document.getElementById('subject-tabs')) this.renderTasks();
    if (document.getElementById('today-subject-tabs')) this.renderTodayTasks();
  }

  // Render tasks content into the Today view (prefix 'today-')
  renderTodayTasks() {
    if (!document.getElementById('today-subject-tabs')) return;
    this.renderSubjectTabs('today-');
    this.renderChecklists('today-');
    this.renderExams('today-');
  }

  renderSubjectTabs(prefix) {
    const tabs = document.getElementById(`${prefix}subject-tabs`);
    if (!tabs) return;
    tabs.innerHTML = '';
    const subjects = [{ key: '__main__', name: '📋 Main' }, ...this.subjects.map(s => ({ key: s, name: `📗 ${s}` }))];
    subjects.forEach(subj => {
      const btn = document.createElement('button');
      btn.className = 'subject-tab';
      btn.textContent = subj.name;
      if (subj.key === this.currentTaskSubject) btn.classList.add('active');
      btn.addEventListener('click', () => {
        this.currentTaskSubject = subj.key;
        this.renderSubjectTabs(prefix);
        this.renderChecklists(prefix);
        this.renderSubjectTabs(this.otherPrefix(prefix));
        this.renderChecklists(this.otherPrefix(prefix));
      });
      tabs.appendChild(btn);
    });
  }

  otherPrefix(prefix) {
    return prefix === 'today-' ? '' : 'today-';
  }

  renderChecklists(prefix) {
    const area = document.getElementById(`${prefix}checklists-area`);
    if (!area) return;
    const subjectKey = this.currentTaskSubject || '__main__';
    const lists = this.getSubjectChecklists(subjectKey);
    const subjectName = subjectKey === '__main__' ? 'Main' : subjectKey;

    let html = `<div class="subject-heading"><h3>${subjectName} checklists</h3>
      <button class="btn-secondary small-btn" id="${prefix}add-list-btn">+ Add Checklist</button></div>`;

    if (lists.length === 0) {
      html += `<div class="empty-note">No checklists yet. Add one to start listing tasks.</div>`;
    } else {
      lists.forEach(list => {
        html += this.renderChecklistHtml(subjectKey, list);
      });
    }
    area.innerHTML = html;

    const addBtn = document.getElementById(`${prefix}add-list-btn`);
    if (addBtn) {
      addBtn.addEventListener('click', () => this.openListModal(subjectKey));
    }
    area.querySelectorAll('.task-list').forEach(listEl => {
      const listId = listEl.dataset.listId;
      const addTaskBtn = listEl.querySelector('.add-task-btn');
      if (addTaskBtn) addTaskBtn.addEventListener('click', () => this.openTaskModal(subjectKey, listId));

      const deleteListBtn = listEl.querySelector('.delete-list-btn');
      if (deleteListBtn) {
        deleteListBtn.addEventListener('click', () => {
          if (confirm('Delete this whole list and all its tasks?')) {
            this.deleteChecklist(subjectKey, listId);
          }
        });
      }

      const nameInput = listEl.querySelector('.list-name-input');
      if (nameInput) {
        nameInput.addEventListener('change', () => {
          this.renameChecklist(subjectKey, listId, nameInput.value);
        });
      }

      listEl.querySelectorAll('.task-item').forEach(item => {
        const taskId = item.dataset.taskId;
        const checkbox = item.querySelector('.task-checkbox');
        if (checkbox) checkbox.addEventListener('click', () => this.toggleTask(subjectKey, listId, taskId));
        const deleteBtn = item.querySelector('.task-delete');
        if (deleteBtn) deleteBtn.addEventListener('click', () => this.deleteTask(subjectKey, listId, taskId));
      });
    });
  }

  renderChecklistHtml(subjectKey, list) {
    let html = `
      <div class="task-list" data-list-id="${list.id}">
        <div class="task-list-header">
          <input type="text" class="list-name-input" value="${this.escapeAttr(list.name)}"/>
          <button class="add-task-btn btn-secondary small-btn">+ Add task</button>
          <button class="delete-list-btn small-icon" title="Delete list">🗑</button>
        </div>
        <div class="task-list-body">`;
    if (list.tasks.length === 0) {
      html += `<div class="empty-note">No tasks yet.</div>`;
    } else {
      list.tasks.forEach(task => {
        const overdue = this.isTaskOverdue(task);
        const repeatLabel = task.repeat && task.repeat !== 'none' ? ` 🔁${task.repeat}` : '';
        const dueLabel = task.due ? ` <span class="due">⏰ ${this.formatDue(task.due)}</span>` : '';
        html += `
          <div class="task-item ${task.done ? 'done' : ''} ${overdue ? 'overdue' : ''}" data-task-id="${task.id}" title="${overdue ? 'Overdue — click to delete' : ''}">
            <span class="task-checkbox">${task.done ? '☑' : '☐'}</span>
            <span class="task-text">${this.escapeAttr(task.text)}${repeatLabel}${dueLabel}</span>
            <button class="task-delete small-icon" title="Delete task">✕</button>
          </div>`;
      });
    }
    html += `</div></div>`;
    return html;
  }

  formatDue(ms) {
    const d = new Date(ms);
    const now = Date.now();
    if (ms < now) return 'overdue';
    const days = Math.floor((ms - now) / 86400000);
    if (days > 0) return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  renderExams(prefix) {
    const listEl = document.getElementById(`${prefix}exams-list`);
    if (!listEl) return;
    const exams = this.getExams();
    const compact = prefix === 'today-';
    let sorted = [...exams].sort((a, b) => new Date(a.date) - new Date(b.date));
    if (compact) sorted = sorted.slice(0, 5);
    if (sorted.length === 0) {
      listEl.innerHTML = `<div class="empty-note">${compact ? 'No upcoming exams.' : 'No exams scheduled.'}</div>`;
      return;
    }
    listEl.innerHTML = '';
    sorted.forEach(exam => {
      const c = this.getExamCountdown(exam);
      const item = document.createElement('div');
      const cls = `exam-item ${c.passed ? 'passed' : ''} ${c.urgent ? 'urgent' : ''} ${compact ? 'compact' : ''}`;
      item.className = cls;
      item.innerHTML = `
        <div class="exam-top">
          <div class="exam-name">${this.escapeAttr(exam.name)}</div>
          <div class="exam-subject">${this.escapeAttr(exam.subject)}</div>
          ${compact ? '' : `<button class="exam-delete small-icon" title="Delete exam">🗑</button>`}
        </div>
        <div class="exam-date">${new Date(exam.date).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</div>
        <div class="exam-countdown">${c.passed ? '🗸 Done' : `⏳ In ${c.label}`}</div>
        ${exam.reviewTarget ? `<div class="exam-target">🎯 ${this.escapeAttr(exam.reviewTarget)}</div>` : ''}
      `;
      if (!compact) {
        item.querySelector('.exam-delete').addEventListener('click', () => this.deleteExam(exam.id));
      }
      listEl.appendChild(item);
    });

    // Populate subject dropdown for new exam
    if (!compact) {
      const sel = document.getElementById('new-exam-subject');
      if (sel) {
        const current = sel.value;
        sel.innerHTML = this.subjects.map(s => `<option value="${this.escapeAttr(s)}">${this.escapeAttr(s)}</option>`).join('');
        if (this.subjects.includes(current)) sel.value = current;
      }
    }
  }

  // ---- Modals ----
  openListModal(subjectKey) {
    this.listSubject = subjectKey;
    document.getElementById('list-modal-title').textContent = 'Add Checklist';
    document.getElementById('new-list-name').value = '';
    document.getElementById('list-modal').classList.remove('hidden');
    setTimeout(() => document.getElementById('new-list-name').focus(), 50);
  }
  closeListModal() {
    document.getElementById('list-modal').classList.add('hidden');
  }
  saveList() {
    const name = document.getElementById('new-list-name').value.trim();
    if (!name) { this.showToast('Enter a list name.'); return; }
    this.addChecklist(this.listSubject, name);
    this.closeListModal();
  }

  openTaskModal(subjectKey, listId) {
    this.taskSubject = subjectKey;
    this.taskListId = listId;
    document.getElementById('new-task-text').value = '';
    document.getElementById('new-task-due').value = '';
    document.getElementById('new-task-repeat').value = 'none';
    document.getElementById('task-modal').classList.remove('hidden');
    setTimeout(() => document.getElementById('new-task-text').focus(), 50);
  }
  closeTaskModal() {
    document.getElementById('task-modal').classList.add('hidden');
  }
  saveTask() {
    const text = document.getElementById('new-task-text').value.trim();
    if (!text) { this.showToast('Enter a task description.'); return; }
    const dueVal = document.getElementById('new-task-due').value;
    const dueMs = dueVal ? new Date(dueVal).getTime() : null;
    const repeat = document.getElementById('new-task-repeat').value;
    this.addTask(this.taskSubject, this.taskListId, text, dueMs, repeat);
    this.closeTaskModal();
  }

  openExamModal() {
    const sel = document.getElementById('new-exam-subject');
    if (sel) {
      sel.innerHTML = this.subjects.map(s => `<option value="${this.escapeAttr(s)}">${this.escapeAttr(s)}</option>`).join('');
    }
    sel.value = this.subjects[0] || '';
    document.getElementById('new-exam-name').value = '';
    document.getElementById('new-exam-date').value = '';
    document.getElementById('new-exam-target').value = '';
    document.getElementById('exam-modal').classList.remove('hidden');
    setTimeout(() => document.getElementById('new-exam-name').focus(), 50);
  }
  closeExamModal() {
    document.getElementById('exam-modal').classList.add('hidden');
  }
  saveExam() {
    const name = document.getElementById('new-exam-name').value.trim();
    const subject = document.getElementById('new-exam-subject').value;
    const dateVal = document.getElementById('new-exam-date').value;
    const target = document.getElementById('new-exam-target').value.trim();
    if (!name || !subject || !dateVal) { this.showToast('Fill in name, subject and date.'); return; }
    this.addExam(subject, name, dateVal, target);
    this.closeExamModal();
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
    document.getElementById('notification-settings').classList.toggle('hidden', !this.notificationsEnabled);
    
    document.getElementById('pomodoro-work').value = this.pomodoroSettings.work;
    document.getElementById('pomodoro-short').value = this.pomodoroSettings.short;
    document.getElementById('pomodoro-long').value = this.pomodoroSettings.long;
    
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
    
    this.pomodoroSettings = {
      work: parseInt(document.getElementById('pomodoro-work').value) || 25,
      short: parseInt(document.getElementById('pomodoro-short').value) || 5,
      long: parseInt(document.getElementById('pomodoro-long').value) || 15
    };
    
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
    
    // Remap checklists/exams when subjects are renamed, drop when removed
    this.data.checklists = this.data.checklists || {};
    this.data.exams = this.data.exams || [];
    const oldSet = new Set(oldSubjects);
    const newSet = new Set(newSubjects);
    const renamedTo = {};
    newSubjects.forEach(n => {
      if (!oldSet.has(n)) {
        const candidates = oldSubjects.filter(o => !newSet.has(o));
        if (candidates.length === 1) renamedTo[candidates[0]] = n;
      }
    });
    if (Object.keys(renamedTo).length > 0 || oldSet.size !== newSet.size) {
      const newChecklists = {};
      Object.keys(this.data.checklists).forEach(key => {
        const mapped = renamedTo[key] || key;
        if (newSet.has(mapped) || mapped === '__main__') newChecklists[mapped] = this.data.checklists[key];
      });
      this.data.checklists = newChecklists;
      this.data.exams = this.data.exams.filter(ex => newSet.has(ex.subject)).map(ex => {
        if (renamedTo[ex.subject]) ex.subject = renamedTo[ex.subject];
        return ex;
      });
    }
    
    this.data.settings = {
      subjectGoal: goal,
      notificationsEnabled: this.notificationsEnabled,
      reminderTime: this.reminderTime,
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

  reloadAfterSync() {
    // Re-apply settings, subjects, theme, colors from the adopted data
    if (this.data.settings) {
      this.subjectGoal = this.data.settings.subjectGoal || this.defaultSubjectGoal;
      this.notificationsEnabled = this.data.settings.notificationsEnabled || false;
      this.reminderTime = this.data.settings.reminderTime || '09:00';
      if (this.data.settings.pomodoroSettings) this.pomodoroSettings = {...this.pomodoroSettings, ...this.data.settings.pomodoroSettings};
      if (this.data.settings.theme) this.theme = {...this.theme, ...this.data.settings.theme};
      if (this.data.settings.timerColors) this.timerColors = {...this.timerColors, ...this.data.settings.timerColors};
    }
    if (this.data.subjects && this.data.subjects.length > 0) {
      this.subjects = this.data.subjects;
    }
    this.ensureChecklistsExams();
    this.rollRepeatingTasks();
    this.applyTheme();
    this.applyTimerColors();
    this.refresh();
    this.renderSettings();
  }

  // ---- GITHUB SYNC (store data.json in a repo, shared across profiles/PCs) ----

  initSyncUI() {
    const saveBtn = document.getElementById('sync-save');
    const unlinkBtn = document.getElementById('sync-unlink');
    if (saveBtn) saveBtn.addEventListener('click', () => this.linkDevices());
    if (unlinkBtn) unlinkBtn.addEventListener('click', () => this.unlinkDevices());
  }

  loadSyncConfig() {
    try {
      const raw = localStorage.getItem('studyTrackerSync');
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  }

  initSync() {
    this.syncConfig = this.loadSyncConfig();
    if (!this.syncConfig || !this.syncConfig.repo || !this.syncConfig.token) {
      this.updateSyncStatus('');
      return;
    }
    try {
      const raw = localStorage.getItem('studyTrackerSyncState');
      this.syncState = raw ? JSON.parse(raw) : { updatedAt: 0, sha: null };
    } catch (e) {
      this.syncState = { updatedAt: 0, sha: null };
    }
    this.prefillSyncUI();
    this.syncFromRepo(); // pull linked data immediately
    // Poll for changes from other profiles/PCs every 30s
    this.syncPollInterval = setInterval(() => this.syncFromRepo(), 30000);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') this.syncFromRepo();
    });
  }

  prefillSyncUI() {
    if (!this.syncConfig) return;
    const repoEl = document.getElementById('sync-repo');
    if (repoEl) repoEl.value = this.syncConfig.repo || '';
    this.updateSyncStatus('<span style="opacity:0.8">✓ Linked to ' + (this.syncConfig.repo || 'repo') + '</span>');
  }

  linkDevices() {
    const repoEl = document.getElementById('sync-repo');
    const tokenEl = document.getElementById('sync-token');
    const repo = (repoEl.value || '').trim();
    const token = (tokenEl.value || '').trim();
    if (!repo || !token) {
      this.updateSyncStatus('<span style="color:#e05d5d">Please enter both the repository name and the token.</span>');
      return;
    }
    this.syncConfig = { repo, token };
    try { localStorage.setItem('studyTrackerSync', JSON.stringify(this.syncConfig)); } catch (e) {}
    this.syncState = { updatedAt: 0, sha: null };
    this.updateSyncStatus('Linking…');
    this.syncFromRepo().then(() => {
      // After a pull, push local so all linked clients converge
      if (!this.data.lastModified || this.data.lastModified > this.syncState.updatedAt) {
        this.syncPush();
      }
    });
    if (!this.syncPollInterval) {
      this.syncPollInterval = setInterval(() => this.syncFromRepo(), 30000);
    }
  }

  unlinkDevices() {
    try { localStorage.removeItem('studyTrackerSync'); } catch (e) {}
    try { localStorage.removeItem('studyTrackerSyncState'); } catch (e) {}
    this.syncConfig = null;
    this.syncState = { updatedAt: 0, sha: null };
    if (this.syncPollInterval) { clearInterval(this.syncPollInterval); this.syncPollInterval = null; }
    const repoEl = document.getElementById('sync-repo');
    if (repoEl) repoEl.value = '';
    const tokenEl = document.getElementById('sync-token');
    if (tokenEl) tokenEl.value = '';
    this.updateSyncStatus('Unlinked — data is now local-only.');
  }

  updateSyncStatus(html) {
    const el = document.getElementById('sync-status');
    if (el) el.innerHTML = html;
  }

  scheduleSyncPush() {
    if (!this.syncConfig || !this.syncConfig.repo || !this.syncConfig.token) return;
    if (this.syncTimer) clearTimeout(this.syncTimer);
    this.syncTimer = setTimeout(() => this.syncPush(), 2500);
  }

  b64encode(str) {
    return btoa(unescape(encodeURIComponent(str)));
  }

  async syncPush() {
    if (!this.syncConfig || !this.syncConfig.repo || !this.syncConfig.token) return;
    const { repo, token } = this.syncConfig;
    const path = 'data.json';
    const content = this.b64encode(JSON.stringify(this.data));
    let sha = this.syncState.sha;
    // GitHub requires the current SHA to update a file; fetch it if unknown
    if (sha === null || sha === undefined) {
      try {
        const meta = await fetch(`https://api.github.com/repos/${repo}/contents/${path}`, {
          headers: { Authorization: `token ${token}` }
        });
        if (meta.ok) {
          const j = await meta.json();
          sha = j.sha;
        } else if (meta.status !== 404) {
          this.updateSyncStatus('<span style="color:#e05d5d">Sync failed — check repo/token.</span>');
          return;
        }
      } catch (e) {
        this.updateSyncStatus('<span style="color:#e05d5d">Sync failed — no connection.</span>');
        return;
      }
    }
    const body = {
      message: 'sync data',
      content
    };
    if (sha) body.sha = sha;
    try {
      const res = await fetch(`https://api.github.com/repos/${repo}/contents/${path}`, {
        method: 'PUT',
        headers: {
          Authorization: `token ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(body)
      });
      if (res.ok) {
        const j = await res.json();
        this.syncState.sha = j.content && j.content.sha ? j.content.sha : sha;
        this.syncState.updatedAt = Date.now();
        try { localStorage.setItem('studyTrackerSyncState', JSON.stringify(this.syncState)); } catch (e) {}
        this.updateSyncStatus('✓ Saved to GitHub — synced.');
      } else if (res.status === 422) {
        // SHA changed since we last saw it (another client pushed): refetch and retry once
        this.syncState.sha = null;
        this.syncPush();
      } else {
        this.updateSyncStatus(`<span style="color:#e05d5d">Sync failed (${res.status}).</span>`);
      }
    } catch (e) {
      this.updateSyncStatus('<span style="color:#e05d5d">Sync failed — no connection.</span>');
    }
  }

  async syncFromRepo() {
    if (!this.syncConfig || !this.syncConfig.repo || !this.syncConfig.token) return;
    const { repo, token } = this.syncConfig;
    const path = 'data.json';
    try {
      const res = await fetch(`https://api.github.com/repos/${repo}/contents/${path}`, {
        headers: { Authorization: `token ${token}` }
      });
      if (res.status === 404) {
        // No data.json in the repo yet: push local once
        this.syncState.sha = null;
        this.syncPush();
        return;
      }
      if (!res.ok) return;
      const j = await res.json();
      this.syncState.sha = j.sha;
      const remoteData = JSON.parse(decodeURIComponent(escape(atob(j.content))));
      const remoteModified = remoteData.lastModified || 0;
      const localModified = this.data.lastModified || 0;
      if (remoteModified > localModified && remoteData.days && remoteData.subjects) {
        // A linked client has newer data → adopt it
        localStorage.setItem('studyTracker', JSON.stringify(remoteData));
        this.data = remoteData;
        this.syncState.updatedAt = Date.now();
        try { localStorage.setItem('studyTrackerSyncState', JSON.stringify(this.syncState)); } catch (e) {}
        this.reloadAfterSync();
        this.updateSyncStatus('✓ Synced from GitHub.');
      } else if (remoteModified < localModified) {
        // Local is newer → push it up
        this.syncPush();
      }
      // Equal → already in sync
    } catch (e) { /* offline; ignore */ }
  }
}

// Initialize the app
document.addEventListener('DOMContentLoaded', () => {
  window.studyTracker = new StudyTracker();
});