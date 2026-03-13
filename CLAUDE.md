# Professor of Funk

Music teaching platform for ~18 active students. Firebase RTDB + Firebase Hosting. Single-file vanilla JS HTML apps (no framework, no build step).

## Deployment (MANDATORY)
After ANY change to HTML files or database.rules.json, ALWAYS run a full deploy:
```bash
firebase deploy --project professor-of-funk   # Deploys BOTH hosting + database rules
```
**NEVER use `--only hosting`** — this skips deploying database security rules, which silently breaks all data reads on the site (students won't load, logins fail). Always deploy hosting and database rules together.

After deploying, ALWAYS remind Simon:
> "Don't forget to re-provision the SSL cert for professoroffunk.com in the Firebase Console:
> https://console.firebase.google.com/project/professor-of-funk/hosting
> Click the custom domain certificate button. professor-of-funk.web.app works immediately in the meantime."

## Key Files
- `public/admin.html` — Admin dashboard (~3000 lines). 4 tabs: Attendance, Payments, Roster, Lessons.
- `public/portal.html` — Student portal. 6 tabs: Assignments, Practice, Lessons, Progress, Resources, Ensemble.
- `public/parent.html` — Parent portal. Shows child stats, balance, practice, Pay Now.
- `public/index.html` — Student portal (identical to portal.html).
- `database.rules.json` — Firebase RTDB security rules (includes parent payment write rules).
- `firebase.json` — Hosting config with no-cache headers on HTML files.

## Firebase
- **Project ID:** `professor-of-funk`
- **Live at:** `https://professoroffunk.com` AND `https://professor-of-funk.web.app`
- **Custom domain:** Cloudflare DNS (A records -> Firebase IPs, DNS only/grey cloud), TXT for verification
- **Admin UID:** `FRLOpQbA69dhh7pCvx45fdPfkbz1` (simonoto@simonkeyserpetty.com — hardcoded in database.rules.json)

## Database Schema
```
professorOfFunk/
  students/{key}/
    profile/ (name, instrument, startDate, accessCode, active, parentEmail, parentName, ...)
    programs/{programId}/ (type, name, rate, lessonDay, lessonTime)
    attendance/{programId}/{date}: { present: true|false, rateSnapshot: number }
    payments/{paymentId}/: { date, amount, method, note, status: "confirmed"|"pending"|"rejected" }
    itinerary/{weekId}: { text, assignedAt, week }
    songScores/{songId}: { title, artist, score: 1-5, lastUpdated, history: [{date, score}] }
    lessons/, practice/
  ensembles/{key}/info/, repertoire/, assignments/
  meta/accessCodes/, meta/parentAccessCodes/, meta/rates/
```

## Billing Logic
Computed, never stored: `tuitionOwed = (sessionsAttended * rate) - totalPaid`
- Rate snapshots saved on each attendance toggle (not just the current program rate)
- Pending/rejected payments excluded from balance calculations
- Monthly billing: `computeMonthlyBilling(key, year, month)` — classes per program, payments, previous balance

## Instruments
Bass, Drums, Guitar, Keys, Trumpet, Vocals, Other

## Admin Features (admin.html)

### Attendance Tab
- Mark present/absent per program per date
- "Mark All Present" for batch attendance
- Rate snapshots written on each attendance record

### Payments Tab
- Payment recording (manual), history per student
- **Pending queue** — yellow cards for parent-submitted payments awaiting confirmation
- **Confirm/Reject** buttons on pending payments (sets status + date)
- **Status badges** — green "Confirmed", yellow "Pending", red "Rejected"
- **Quarterly earnings view** — Earned, Collected, Outstanding, Collection Rate per quarter
- **CSV export** dropdown — Student Roster, Payment History (date range), Quarterly Earnings

### Roster Tab
- Students section + Ensembles section (combined view)
- Add/edit student form (with Trumpet in instrument list)
- Ensemble management: add, edit, repertoire, member assignments

### Lessons Tab (Weekly Itinerary)
- Select student + week → write practice plan text
- Song scoring: add songs, rate 1-5 stars with click-to-update
- Previously assigned itineraries list with edit capability
- Score labels: Just Started, Getting There, Solid, Performance Ready, Mastered

### Invoicing Section (in Payments tab)
- Month picker (last 12 months)
- Monthly billing summary per student
- Gmail integration: OAuth → create Gmail drafts for invoice emails
- Invoice preview modal with styled HTML template
- Batch "Generate N Invoice Drafts" button
- **Needs activation:** Set `GMAIL_CLIENT_ID` in admin.html (see code comments for Google Cloud Console steps)

## Student Portal Features (portal.html)

### Assignments Tab
- Shows latest weekly itinerary from teacher
- Expandable sections (Warm-up, Technical, Repertoire, Goal) with chevron animations

### Practice Tab
- Weekly practice grid (Mon-Sun toggleable)
- Streak counter
- Weekly itinerary card ("From your teacher")
- Practice notes textarea
- **Practice leaderboard** — ranked by monthly days, shows streaks, medal emojis, "(you)" highlight

### Lessons Tab
- Expandable lesson cards (date, title, summary, key concepts, areas of focus)

### Progress Tab
- **Repertoire Progress** — song scores with 5-star display and score labels
- **Milestones** — categorized timeline (technique, theory, repertoire, performance, ear training)

### Ensemble Tab
- Shows all ensembles the student is a member of
- Member list with "(you)" highlight
- Repertoire with status badges (Performance Ready, Learning, Retired)
- Loads all ensembles from Firebase with realtime sync

### Resources Tab
- Static links to music resources

## Parent Portal Features (parent.html)
- **5-tab bottom nav:** Home (dashboard), Practice, Messages, Events, Settings
- Access code auth (parent codes) + email/password upgrade + Google sign-in
- **Dashboard tab:** Child cards with stats (attendance, streak, monthly practice, balance), expandable sections (practice week, assignments, progress/songs, payments, recent lessons)
- **Practice tab:** Current week grid, monthly calendar heatmap (navigable by month, green intensity for practiced days), progress charts (song mastery bars, milestone category counts), anonymous practice percentile ring ("practices more than N% of peers") — requires 3+ active students
- **Messages tab:** Real-time message thread between parent and teacher per student. Messages stored at `messages/{studentKey}/{msgId}`. Parent can only write messages with `from: "parent"` and text <= 1000 chars. Teacher writes from admin. Auto-scrolls to newest. Unread indicator (red dot) on nav.
- **Events tab:** Upcoming recitals/performances from `events/` node. Cards with countdown badges (color-coded by urgency). Event teaser on dashboard home.
- **Settings tab:** Toggle switches for daily practice reminder (with time picker), weekly progress summary, payment due alerts. Stored at `parentReminders/{parentId}/`. Practice reminder uses browser Notifications API (checks every 5 min, fires within target time window).
- **Pay Now button** — appears when balance > $0 and no pending payment exists
- **Payment modal** — bottom-sheet style. Zelle (916-889-2921, tap to copy), Venmo (@studiosimon), PayPal (paypal.me/simonotog)
- **Payment history** — visual timeline with colored dots (green=confirmed, yellow=pending, red=rejected)
- **Child selector** — pill bar for multi-child families on Practice/Messages tabs
- **Mobile-first** — bottom sheet modals, touch-friendly toggles, safe area insets, no-bounce scroll

### New Database Paths
```
professorOfFunk/
  messages/{studentKey}/{msgId}: { from: "parent"|"teacher", text, timestamp, parentId? }
  events/{eventId}: { title, date, time?, location?, description?, students?: [studentKey, ...] }
  parentReminders/{parentId}: { practiceReminder: bool, reminderTime: "HH:MM", weeklySummary: bool, paymentReminder: bool, lastRead_{studentKey}: timestamp }
```

## UI Patterns
- `h(tag, attrs, ...children)` — DOM builder helper used throughout
- Expandable sections: `.expandable` class + `expand-chevron` + `expand-body` with CSS max-height transitions
- Dark theme (#0a0a0f background) with accent color (#D4943A gold/orange)
- DM Serif Display for headings, IBM Plex Sans for body
- Bottom nav with emoji icons + active state
- State tracked via module-level variables, `render()` rebuilds entire DOM

## Gotchas
- Firebase `update()` cannot set both a path and its ancestor in one call
- Custom domain SSL cert minting can take 10min-24hrs; if stuck, remove/re-add in Firebase Console
- `apple-mobile-web-app-capable` is deprecated — use `mobile-web-app-capable`
- Always specify `--project professor-of-funk` (Firebase CLI can switch active project)
- Payment status filtering: always exclude pending/rejected from balance calculations
- Rate snapshots: attendance records store `rateSnapshot` to preserve historical rates
- `apps-script-sync.js` was deleted — references remain only in old docs/plans
