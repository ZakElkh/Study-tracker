# Study Tracker

A cozy, self-contained web app for tracking your study progress. Set a weekly goal for each subject, run stopwatch + pomodoro timers, manage tasks & exams, and keep going with an always-on-top floating mini timer — all in a single no-server HTML page.

## Features

### Daily & weekly progress
- **Today view** — shows exactly what you studied today per subject, with a progress bar toward each subject's weekly goal and a ✅ when a subject hits its weekly target.
- **Capped weekly scoring** — you only reach 100% overall by hitting the goal in *every* subject. Studying extra in one subject doesn't inflate the total (that subject caps at its goal).
- **Weekly view** — Monday→Sunday history with real hours studied each day, per-subject weekly totals, and whether each goal was met.

### Timers
- **Stopwatch** per subject — Start / Pause / Resume / Done / Reset. Time is committed only when you press **Done**.
  - **Pause** saves progress, **Resume** continues, **Reset** discards (with a confirmation).
  - **Auto-save**: if the page closes, refreshes, or the PC shuts down while a timer is running, the elapsed time is saved automatically — so forgetting to press **Done** doesn't lose your progress.
- **Custom timer note** — write a personal note or motivation in the timer; it shows in the modal, fullscreen, and mini timer.
- **Fullscreen timer** — a huge focus overlay with customizable text and background colors (reached from the timer modal).
- **Mini timer (floating window)** — pressing **Mini** opens a small, **always-on-top floating window** using the browser's native **Document Picture-in-Picture** API. It stays visible above other apps *and* browser tabs while you study, stays live-synced with the main timer, and records your time normally. Closing the floating window stops the timer and saves the elapsed time.
  - Uses **no external helper or app** — it's entirely inside this web page (needs Chrome / Edge 116+ or a Chromium-based browser).
- **Pomodoro** per subject — customizable work / short-break / long-break durations. Skipping only counts the time actually elapsed.

### Tasks & Exams
- Per-subject **checklists** (multiple named lists per subject), with repeating tasks (daily / weekly) and overdue handling.
- **Exams** countdown per subject with days remaining and "urgent" highlighting.
- Tasks & Exams also appear at the bottom of the Today view for quick access.

### Customization
- Warm, cozy theme with a **background image** and a glassy blur panel.
- Add, remove, or rename subjects freely.
- Choose an **accent color** (amber, terracotta, green, brown, purple, rose, teal, gold — or any custom color).

### Reminders
- Optional daily reminders at a chosen time that skip any subject already at its goal.

### Data
- Everything auto-saves to your browser's storage (per device).
- **Export / Import JSON** buttons let you back up or transfer data between devices.

## How to run

**Live site:** <https://zakelkh.github.io/Study-tracker/>

The app is a static page — you can also just open `index.html` in a browser. No build step or server required.

```bash
# Or serve it locally with Python:
python -m http.server 8000
# then open http://localhost:8000
```

## Files

```
study-tracker/
├── index.html        # the app (main page)
├── styles.css        # all styling
├── app.js            # all logic (tracking, timers, pomodoro, tasks, exams, theming)
├── logo.png          # app logo / favicon
├── background.png    # the cozy background image
└── README.md
```

## Notes

- Data is stored per-device in `localStorage`. Use Export/Import to back up or transfer between devices.
- The weekly goal is adjustable in Settings.
- `background.png` — replace this file with your own cozy image to change the look (the app references this filename).
