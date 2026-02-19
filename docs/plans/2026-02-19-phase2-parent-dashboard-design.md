# Professor of Funk — Phase 2: Parent Dashboard Design

## Goal

Give parents a read-only summary dashboard showing attendance, practice streaks, and billing for all their children. Accessed via parent-specific access codes at `/parent`.

## Context

Phase 1 wired admin and student portals to Firebase. Parent contact info (name, email) already exists in student profiles. This phase adds a parent-facing view and the auth plumbing to support it.

**Scale**: 10+ students, some parents have multiple children. Parents check weekly.

## Architecture

### Data Structure (Firebase RTDB)

```
professorOfFunk/
  parents/
    {parentId}/
      profile/
        name              — "David & Sarah"
        email             — "mason.parents@email.com"
        accessCode        — "wong-family"
        authUid           — Firebase Auth UID for this parent
      children/
        {studentId}: true — links to students node
  meta/
    parentAccessCodes/
      {code}: {parentId}  — lookup table for parent login
```

Parent records are separate from student records. A parent can be linked to multiple students via the `children` map. The `parentAccessCodes` lookup table is separate from `accessCodes` to avoid collisions.

### Auth Model

**Parents**: Firebase Auth email/password per parent. Email format: `{parentId}@parent.professoroffunk.app`. Password: `accessCode + '!PoF'` (same suffix as students).

**Login flow**: Access code → lookup `meta/parentAccessCodes/{code}` → get parentId → sign in with stored credentials → load dashboard with all linked children.

### Security Rules

```json
{
  "parents": {
    "$parentId": {
      ".read": "auth.uid === 'ADMIN_UID' || auth.uid === data.child('profile/authUid').val()",
      ".write": "auth.uid === 'ADMIN_UID'"
    }
  },
  "meta": {
    "parentAccessCodes": {
      "$code": {
        ".read": true
      }
    }
  }
}
```

Student read rules expand to allow parent access:

```json
{
  "students": {
    "$studentId": {
      ".read": "auth.uid === 'ADMIN_UID' || auth.uid === data.child('profile/authUid').val() || root.child('professorOfFunk/parents').once().val() !== null"
    }
  }
}
```

Note: RTDB doesn't support iterating parents to check children links efficiently. Instead, store the parent's authUid directly on each linked student's profile (`parentAuthUid` field). This makes the rule simple:

```json
".read": "auth.uid === 'ADMIN_UID' || auth.uid === data.child('profile/authUid').val() || auth.uid === data.child('profile/parentAuthUid').val()"
```

## What Changes

### New File: `parent.html` (at `/parent`)

Read-only summary dashboard. Login with parent access code. Shows a card per child:

- Student name and instrument
- Attendance rate (% of non-cancelled lessons attended)
- Practice streak (current streak days + this month's practiced/elapsed)
- Billing balance ("Owes $X" or "Paid up")
- Next lesson date and time

No lesson content, no practice details, no milestones. Summary only.

**Design**: Same visual style as admin and student portals (dark theme, DM Serif Display headings, accent gold). No tabs — single scrollable page with one card per child.

### Admin Dashboard Changes (`admin.html`)

- Add "Parent Access Code" field to Add Student and Edit Student forms
- Auto-generate parent code from student key + "-parent" (e.g., `mason-parent`), admin can customize
- On save: if parentName matches an existing parent record, link student to it; otherwise create new parent record
- Create Firebase Auth account for new parents (same secondary app pattern as students)
- Store `parentAuthUid` on each linked student's profile
- Update `meta/parentAccessCodes` mapping

### Security Rules Update (`database.rules.json`)

- Add `parents` node rules (admin write, parent read own)
- Add `parentAccessCodes` to meta (public read per code, admin write)
- Expand student read rule to include `parentAuthUid`

## Not In Phase 2

- Parent can make payments (read-only for now)
- Parent can message teacher
- Parent email notifications
- Multiple parents per student (one parent record per student for now)

## Access Code Generation

When admin saves a student with a parentName:
1. Normalize parentName to generate a parentId key (e.g., "David & Sarah" → `david-sarah`)
2. Check if a parent record already exists with that parentId
3. If yes: link student to existing parent, reuse the access code
4. If no: create new parent record, generate access code as `{studentKey}-parent`, create Firebase Auth account, store authUid
5. Store `parentAuthUid` on the student's profile for security rules
