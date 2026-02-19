# Phase 1: Real Data Flow — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make admin dashboard and student portal use Firebase as the single source of truth with proper auth, eliminating all hardcoded mock data.

**Architecture:** Both apps (`admin.html`, `index.html`) are single-file HTML/JS apps using Firebase Realtime Database (project: `professor-of-funk`). Admin authenticates via Firebase email/password auth. Students authenticate via access codes that map to Firebase Auth accounts. Security rules restrict reads/writes by UID.

**Tech Stack:** Firebase RTDB, Firebase Auth (email/password), vanilla JS, single-file HTML apps

---

### Task 1: Create Admin Firebase Auth Account

**Context:** The admin dashboard currently uses a hash-based passphrase. We need a real Firebase Auth account for the teacher so security rules can reference the admin UID.

**Files:**
- Modify: `public/admin.html:112-235` (auth gate + auth logic)

**Step 1: Create admin account in Firebase Console**

Go to Firebase Console → Authentication → Users → Add User:
- Email: (teacher's email)
- Password: (teacher's chosen password)

Note the UID — this will be used in security rules (Task 7).

Alternatively, run this in browser console on any page with the Firebase SDK loaded:
```javascript
firebase.auth().createUserWithEmailAndPassword("your-email@example.com", "your-password")
  .then(cred => console.log("Admin UID:", cred.user.uid))
```

**Step 2: Update admin auth gate HTML**

Replace the single passphrase input (line 113-121) with email + password fields:

```html
<div id="auth-gate" style="display:flex;align-items:center;justify-content:center;height:100vh;background:#0a0a0f;">
<div style="text-align:center;padding:40px;">
<div style="font-size:48px;margin-bottom:12px;">🎛️</div>
<div style="font-family:'DM Serif Display',Georgia,serif;font-size:26px;color:#D4943A;margin-bottom:4px;">Professor of Funk</div>
<div style="color:#888899;font-size:12px;margin-bottom:24px;">Admin Dashboard — Teacher Access</div>
<input id="auth-email" type="email" placeholder="Email" style="width:260px;padding:10px 16px;border-radius:10px;border:1px solid #2a2a35;background:#13131a;color:#e8e8ef;font-size:14px;text-align:center;outline:none;margin-bottom:8px;">
<br>
<input id="auth-pw" type="password" placeholder="Password" style="width:260px;padding:10px 16px;border-radius:10px;border:1px solid #2a2a35;background:#13131a;color:#e8e8ef;font-size:14px;text-align:center;outline:none;" onkeydown="if(event.key==='Enter')checkAuth()">
<br><button onclick="checkAuth()" style="margin-top:12px;padding:8px 32px;border-radius:10px;border:none;background:#D4943A;color:#000;font-weight:600;font-size:14px;cursor:pointer;">Sign In</button>
<div id="auth-err" style="color:#f87171;font-size:12px;margin-top:10px;display:none;">Invalid email or password</div>
</div>
</div>
```

**Step 3: Replace hash-based auth with Firebase Auth**

Replace the auth section (lines 202-235) with:

```javascript
/* ===== AUTH ===== */
const AUTH_KEY = 'pof-admin-auth';
let adminUser = null;

async function checkAuth() {
  const email = document.getElementById('auth-email').value.trim();
  const pw = document.getElementById('auth-pw').value;
  if (!email || !pw) { document.getElementById('auth-err').style.display = 'block'; return; }
  try {
    const cred = await firebase.auth().signInWithEmailAndPassword(email, pw);
    adminUser = cred.user;
    showApp();
  } catch (e) {
    console.error('Auth failed:', e);
    document.getElementById('auth-err').style.display = 'block';
  }
}

async function showApp() {
  document.getElementById('auth-gate').style.display = 'none';
  document.getElementById('app').style.display = 'flex';
  await loadLocalData();
  setupRealtimeSync();
  render();
}

function logout() {
  firebase.auth().signOut();
  adminUser = null;
  document.getElementById('auth-gate').style.display = 'flex';
  document.getElementById('app').style.display = 'none';
  document.getElementById('auth-email').value = '';
  document.getElementById('auth-pw').value = '';
  document.getElementById('auth-err').style.display = 'none';
}

// Auto-login if session still valid
firebase.auth().onAuthStateChanged(user => {
  if (user && !adminUser) {
    adminUser = user;
    showApp();
  }
});
```

**Step 4: Remove anonymous auth line**

Delete line 248: `firebase.auth().signInAnonymously().catch(e => console.warn("Anon auth failed", e));`

The admin now signs in with email/password. The `waitForAuth()` function can also be removed since `onAuthStateChanged` handles it.

**Step 5: Verify**

Open `professoroffunk.com/admin` in browser:
- Should see email + password login form
- Sign in with admin credentials
- Dashboard loads with existing data
- Sign out works

**Step 6: Commit**

```bash
git add public/admin.html
git commit -m "feat: replace admin hash auth with Firebase email/password auth"
```

---

### Task 2: Remove Mock Data from Admin Dashboard

**Context:** Admin dashboard has a 200-line `MOCK` object (lines 125-200) that's used as fallback data. Firebase is the source of truth — if there's no data, show empty state.

**Files:**
- Modify: `public/admin.html:125-317` (MOCK data + data layer)

**Step 1: Delete the MOCK object**

Remove the entire `const MOCK = { ... };` block (lines 125-200).

**Step 2: Update loadLocalData to not use MOCK fallback**

Replace `loadLocalData()` (lines 301-317):

```javascript
async function loadLocalData() {
  const [students, ensembles, lessonTranscripts] = await Promise.all([
    fbLoad("students", {}),
    fbLoad("ensembles", {}),
    fbLoad("lessonTranscripts", [])
  ]);
  Object.keys(students).forEach(k => {
    students[k].billing = toArray(students[k].billing);
    if (!students[k].attendance || typeof students[k].attendance !== 'object') students[k].attendance = {};
  });
  Object.keys(ensembles).forEach(k => {
    ensembles[k].repertoire = toArray(ensembles[k].repertoire);
    if (ensembles[k].info) ensembles[k].info.members = toArray(ensembles[k].info.members);
  });
  localData = { students, ensembles, lessonTranscripts: toArray(lessonTranscripts) };
}
```

The key change: `fbLoad("students", {})` instead of `fbLoad("students", JSON.parse(JSON.stringify(MOCK.students)))`. Empty object fallback instead of mock data.

**Step 3: Update fbLoad to remove localStorage fallback**

Replace `fbLoad` (lines 270-285):

```javascript
async function fbLoad(key, fallback) {
  try {
    const snap = await dbRef(key).once("value");
    const val = snap.val();
    return val !== null ? val : fallback;
  } catch(e) {
    console.warn("Firebase read failed for " + key, e);
    return fallback;
  }
}
```

Remove the localStorage fallback logic — Firebase is the only source.

**Step 4: Update fbSave to remove localStorage backup**

Replace `fbSave` (lines 287-290):

```javascript
async function fbSave(key, val) {
  try { await dbRef(key).set(val); } catch(e) { console.warn("Firebase write failed for " + key, e); }
}
```

**Step 5: Remove LOCAL_KEY constant**

Delete `const LOCAL_KEY = "pof-admin-data";` (line 253).

**Step 6: Verify**

Open admin dashboard:
- Should load with real Firebase data (or empty if no data exists yet)
- Students tab shows actual students from Firebase
- No mock data anywhere

**Step 7: Commit**

```bash
git add public/admin.html
git commit -m "feat: remove mock data and localStorage fallback from admin, Firebase is sole data source"
```

---

### Task 3: Wire Add Student to Create Firebase Auth Account

**Context:** When admin adds a student, we need to also create a Firebase Auth account for that student and store the mapping in `meta/accessCodes`. The student's email is generated as `{studentId}@professoroffunk.app` and their password is their access code.

**Important limitation:** Firebase client SDK doesn't let you create a user account while signed in as another user — `createUserWithEmailAndPassword()` signs you out and signs in as the new user. We need to use a workaround: create a secondary Firebase app instance for user creation.

**Files:**
- Modify: `public/admin.html` — Add Student click handler (~line 501-531) and add helper function

**Step 1: Add secondary Firebase app for student account creation**

Add after the Firebase setup section (after line 252):

```javascript
// Secondary app for creating student auth accounts without signing out admin
const secondaryApp = firebase.initializeApp(firebaseConfig, 'secondary');

async function createStudentAuth(studentId, accessCode) {
  try {
    const cred = await secondaryApp.auth().createUserWithEmailAndPassword(
      studentId + '@professoroffunk.app',
      accessCode
    );
    await secondaryApp.auth().signOut();
    return cred.user.uid;
  } catch (e) {
    if (e.code === 'auth/email-already-in-use') {
      console.warn('Student auth account already exists for', studentId);
      // Try to sign in to get the UID
      try {
        const cred = await secondaryApp.auth().signInWithEmailAndPassword(
          studentId + '@professoroffunk.app',
          accessCode
        );
        const uid = cred.user.uid;
        await secondaryApp.auth().signOut();
        return uid;
      } catch (e2) {
        console.error('Could not retrieve existing student UID:', e2);
        return null;
      }
    }
    console.error('Failed to create student auth:', e);
    return null;
  }
}
```

**Step 2: Update Add Student handler to create auth account and access code mapping**

In the Add Student button onClick handler (~line 501-531), after the student object is created in `localData.students[key]`, add:

```javascript
// Create Firebase Auth account for student
const authUid = await createStudentAuth(key, accessCode);
if (authUid) {
  localData.students[key].profile.authUid = authUid;
}

// Save access code mapping
await fbSave("meta/accessCodes/" + accessCode, key);
```

Make the onClick handler `async`.

The full updated handler becomes:
```javascript
onClick: async () => {
  const name = document.getElementById('new-student-name').value.trim();
  const instrument = document.getElementById('new-student-instrument').value;
  const program = document.getElementById('new-student-program').value;
  const privateRate = parseInt(document.getElementById('new-student-private-rate').value) || 75;
  const groupRate = parseInt(document.getElementById('new-student-group-rate').value) || 50;
  const lessonDay = document.getElementById('new-student-day').value;
  const lessonTime = document.getElementById('new-student-time').value.trim();
  const parentName = document.getElementById('new-student-parent').value.trim();
  const parentEmail = document.getElementById('new-student-email').value.trim();
  const accessCode = document.getElementById('new-student-code').value.trim().toLowerCase();
  if (!name) { alert('Please enter a student name.'); return; }
  if (!accessCode) { alert('Please enter an access code for the student portal.'); return; }
  const existingCodes = Object.values(localData.students).map(s => s.profile.accessCode);
  if (existingCodes.includes(accessCode)) { alert('That access code is already in use.'); return; }
  const key = name.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (localData.students[key]) { alert('A student with that key already exists.'); return; }

  // Create Firebase Auth account for student
  const authUid = await createStudentAuth(key, accessCode);

  localData.students[key] = {
    profile: { name, instrument, program, startDate: new Date().toISOString().slice(0, 10), accessCode, authUid: authUid || null, parentName, parentEmail, lessonDay, lessonTime, privateRate, groupRate },
    lastLesson: null,
    nextLesson: null,
    paymentStatus: 'current',
    attendance: {},
    billing: []
  };

  // Save student data + access code mapping
  await fbSave("students/" + key, localData.students[key]);
  await fbSave("meta/accessCodes/" + accessCode, key);

  showAddStudent = false;
  render();
}
```

**Step 3: Update Edit Student to sync access code changes**

In the Edit Student save handler (~line 608-630), when the access code changes, update the mapping:

Add before `saveLocalData()`:
```javascript
// Update access code mapping if changed
const oldCode = localData.students[key].profile.accessCode;
if (oldCode !== accessCode) {
  await dbRef("meta/accessCodes/" + oldCode).remove();
  await fbSave("meta/accessCodes/" + accessCode, key);
}
```

Make this handler `async` as well.

**Step 4: Update Delete Student to clean up auth and access code**

In the Delete Student handler (~line 631-637), add cleanup:

```javascript
onClick: async () => {
  if (!confirm('Delete ' + p.name + '? This removes all their data. This cannot be undone.')) return;
  const code = localData.students[key].profile.accessCode;
  if (code) await dbRef("meta/accessCodes/" + code).remove();
  delete localData.students[key];
  saveLocalData();
  editingStudent = null;
  render();
}
```

**Step 5: Update saveLocalData to save per-student instead of bulk**

Replace `saveLocalData()` (lines 319-326):

```javascript
function saveLocalData() {
  if (!localData) return;
  skipSync = true;
  fbSave("students", localData.students);
  fbSave("ensembles", localData.ensembles);
  fbSave("lessonTranscripts", localData.lessonTranscripts || []);
  setTimeout(() => { skipSync = false; }, 500);
}
```

This stays the same for now — bulk save is fine for the admin since admin has full write access.

**Step 6: Verify**

1. Open admin dashboard, sign in
2. Add a new student with access code
3. Check Firebase Console → Authentication → Users — new user should appear with email `{studentId}@professoroffunk.app`
4. Check Firebase Console → Realtime Database → `professorOfFunk/meta/accessCodes/` — should show the mapping
5. Edit a student's access code — old mapping removed, new one added
6. Delete a student — access code mapping removed

**Step 7: Commit**

```bash
git add public/admin.html
git commit -m "feat: create Firebase Auth accounts when adding students, manage access code mappings"
```

---

### Task 4: Backfill Existing Students with Auth Accounts

**Context:** Students already in Firebase don't have Firebase Auth accounts or access code mappings. We need a one-time migration.

**Files:**
- Modify: `public/admin.html` — add migration function to `loadLocalData`

**Step 1: Add migration check after data loads**

Add to the end of `loadLocalData()`:

```javascript
// One-time migration: create auth accounts for existing students without authUid
for (const [key, student] of Object.entries(localData.students)) {
  if (!student.profile.authUid && student.profile.accessCode) {
    console.log('Migrating student auth:', key);
    const authUid = await createStudentAuth(key, student.profile.accessCode);
    if (authUid) {
      student.profile.authUid = authUid;
      await fbSave("students/" + key + "/profile/authUid", authUid);
    }
    // Ensure access code mapping exists
    await fbSave("meta/accessCodes/" + student.profile.accessCode, key);
  }
}
```

**Step 2: Verify**

1. Open admin dashboard
2. Check console for "Migrating student auth" messages
3. Check Firebase Console → Auth → Users — all students should have accounts
4. Check Firebase Console → RTDB → `professorOfFunk/meta/accessCodes/` — all codes mapped
5. Check each student's profile has `authUid` set

**Step 3: Commit**

```bash
git add public/admin.html
git commit -m "feat: backfill existing students with Firebase Auth accounts and access code mappings"
```

---

### Task 5: Update Student Portal Auth

**Context:** The student portal currently uses anonymous auth + access codes with mock data fallback. Switch to email/password auth using the access code as the password.

**Files:**
- Modify: `public/index.html:207-271` (auth section)

**Step 1: Update checkAuth to use Firebase email/password**

Replace the auth section (lines 207-271):

```javascript
/* ===== AUTH ===== */
const AUTH_KEY = 'pof-portal-auth';
let currentStudent = null;
let currentTab = 0;

async function checkAuth() {
  const code = document.getElementById('auth-pw').value.trim().toLowerCase();
  if (!code) { document.getElementById('auth-err').style.display = 'block'; return; }

  try {
    // Look up the student ID from the access code
    const snap = await firebase.database().ref('professorOfFunk/meta/accessCodes/' + code).once('value');
    const studentId = snap.val();
    if (!studentId) {
      document.getElementById('auth-err').style.display = 'block';
      return;
    }

    // Sign in with Firebase Auth
    await firebase.auth().signInWithEmailAndPassword(
      studentId + '@professoroffunk.app',
      code
    );

    currentStudent = studentId;
    sessionStorage.setItem(AUTH_KEY, code);
    showApp();
  } catch (e) {
    console.error('Login failed:', e);
    document.getElementById('auth-err').style.display = 'block';
  }
}

async function showApp() {
  document.getElementById('auth-gate').style.display = 'none';
  document.getElementById('app').style.display = 'flex';
  await loadStudentData();
  loadPracticeData();
  setupRealtimeSync();
  render();
}

function logout() {
  firebase.auth().signOut();
  sessionStorage.removeItem(AUTH_KEY);
  currentStudent = null;
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
    const snap = await firebase.database().ref('professorOfFunk/meta/accessCodes/' + saved).once('value');
    const studentId = snap.val();
    if (!studentId) return;

    await firebase.auth().signInWithEmailAndPassword(
      studentId + '@professoroffunk.app',
      saved
    );
    currentStudent = studentId;
    await showApp();
  } catch (e) {
    console.warn('Auto-login failed:', e);
    sessionStorage.removeItem(AUTH_KEY);
  }
})();
```

**Step 2: Remove anonymous auth**

Delete line 284: `firebase.auth().signInAnonymously().catch(e => console.warn("Anon auth failed", e));`

Remove the old `waitForAuth()`, `loadAccessCodes()`, and `ACCESS_CODES` variable since we no longer need them.

**Step 3: Verify**

1. Open `professoroffunk.com`
2. Enter a student's access code
3. Should sign in and load student data
4. Practice tracking should still work (saves to Firebase)
5. Sign out works
6. Wrong access code shows error

**Step 4: Commit**

```bash
git add public/index.html
git commit -m "feat: switch student portal from anonymous to email/password auth via access codes"
```

---

### Task 6: Remove Mock Data from Student Portal

**Context:** Student portal has a ~80-line `MOCK_DATA` object (lines 122-205) used as fallback. Firebase is the source of truth.

**Files:**
- Modify: `public/index.html:122-330` (MOCK_DATA + data layer)

**Step 1: Delete the MOCK_DATA object**

Remove the entire `const MOCK_DATA = { ... };` block (lines 122-205).

**Step 2: Update loadStudentData to not use MOCK fallback**

Replace `loadStudentData()`:

```javascript
async function loadStudentData() {
  if (!currentStudent) return;
  studentData = await fbLoad("students/" + currentStudent, null);
}
```

**Step 3: Update getStudentData to handle null gracefully**

Replace `getStudentData()`:

```javascript
function getStudentData() {
  return studentData || { profile: { name: 'Student', instrument: '', program: '' }, lessons: {}, practice: {}, milestones: {}, resources: [] };
}
```

**Step 4: Verify**

1. Sign in as a student
2. All tabs should show real Firebase data
3. If student has no data yet, show empty states (not mock data)
4. Practice logging still works

**Step 5: Commit**

```bash
git add public/index.html
git commit -m "feat: remove mock data from student portal, Firebase is sole data source"
```

---

### Task 7: Deploy Firebase RTDB Security Rules

**Context:** Lock down the database so only admin can write most data, and students can only read their own data and write to their own practice log.

**Files:**
- Create: `database.rules.json`
- Modify: `firebase.json` — add database rules reference

**Step 1: Get admin UID**

From Task 1, you should have the admin UID. If not, check Firebase Console → Authentication → Users → find the admin account → copy UID.

**Step 2: Create rules file**

Create `database.rules.json` in the project root:

```json
{
  "rules": {
    "professorOfFunk": {
      "students": {
        "$studentId": {
          ".read": "auth.uid === 'REPLACE_WITH_ADMIN_UID' || auth.uid === data.child('profile/authUid').val()",
          ".write": "auth.uid === 'REPLACE_WITH_ADMIN_UID'",
          "practice": {
            ".write": "auth.uid === 'REPLACE_WITH_ADMIN_UID' || auth.uid === data.parent().child('profile/authUid').val()"
          }
        }
      },
      "meta": {
        "accessCodes": {
          ".read": "auth != null",
          "$code": {
            ".read": "auth != null"
          }
        },
        ".write": "auth.uid === 'REPLACE_WITH_ADMIN_UID'"
      },
      "ensembles": {
        ".read": "auth.uid === 'REPLACE_WITH_ADMIN_UID'",
        ".write": "auth.uid === 'REPLACE_WITH_ADMIN_UID'"
      },
      "lessonTranscripts": {
        ".read": "auth.uid === 'REPLACE_WITH_ADMIN_UID'",
        ".write": "auth.uid === 'REPLACE_WITH_ADMIN_UID'"
      }
    }
  }
}
```

Replace `REPLACE_WITH_ADMIN_UID` with the actual admin UID (appears 8 times).

**Step 3: Update firebase.json**

```json
{
  "database": {
    "rules": "database.rules.json"
  },
  "hosting": {
    "public": "public",
    "cleanUrls": true,
    "ignore": [
      "firebase.json",
      "**/.*",
      "**/node_modules/**"
    ]
  }
}
```

**Step 4: Deploy rules**

```bash
cd C:/Tools/Apps/professor-of-funk
npx firebase-tools deploy --only database --project professor-of-funk
```

**Step 5: Verify**

1. Admin sign-in → can read/write all student data, ensembles, transcripts
2. Student sign-in → can only read own data, can write own practice
3. Student cannot read other students' data
4. Unauthenticated requests get denied
5. Access code lookup works for authenticated users

**Step 6: Commit**

```bash
git add database.rules.json firebase.json
git commit -m "feat: deploy Firebase RTDB security rules - admin full access, students read own data only"
```

---

### Task 8: Final Deploy and Smoke Test

**Files:**
- Deploy: all changes to Firebase Hosting

**Step 1: Deploy everything**

```bash
cd C:/Tools/Apps/professor-of-funk
npx firebase-tools deploy --project professor-of-funk
```

This deploys both hosting (HTML files) and database rules.

**Step 2: Smoke test admin dashboard**

1. Go to `professoroffunk.com/admin`
2. Sign in with admin email/password
3. **Students tab**: verify student list loads from Firebase, add/edit/delete works
4. **Attendance tab**: mark attendance, verify it persists after refresh
5. **Payments tab**: add charge, record payment, verify balance updates
6. **Lessons tab**: save a transcript, verify it appears in saved list
7. **Ensembles tab**: verify ensemble data loads, add/edit songs works

**Step 3: Smoke test student portal**

1. Go to `professoroffunk.com`
2. Enter a student's access code
3. **Assignments tab**: shows latest lesson from admin
4. **Practice tab**: check off days, verify persists after refresh
5. **Lessons tab**: shows lesson history
6. **Progress tab**: shows milestones
7. **Resources tab**: shows resources (links may still be `#` — that's fine, Phase 3)

**Step 4: Verify cross-flow**

1. In admin, add a lesson for a student
2. In student portal (different browser/incognito), sign in as that student
3. Verify the lesson appears immediately (real-time sync)

**Step 5: Commit**

```bash
git add -A
git commit -m "feat: Phase 1 complete - real data flow with Firebase Auth and security rules"
```

---

### Task 9: Add `professoroffunk.com` to Firebase Auth Authorized Domains

**Context:** Firebase Auth requires the domain to be authorized for sign-in to work.

**Step 1:**

Go to Firebase Console → Authentication → Settings → Authorized domains → Add domain:
- `professoroffunk.com`

This is a manual step in the Firebase Console — no CLI command available.

**Step 2: Verify**

Sign in on `professoroffunk.com` (both admin and student portals) — should work without `auth/unauthorized-domain` errors.
