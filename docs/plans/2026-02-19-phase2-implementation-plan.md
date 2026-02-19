# Phase 2: Parent Dashboard Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Give parents a read-only summary dashboard at `/parent` showing attendance, practice streaks, and billing for all their children, with parent-specific access codes managed by admin.

**Architecture:** New `parent.html` page with access code login, reads linked children's data from Firebase RTDB. Admin dashboard gets a "Parent Access Code" field on student forms that auto-creates parent records and Firebase Auth accounts. Security rules expanded to let parents read their children's student data via `parentAuthUid` stored on student profiles.

**Tech Stack:** Firebase RTDB, Firebase Auth (email/password), vanilla HTML/JS (single-file, no build system)

---

### Task 1: Update security rules for parent access

**Files:**
- Modify: `database.rules.json`

**Step 1: Update the rules file**

Add `parents` node, `parentAccessCodes` to meta, and expand student read rule to include `parentAuthUid`:

```json
{
  "rules": {
    "professorOfFunk": {
      "students": {
        "$studentId": {
          ".read": "auth.uid === 'FRLOpQbA69dhh7pCvx45fdPfkbz1' || auth.uid === data.child('profile/authUid').val() || auth.uid === data.child('profile/parentAuthUid').val()",
          ".write": "auth.uid === 'FRLOpQbA69dhh7pCvx45fdPfkbz1'",
          "practice": {
            ".write": "auth.uid === 'FRLOpQbA69dhh7pCvx45fdPfkbz1' || auth.uid === data.parent().child('profile/authUid').val()"
          }
        }
      },
      "parents": {
        "$parentId": {
          ".read": "auth.uid === 'FRLOpQbA69dhh7pCvx45fdPfkbz1' || auth.uid === data.child('profile/authUid').val()",
          ".write": "auth.uid === 'FRLOpQbA69dhh7pCvx45fdPfkbz1'"
        }
      },
      "meta": {
        "accessCodes": {
          "$code": {
            ".read": true
          }
        },
        "parentAccessCodes": {
          "$code": {
            ".read": true
          }
        },
        ".write": "auth.uid === 'FRLOpQbA69dhh7pCvx45fdPfkbz1'"
      },
      "ensembles": {
        ".read": "auth.uid === 'FRLOpQbA69dhh7pCvx45fdPfkbz1'",
        ".write": "auth.uid === 'FRLOpQbA69dhh7pCvx45fdPfkbz1'"
      },
      "lessonTranscripts": {
        ".read": "auth.uid === 'FRLOpQbA69dhh7pCvx45fdPfkbz1'",
        ".write": "auth.uid === 'FRLOpQbA69dhh7pCvx45fdPfkbz1'"
      }
    }
  }
}
```

Key changes from current rules:
- Student `.read` now includes `|| auth.uid === data.child('profile/parentAuthUid').val()`
- New `parents/$parentId` node: parent can read own record, admin writes
- New `meta/parentAccessCodes/$code`: public read per code (same pattern as student access codes)

**Step 2: Deploy rules**

Run: `cd /c/Tools/Apps/professor-of-funk && npx firebase-tools deploy --only database`
Expected: `rules for database professor-of-funk-default-rtdb released successfully`

**Step 3: Commit**

```bash
git add database.rules.json
git commit -m "feat: add parent access security rules for Phase 2"
```

---

### Task 2: Add parent management to admin dashboard

**Files:**
- Modify: `public/admin.html`

This task adds:
- `createParentAuth()` function (mirrors `createStudentAuth()`)
- `ensureParentRecord()` function that creates/links parent records
- Parent Access Code field on Add Student form
- Parent Access Code field on Edit Student form
- Load `parents` data in `loadLocalData()`
- Real-time sync for parents

**Step 1: Add `createParentAuth` function**

In `admin.html`, after the existing `createStudentAuth` function (around line 219), add:

```javascript
async function createParentAuth(parentId, accessCode) {
  try {
    const cred = await secondaryApp.auth().createUserWithEmailAndPassword(
      parentId + '@parent.professoroffunk.app',
      accessCode + '!PoF'
    );
    await secondaryApp.auth().signOut();
    return cred.user.uid;
  } catch (e) {
    if (e.code === 'auth/email-already-in-use') {
      try {
        const cred = await secondaryApp.auth().signInWithEmailAndPassword(
          parentId + '@parent.professoroffunk.app',
          accessCode + '!PoF'
        );
        const uid = cred.user.uid;
        await secondaryApp.auth().signOut();
        return uid;
      } catch (e2) {
        console.error('Could not retrieve existing parent UID:', e2);
        return null;
      }
    }
    console.error('Failed to create parent auth:', e);
    return null;
  }
}
```

**Step 2: Add `ensureParentRecord` function**

After `createParentAuth`, add:

```javascript
async function ensureParentRecord(studentKey, parentName, parentEmail, parentAccessCode) {
  if (!parentName || !parentAccessCode) return null;

  // Generate parentId from the access code
  const parentId = parentAccessCode.toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/^-|-$/g, '');

  // Check if parent already exists in localData
  if (!localData.parents) localData.parents = {};
  let parent = localData.parents[parentId];

  if (!parent) {
    // Create new parent record
    const authUid = await createParentAuth(parentId, parentAccessCode);
    parent = {
      profile: {
        name: parentName,
        email: parentEmail,
        accessCode: parentAccessCode,
        authUid: authUid || null
      },
      children: {}
    };
    localData.parents[parentId] = parent;
  }

  // Link student to parent
  parent.children[studentKey] = true;

  // Save parent record + access code mapping
  await fbSave("parents/" + parentId, parent);
  await fbSave("meta/parentAccessCodes/" + parentAccessCode, parentId);

  // Store parentAuthUid on student profile for security rules
  return parent.profile.authUid;
}
```

**Step 3: Update `loadLocalData` to load parents**

In `loadLocalData()` (around line 261), change the Promise.all to also load parents:

```javascript
async function loadLocalData() {
  const [students, ensembles, lessonTranscripts, parents] = await Promise.all([
    fbLoad("students", {}),
    fbLoad("ensembles", {}),
    fbLoad("lessonTranscripts", []),
    fbLoad("parents", {})
  ]);
```

And update the localData assignment (around line 276):

```javascript
  localData = { students, ensembles, lessonTranscripts: toArray(lessonTranscripts), parents };
```

**Step 4: Add "Parent Access Code" field to Add Student form**

In `renderAddStudentForm()`, after the student Access Code form group (after line 473, the closing of the access code `h('div', { class: 'form-group' }, ...)`), add:

```javascript
    h('div', { class: 'form-group' },
      h('label', {}, 'Parent Access Code (for parent dashboard)'),
      h('input', { class: 'input', id: 'new-student-parent-code', placeholder: 'e.g. wong-parent — auto-generated if blank' })
    ),
```

**Step 5: Update Add Student onClick to create parent record**

In the Add Student onClick handler (around line 475), after reading `accessCode`, add reading the parent code:

```javascript
      const parentCode = document.getElementById('new-student-parent-code').value.trim().toLowerCase() || (key + '-parent');
```

After the student is saved to Firebase (after line 507 `await fbSave("meta/accessCodes/" + accessCode, key);`), add:

```javascript
      // Create parent record if parent name provided
      if (parentName) {
        const parentAuthUid = await ensureParentRecord(key, parentName, parentEmail, parentCode);
        if (parentAuthUid) {
          localData.students[key].profile.parentAuthUid = parentAuthUid;
          localData.students[key].profile.parentAccessCode = parentCode;
          await fbSave("students/" + key + "/profile/parentAuthUid", parentAuthUid);
          await fbSave("students/" + key + "/profile/parentAccessCode", parentCode);
        }
      }
```

**Step 6: Add "Parent Access Code" field to Edit Student form**

In `renderEditStudentForm()`, after the Payment Status form group (around line 586), add a new row:

```javascript
    h('div', { class: 'form-group' },
      h('label', {}, 'Parent Access Code'),
      h('input', { class: 'input', id: 'edit-student-parent-code', value: p.parentAccessCode || '' })
    ),
```

**Step 7: Update Edit Student save to handle parent record**

In the Edit Student save handler (around line 589), after reading `paymentStatus`, add:

```javascript
        const parentCode = document.getElementById('edit-student-parent-code').value.trim().toLowerCase();
```

Before `saveLocalData()` (line 614), add:

```javascript
        // Create/update parent record if parent name and code provided
        if (parentName && parentCode) {
          const parentAuthUid = await ensureParentRecord(key, parentName, parentEmail, parentCode);
          if (parentAuthUid) {
            s.profile.parentAuthUid = parentAuthUid;
            s.profile.parentAccessCode = parentCode;
            await fbSave("students/" + key + "/profile/parentAuthUid", parentAuthUid);
            await fbSave("students/" + key + "/profile/parentAccessCode", parentCode);
          }
        }
```

Also add `parentAccessCode` to the profile spread on line 612:

```javascript
        s.profile = { ...s.profile, name, instrument, program, privateRate, groupRate, lessonDay, lessonTime, parentName, parentEmail, accessCode, parentAccessCode: parentCode || s.profile.parentAccessCode };
```

**Step 8: Deploy and test**

Run: `cd /c/Tools/Apps/professor-of-funk && npx firebase-tools deploy --only hosting`

Test: Go to `/admin`, sign in, edit a student, enter a parent access code, save. Check Firebase RTDB console for `parents/` node and `meta/parentAccessCodes/` node.

**Step 9: Commit**

```bash
git add public/admin.html
git commit -m "feat: add parent access code management to admin dashboard"
```

---

### Task 3: Create parent dashboard page

**Files:**
- Create: `public/parent.html`

**Step 1: Create the parent dashboard**

Create `public/parent.html` — a self-contained single-file HTML page with:
- Same visual style as admin/student portals (dark theme, DM Serif Display headings, accent gold)
- Access code login gate (same pattern as student portal)
- Firebase init BEFORE auth code (lesson learned from Phase 1)
- Loads parent record to get children list
- Loads each child's student data
- Renders a summary card per child

The full file:

```html
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, user-scalable=no, viewport-fit=cover">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="apple-mobile-web-app-title" content="PoF Parent">
<meta name="theme-color" content="#0a0a0f">
<meta name="description" content="Professor of Funk — Parent Dashboard">
<title>Professor of Funk — Parent Dashboard</title>
<link rel="manifest" href="data:application/json;base64,eyJuYW1lIjoiUHJvZiBvZiBGdW5rIFBhcmVudCIsInNob3J0X25hbWUiOiJQb0YgUGFyZW50Iiwic3RhcnRfdXJsIjoiLiIsImRpc3BsYXkiOiJzdGFuZGFsb25lIiwiYmFja2dyb3VuZF9jb2xvciI6IiMwYTBhMGYiLCJ0aGVtZV9jb2xvciI6IiNENDk0M0EifQ==">
<link href="https://fonts.googleapis.com/css2?family=DM+Serif+Display&family=IBM+Plex+Sans:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
:root {
  --bg:#0a0a0f; --surface:#13131a; --surface2:#1a1a24; --border:#2a2a35;
  --accent:#D4943A; --accent-glow:rgba(212,148,58,0.15);
  --green:#4ade80; --red:#f87171; --blue:#60a5fa; --yellow:#fbbf24;
  --text:#e8e8ef; --muted:#888899;
  --safe-top:env(safe-area-inset-top,0px);
  --safe-bottom:env(safe-area-inset-bottom,0px);
}
*{margin:0;padding:0;box-sizing:border-box;-webkit-tap-highlight-color:transparent;}
html,body{height:100%;overflow:hidden;}
body{background:var(--bg);color:var(--text);font-family:'IBM Plex Sans','Segoe UI',system-ui,sans-serif;font-size:14px;line-height:1.5;}
.app{display:flex;flex-direction:column;height:100vh;height:100dvh;padding-top:var(--safe-top);}
.header{background:var(--surface);border-bottom:1px solid var(--border);padding:0 16px;display:flex;align-items:center;height:52px;flex-shrink:0;}
.logo{display:flex;align-items:center;gap:8px;margin-right:auto;}
.logo-icon{font-size:18px;}
.logo-name{font-family:'DM Serif Display',Georgia,serif;font-size:16px;font-weight:700;color:var(--accent);}
.logo-sub{color:var(--muted);font-size:10px;font-weight:500;}
.header-user{display:flex;align-items:center;gap:6px;color:var(--muted);font-size:11px;}
.header-user span{color:var(--accent);font-weight:600;}
.header-logout{background:transparent;border:1px solid var(--border);border-radius:6px;padding:3px 8px;color:var(--muted);font-size:10px;cursor:pointer;margin-left:8px;}
.content{flex:1;overflow-y:auto;-webkit-overflow-scrolling:touch;padding:16px;padding-bottom:calc(16px + var(--safe-bottom));}
.section-title{font-family:'DM Serif Display',Georgia,serif;font-size:20px;margin:0 0 4px;}
.section-sub{color:var(--muted);font-size:12px;margin:0 0 16px;}
.child-card{background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:16px;margin-bottom:12px;border-left:3px solid var(--accent);}
.child-name{font-family:'DM Serif Display',Georgia,serif;font-size:18px;margin-bottom:2px;}
.child-meta{color:var(--muted);font-size:11px;margin-bottom:14px;}
.stats-row{display:grid;grid-template-columns:1fr 1fr;gap:8px;}
.stat-box{background:var(--surface2);border-radius:10px;padding:10px 12px;}
.stat-label{color:var(--muted);font-size:10px;text-transform:uppercase;letter-spacing:0.5px;font-weight:600;}
.stat-value{font-family:'DM Serif Display',Georgia,serif;font-size:22px;font-weight:700;margin:2px 0;}
.stat-sub{color:var(--muted);font-size:10px;}
.badge{display:inline-block;padding:2px 8px;border-radius:10px;font-size:10px;font-weight:600;text-transform:uppercase;}
.badge-green{background:rgba(74,222,128,0.15);color:var(--green);}
.badge-red{background:rgba(248,113,113,0.15);color:var(--red);}
@media(min-width:700px){
  .stats-row{grid-template-columns:repeat(4,1fr);}
}
::-webkit-scrollbar{width:6px;}
::-webkit-scrollbar-track{background:var(--bg);}
::-webkit-scrollbar-thumb{background:var(--border);border-radius:3px;}
</style>
<script src="https://www.gstatic.com/firebasejs/9.23.0/firebase-app-compat.js"></script>
<script src="https://www.gstatic.com/firebasejs/9.23.0/firebase-auth-compat.js"></script>
<script src="https://www.gstatic.com/firebasejs/9.23.0/firebase-database-compat.js"></script>
</head>
<body>
<div id="auth-gate" style="display:flex;align-items:center;justify-content:center;height:100vh;background:#0a0a0f;">
<div style="text-align:center;padding:40px;">
<div style="font-size:48px;margin-bottom:12px;">👨‍👩‍👧‍👦</div>
<div style="font-family:'DM Serif Display',Georgia,serif;font-size:26px;color:#D4943A;margin-bottom:4px;">Professor of Funk</div>
<div style="color:#888899;font-size:12px;margin-bottom:24px;">Parent Dashboard — Enter your access code</div>
<input id="auth-pw" type="password" placeholder="Parent access code" style="width:240px;padding:10px 16px;border-radius:10px;border:1px solid #2a2a35;background:#13131a;color:#e8e8ef;font-size:14px;text-align:center;outline:none;" onkeydown="if(event.key==='Enter')checkAuth()">
<br><button onclick="checkAuth()" style="margin-top:12px;padding:8px 32px;border-radius:10px;border:none;background:#D4943A;color:#000;font-weight:600;font-size:14px;cursor:pointer;">Enter</button>
<div id="auth-err" style="color:#f87171;font-size:12px;margin-top:10px;display:none;">Invalid access code</div>
</div>
</div>
<div class="app" id="app" style="display:none;"></div>
<script>
/* ===== FIREBASE SETUP ===== */
const firebaseConfig = {
  apiKey: "AIzaSyBAVSC2g5xfnUXqkBoBX8TspITgDg_4FMo",
  authDomain: "professor-of-funk.firebaseapp.com",
  databaseURL: "https://professor-of-funk-default-rtdb.firebaseio.com",
  projectId: "professor-of-funk",
  storageBucket: "professor-of-funk.firebasestorage.app",
  messagingSenderId: "409198973109",
  appId: "1:409198973109:web:1c2aa4fd4611130b236efc"
};
firebase.initializeApp(firebaseConfig);
const fbDb = firebase.database();
const DB_ROOT = "professorOfFunk";
function dbRef(path) { return fbDb.ref(DB_ROOT + "/" + path); }

/* ===== AUTH ===== */
const AUTH_KEY = 'pof-parent-auth';
let currentParent = null;
let parentData = null;
let childrenData = {};

async function checkAuth() {
  const code = document.getElementById('auth-pw').value.trim().toLowerCase();
  if (!code) { document.getElementById('auth-err').style.display = 'block'; return; }
  try {
    const snap = await fbDb.ref(DB_ROOT + '/meta/parentAccessCodes/' + code).once('value');
    const parentId = snap.val();
    if (!parentId) {
      document.getElementById('auth-err').style.display = 'block';
      return;
    }
    await firebase.auth().signInWithEmailAndPassword(
      parentId + '@parent.professoroffunk.app',
      code + '!PoF'
    );
    currentParent = parentId;
    sessionStorage.setItem(AUTH_KEY, code);
    await showApp();
  } catch (e) {
    console.error('Login failed:', e);
    document.getElementById('auth-err').style.display = 'block';
  }
}

async function showApp() {
  document.getElementById('auth-gate').style.display = 'none';
  document.getElementById('app').style.display = 'flex';
  await loadParentData();
  render();
}

function logout() {
  firebase.auth().signOut();
  sessionStorage.removeItem(AUTH_KEY);
  currentParent = null;
  parentData = null;
  childrenData = {};
  document.getElementById('auth-gate').style.display = 'flex';
  document.getElementById('app').style.display = 'none';
  document.getElementById('auth-pw').value = '';
  document.getElementById('auth-err').style.display = 'none';
}

// Auto-login from session
(async function() {
  const saved = sessionStorage.getItem(AUTH_KEY);
  if (!saved) return;
  try {
    const snap = await fbDb.ref(DB_ROOT + '/meta/parentAccessCodes/' + saved).once('value');
    const parentId = snap.val();
    if (!parentId) return;
    await firebase.auth().signInWithEmailAndPassword(
      parentId + '@parent.professoroffunk.app',
      saved + '!PoF'
    );
    currentParent = parentId;
    await showApp();
  } catch (e) {
    sessionStorage.removeItem(AUTH_KEY);
  }
})();

/* ===== DATA ===== */
async function loadParentData() {
  if (!currentParent) return;
  try {
    const pSnap = await dbRef("parents/" + currentParent).once("value");
    parentData = pSnap.val();
    if (!parentData || !parentData.children) return;
    const childKeys = Object.keys(parentData.children);
    const loads = childKeys.map(async key => {
      const snap = await dbRef("students/" + key).once("value");
      return [key, snap.val()];
    });
    const results = await Promise.all(loads);
    childrenData = {};
    results.forEach(([key, val]) => { if (val) childrenData[key] = val; });
  } catch (e) {
    console.error('Failed to load parent data:', e);
  }
}

/* ===== HELPERS ===== */
function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  if (attrs) Object.entries(attrs).forEach(([k, v]) => {
    if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k.startsWith('on')) el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'class' || k === 'className') el.className = v;
    else el.setAttribute(k, v);
  });
  children.flat(9).forEach(c => { if (c == null || c === false) return; el.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
  return el;
}

function getAttendanceRate(student) {
  const att = student.attendance || {};
  const entries = Object.values(att);
  const attended = entries.filter(e => e.present).length;
  const total = entries.filter(e => !e.cancelled).length;
  return total ? Math.round(attended / total * 100) : 100;
}

function getBalance(student) {
  const billing = student.billing || [];
  let balance = 0;
  (Array.isArray(billing) ? billing : Object.values(billing)).forEach(entry => {
    if (entry.type === 'charge') balance += entry.amount;
    else if (entry.type === 'payment') balance -= entry.amount;
  });
  return balance;
}

function getWeekId(date) {
  const d = new Date(date);
  const jan1 = new Date(d.getFullYear(), 0, 1);
  const days = Math.floor((d - jan1) / 86400000);
  const week = Math.ceil((days + jan1.getDay() + 1) / 7);
  return d.getFullYear() + '-W' + String(week).padStart(2, '0');
}

function calcStreak(practice) {
  const dayNames = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
  let streak = 0;
  const today = new Date();
  for (let i = 0; i < 60; i++) {
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    const wk = getWeekId(d);
    const dayIdx = (d.getDay() + 6) % 7;
    const dayName = dayNames[dayIdx];
    const weekData = practice[wk];
    if (weekData && weekData[dayName]) {
      streak++;
    } else if (i > 0) {
      break;
    }
  }
  return streak;
}

function calcMonthlyDays(practice) {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();
  const dayNames = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
  let count = 0;
  for (let d = 1; d <= now.getDate(); d++) {
    const dt = new Date(year, month, d);
    const wk = getWeekId(dt);
    const dayIdx = (dt.getDay() + 6) % 7;
    const weekData = practice[wk];
    if (weekData && weekData[dayNames[dayIdx]]) count++;
  }
  return { practiced: count, elapsed: now.getDate() };
}

function fmtCurrency(n) { return '$' + Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 }); }

/* ===== RENDER ===== */
function render() {
  if (!parentData) return;
  const app = document.getElementById('app');
  app.innerHTML = '';

  // Header
  app.appendChild(h('div', { class: 'header' },
    h('div', { class: 'logo' },
      h('span', { class: 'logo-icon' }, '👨‍👩‍👧‍👦'),
      h('span', { class: 'logo-name' }, 'PROF OF FUNK'),
      h('span', { class: 'logo-sub' }, 'PARENT DASHBOARD')
    ),
    h('div', { class: 'header-user' },
      h('span', {}, parentData.profile.name),
      h('button', { class: 'header-logout', onClick: logout }, 'Sign Out')
    )
  ));

  // Content
  const content = h('div', { class: 'content' },
    h('h2', { class: 'section-title' }, 'Your Children'),
    h('p', { class: 'section-sub' }, Object.keys(childrenData).length + ' student' + (Object.keys(childrenData).length !== 1 ? 's' : '') + ' enrolled')
  );

  Object.entries(childrenData).forEach(([key, student]) => {
    const practice = student.practice || {};
    const streak = calcStreak(practice);
    const monthly = calcMonthlyDays(practice);
    const attRate = getAttendanceRate(student);
    const balance = getBalance(student);
    const p = student.profile || {};

    content.appendChild(h('div', { class: 'child-card' },
      h('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '4px' } },
        h('div', {},
          h('div', { class: 'child-name' }, p.name || key),
          h('div', { class: 'child-meta' }, (p.instrument || '') + ' · ' + (p.program || '') + ' · ' + (p.lessonDay || '') + ' ' + (p.lessonTime || ''))
        ),
        h('span', { class: 'badge ' + (balance > 0 ? 'badge-red' : 'badge-green') }, balance > 0 ? 'Balance Due' : 'Paid Up')
      ),
      h('div', { class: 'stats-row' },
        h('div', { class: 'stat-box' },
          h('div', { class: 'stat-label' }, 'Attendance'),
          h('div', { class: 'stat-value', style: { color: attRate >= 80 ? 'var(--green)' : attRate >= 60 ? 'var(--yellow)' : 'var(--red)' } }, attRate + '%'),
          h('div', { class: 'stat-sub' }, 'of lessons attended')
        ),
        h('div', { class: 'stat-box' },
          h('div', { class: 'stat-label' }, 'Practice Streak'),
          h('div', { class: 'stat-value', style: { color: 'var(--accent)' } }, '' + streak),
          h('div', { class: 'stat-sub' }, streak === 1 ? 'day' : 'days')
        ),
        h('div', { class: 'stat-box' },
          h('div', { class: 'stat-label' }, 'This Month'),
          h('div', { class: 'stat-value' }, monthly.practiced + '/' + monthly.elapsed),
          h('div', { class: 'stat-sub' }, 'days practiced')
        ),
        h('div', { class: 'stat-box' },
          h('div', { class: 'stat-label' }, 'Balance'),
          h('div', { class: 'stat-value', style: { color: balance > 0 ? 'var(--red)' : 'var(--green)' } }, (balance > 0 ? '' : '') + fmtCurrency(balance)),
          h('div', { class: 'stat-sub' }, balance > 0 ? 'outstanding' : 'all clear')
        )
      )
    ));
  });

  if (Object.keys(childrenData).length === 0) {
    content.appendChild(h('div', { style: { textAlign: 'center', padding: '40px', color: 'var(--muted)' } },
      'No student data found. Please contact your teacher.'
    ));
  }

  app.appendChild(content);
}

/* ===== SERVICE WORKER ===== */
if ('serviceWorker' in navigator) {
  const sw = `self.addEventListener("install",e=>self.skipWaiting());self.addEventListener("activate",e=>self.clients.claim());self.addEventListener("fetch",e=>e.respondWith(fetch(e.request).catch(()=>new Response("Offline",{status:503}))));`;
  navigator.serviceWorker.register(URL.createObjectURL(new Blob([sw], { type: 'application/javascript' }))).catch(() => {});
}
</script>
</body>
</html>
```

**Step 2: Deploy and test**

Run: `cd /c/Tools/Apps/professor-of-funk && npx firebase-tools deploy --only hosting`

Test: Parent login won't work yet (no parent records in DB). Verify the page loads at `/parent` with the login gate.

**Step 3: Commit**

```bash
git add public/parent.html
git commit -m "feat: add parent dashboard page with access code login"
```

---

### Task 4: Backfill parent records for existing students

**Files:**
- Modify: `public/admin.html`

Existing students already have `parentName` and `parentEmail` in their profiles. Add a one-time migration (same pattern as the student auth migration in Phase 1) that creates parent records for them.

**Step 1: Add parent migration to `loadLocalData()`**

In `loadLocalData()`, after the existing student auth migration loop (around line 290), add:

```javascript
  // One-time migration: create parent records for existing students
  for (const [key, student] of Object.entries(localData.students)) {
    if (student.profile.parentName && !student.profile.parentAuthUid) {
      const parentCode = key + '-parent';
      console.log('Migrating parent for:', key, '->', parentCode);
      const parentAuthUid = await ensureParentRecord(key, student.profile.parentName, student.profile.parentEmail || '', parentCode);
      if (parentAuthUid) {
        student.profile.parentAuthUid = parentAuthUid;
        student.profile.parentAccessCode = parentCode;
        await fbSave("students/" + key + "/profile/parentAuthUid", parentAuthUid);
        await fbSave("students/" + key + "/profile/parentAccessCode", parentCode);
      }
    }
  }
```

**Step 2: Deploy and test**

Run: `cd /c/Tools/Apps/professor-of-funk && npx firebase-tools deploy --only hosting`

Test: Sign in as admin at `/admin`. The migration runs on load. Check Firebase console for:
- `parents/` node with parent records
- `meta/parentAccessCodes/` with code mappings
- Each student's profile should now have `parentAuthUid` and `parentAccessCode`

Then try logging in at `/parent` with one of the generated codes (e.g., `mason-parent`).

**Step 3: Commit**

```bash
git add public/admin.html
git commit -m "feat: backfill parent records for existing students"
```

---

### Task 5: Final deploy and smoke test

**Step 1: Deploy everything**

Run: `cd /c/Tools/Apps/professor-of-funk && npx firebase-tools deploy`

This deploys hosting + database rules together.

**Step 2: Smoke test checklist**

1. `/admin` — sign in, verify students list loads, edit a student to see parent access code field
2. `/` — sign in as student with access code (e.g., `mason1`), verify portal loads
3. `/parent` — sign in as parent with parent code (e.g., `mason-parent`), verify:
   - Login works
   - Child card(s) appear
   - Attendance rate shows
   - Practice streak shows
   - Billing balance shows
   - Multiple children show for parents with multiple kids

**Step 3: Commit any fixes**

```bash
git add -A
git commit -m "feat: Phase 2 complete — parent dashboard with access codes"
```
