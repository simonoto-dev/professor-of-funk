# Professor of Funk — Phase 1: Real Data Flow Design

## Goal

Make the admin dashboard and student portal use Firebase as the single source of truth. When the teacher saves a lesson, students see it immediately. Kill all hardcoded mock data.

## Context

Professor of Funk is a music teaching platform at `professoroffunk.com` with two views:

- **Admin dashboard** (`/admin`) — teacher manages students, lessons, payments, attendance, ensembles
- **Student portal** (`/`) — students see assignments, log practice, view history

Both currently rely on hardcoded `MOCK_DATA` with partial Firebase wiring. Firebase project: `professor-of-funk`, using Realtime Database.

**Scale**: 10+ students, growing. Teacher uses phone and laptop equally. Students check weekly.

## Architecture

### Data Structure (Firebase RTDB)

```
professorOfFunk/
  students/
    {studentId}/
      profile/
        name, instrument, program, startDate
        accessCode          — student's login code
        authUid             — Firebase Auth UID for this student
        parentName, parentEmail
      lessons/
        {lessonId}/
          date, title, summary
          keyConcepts[]
          areasOfFocus[]
          practicePlan/
            warmup, technical, repertoire, goal
      practice/
        {weekId}/
          mon, tue, wed, thu, fri, sat, sun  — booleans
          notes/
            {dayName}: "text"
      milestones/
        {milestoneId}/
          date, title, category, description
      resources/
        {resourceId}/
          title, type, url, lessonDate
      billing/
        rate, balance
        transactions/
          {txId}/
            date, type (charge|payment), amount, method, note
      attendance/
        {weekId}/
          {dayName}: "present" | "absent" | "cancelled"
  meta/
    accessCodes/
      {code}: {studentId}   — lookup table for student login
```

### Auth Model

**Admin**: Firebase Auth email/password. One account for the teacher. UID hardcoded in security rules.

**Students**: Firebase Auth email/password per student. Created by admin when adding a student. Access code maps to auth credentials stored in `meta/accessCodes`.

**Login flows**:
- Admin: email + password → Firebase Auth sign-in → load dashboard
- Student: access code → lookup `meta/accessCodes/{code}` → get studentId → sign in with stored credentials → load portal

### Security Rules

```json
{
  "rules": {
    "professorOfFunk": {
      "students": {
        "$studentId": {
          ".read": "auth.uid === 'ADMIN_UID' || auth.uid === data.child('profile/authUid').val()",
          ".write": "auth.uid === 'ADMIN_UID'",
          "practice": {
            ".write": "auth.uid === data.parent().child('profile/authUid').val()"
          }
        }
      },
      "meta": {
        ".read": "auth != null",
        ".write": "auth.uid === 'ADMIN_UID'"
      }
    }
  }
}
```

- Only admin can write lessons, milestones, resources, profiles, billing
- Students can only read their own data (matched by authUid)
- Students can only write to their own practice log
- Access codes readable by any authenticated user (needed for login)

## What Changes

### Admin Dashboard (`admin.html`)

- Replace hash-based password auth with Firebase email/password login
- Remove all `MOCK_DATA` — load from Firebase on startup
- Add Student: create Firebase Auth account + write profile + generate access code + update `meta/accessCodes`
- Edit Student: update profile in Firebase
- Add Lesson: save to `students/{id}/lessons/{lessonId}` — immediately visible to student
- Add Milestone: save to `students/{id}/milestones/{milestoneId}`
- Add Resource: save link/metadata to `students/{id}/resources/{resourceId}`
- Payments: write charges/payments to `students/{id}/billing/transactions/`
- Attendance: write to `students/{id}/attendance/{weekId}`

### Student Portal (`index.html`)

- Replace anonymous auth with email/password auth (credentials stored per student)
- Remove all `MOCK_DATA` references
- Access code login: lookup code → get studentId → sign in → load data
- All 5 tabs read exclusively from Firebase
- Practice tracker writes to Firebase (already mostly works, clean up)

## Not In Phase 1

- Parent dashboard (Phase 2)
- File uploads to Firebase Storage (Phase 3)
- Spreadsheet import for billing (Phase 4)
- Ensembles wired to Firebase (Phase 5)
- AI lesson summaries (dropped)

## Future Phases

- **Phase 2**: Parent dashboard + role-based auth (parent access codes, summary view with attendance rate, practice streak, billing)
- **Phase 3**: File uploads (Firebase Storage) + resource links for lesson materials
- **Phase 4**: Spreadsheet import + full billing system
- **Phase 5**: Ensembles wired to Firebase (repertoire, schedules, members)
