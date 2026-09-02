# Study Tracker

A self-contained web app for studying progress. Track a weekly goal of **5 hours per subject** (20h total for 4 subjects), run timers and pomodoros, and get email reminders — all in a single no-server HTML page.

## Features

### Daily & weekly progress
- **Today view** — shows exactly what you studied today per subject, a progress bar toward each subject's weekly goal, and a ✅ when a subject hits its 5h weekly target.
- **Capped weekly scoring** — you only reach 100% overall by hitting 5h in *every* subject. Studying extra in one subject doesn't inflate the total (that one caps at 5h).
- **Weekly view** — Monday→Sunday history showing the real hours studied each day, per-subject weekly totals, and whether each goal was met. Old weeks are kept and the current week resets each Monday.

### Timers
- **Stopwatch** per subject — start/stop, manual time entry, and multiple sessions accumulate.
- **Fullscreen timer** — a huge timer overlay with customizable text and background colors (default white-on-black).
- **Pomodoro** per subject — customizable work/short-break/long-break durations. Completed work pomodoros add their minutes to that subject's time; **skipping only counts the time actually elapsed**.

### Reminders
- Optional daily reminders at a chosen time that skip any subject already at its goal.
- **Email reminders** via EmailJS (connected to Gmail) listing which subjects still need work.

### Customization
- Add, remove, or rename subjects freely.
- Choose a **theme color** (blue, red, black, green, etc. or any custom color) — the background, cards, progress bars, and text recolor automatically with readable contrast.

### Data
- Everything auto-saves to your browser's storage (per device).
- **Export / Import JSON** buttons let you back up your data or move it between devices — so on GitHub Pages each user keeps their own data on their own machine.

## How to run

The app is a static page — just open `index.html` in a browser. No build step or server required.

Or serve it locally:

```bash
# Python
python -m http.server 8000
# then open http://localhost:8000
```

## Setting up email reminders (EmailJS)

Email sending uses [EmailJS](https://www.emailjs.com) (free) so it works from a static page without a server.

1. Create a free account at emailjs.com and connect a Gmail account.
2. Create an **Email Template** that accepts a variable named `{{message}}`.
3. In the app's **Settings → EmailJS Setup**, enter:
   - **Service ID** (e.g. `service_4bzpy4p`)
   - **Template ID** (e.g. `template_xxxxxxx`)
   - **User ID / Public Key** (from Account → General)
   - **Your email address**
4. Click **Send test email** to verify, then enable reminders and check "Send by email".

## Files

```
study-tracker/
├── index.html   # the app (main page)
├── styles.css   # all styling
└── app.js       # all logic (tracking, timers, pomodoro, email, theming)
```

## Notes

- Data is stored per-device in `localStorage`. Use Export/Import to back up or transfer between devices.
- The weekly goal is adjustable in Settings.
