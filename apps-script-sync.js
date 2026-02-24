/**
 * Professor of Funk — Firebase -> Google Sheet Sync
 *
 * SETUP:
 * 1. Open the Google Sheet "Professor of Funk HQ"
 * 2. Go to Extensions > Apps Script
 * 3. Replace the existing code with this file's contents
 * 4. Set Script Properties (Project Settings > Script Properties):
 *    - FIREBASE_DB_URL = https://professor-of-funk-default-rtdb.firebaseio.com
 *    - FIREBASE_DB_SECRET = (your database secret from Firebase Console > Project Settings > Service Accounts > Database Secrets)
 * 5. Run syncAll() once manually to test
 * 6. Set up a time-based trigger: Triggers > Add Trigger > syncAll > Time-driven > Every 6 hours
 * 7. Optionally add custom menu: the onOpen() function adds a "Professor of Funk" menu with "Sync from Firebase"
 */

const DB_ROOT = 'professorOfFunk';

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Professor of Funk')
    .addItem('Sync from Firebase', 'syncAll')
    .addToMenu();
}

// ===== FIREBASE REST API =====

function getFirebaseUrl() {
  return PropertiesService.getScriptProperties().getProperty('FIREBASE_DB_URL');
}

function getFirebaseSecret() {
  return PropertiesService.getScriptProperties().getProperty('FIREBASE_DB_SECRET');
}

function fbGet(path) {
  const url = getFirebaseUrl() + '/' + DB_ROOT + '/' + path + '.json?auth=' + getFirebaseSecret();
  const resp = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
  if (resp.getResponseCode() !== 200) {
    Logger.log('Firebase GET error for ' + path + ': ' + resp.getContentText());
    return null;
  }
  return JSON.parse(resp.getContentText());
}

// ===== MAIN SYNC =====

function syncAll() {
  Logger.log('Starting Firebase -> Sheet sync at ' + new Date().toISOString());

  const students = fbGet('students');
  const ensembles = fbGet('ensembles');
  const rates = fbGet('meta/rates');

  if (!students) {
    Logger.log('ERROR: Could not load students from Firebase');
    return;
  }

  syncDatabaseTab(students, ensembles, rates);
  syncAttendanceTab(students, ensembles);
  syncPaymentsTab(students);
  syncRatesTab(students);

  Logger.log('Sync complete at ' + new Date().toISOString());
}

// ===== DATABASE TAB =====

function syncDatabaseTab(students, ensembles, rates) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName('Database');
  if (!sheet) {
    sheet = ss.insertSheet('Database');
  }

  const headers = [
    'Student Name', 'Instrument', 'Class/Band Name/ID', 'Start Date',
    'Age/Grade', 'Skill Level', 'Parent/Guardian', 'Parent Email',
    'Phone', 'Emergency Contact', 'Allergies', 'Active',
    'Access Code', 'Parent Access Code',
    'Total Classes', 'Total Tuition', 'Total Paid', 'Balance Due', 'Invoice Status'
  ];

  const rows = [];
  const sortedKeys = Object.keys(students).sort((a, b) => {
    const nameA = (students[a].profile || {}).name || a;
    const nameB = (students[b].profile || {}).name || b;
    return nameA.localeCompare(nameB);
  });

  sortedKeys.forEach(key => {
    const s = students[key];
    const p = s.profile || {};
    const programs = s.programs || {};

    // Compute billing
    let totalTuition = 0, totalClasses = 0;
    Object.entries(programs).forEach(([pid, prog]) => {
      const attended = Object.values((s.attendance || {})[pid] || {})
        .filter(a => a.present).length;
      totalClasses += attended;
      totalTuition += attended * (prog.rate || 0);
    });
    const totalPaid = Object.values(s.payments || {}).reduce((sum, pay) => sum + (pay.amount || 0), 0);
    const balance = totalTuition - totalPaid;
    const status = balance > 0 ? 'Unpaid' : balance < 0 ? 'Overpaid' : 'Paid';

    // Program names
    const programNames = Object.values(programs).map(pr => pr.name).join(', ');

    rows.push([
      p.name || key,
      p.instrument || '',
      programNames,
      p.startDate || '',
      p.ageGrade || '',
      p.skillLevel || '',
      p.parentName || '',
      p.parentEmail || '',
      p.phone || '',
      p.emergencyContact || '',
      p.allergies || '',
      p.active !== false ? 'TRUE' : 'FALSE',
      p.accessCode || '',
      p.parentAccessCode || '',
      totalClasses,
      totalTuition,
      totalPaid,
      balance,
      status
    ]);
  });

  // Clear and write
  sheet.clear();
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold');
  if (rows.length > 0) {
    sheet.getRange(2, 1, rows.length, headers.length).setValues(rows);
  }

  // Format currency columns
  if (rows.length > 0) {
    sheet.getRange(2, 16, rows.length, 3).setNumberFormat('$#,##0.00');
  }

  Logger.log('Database tab synced: ' + rows.length + ' students');
}

// ===== ATTENDANCE TAB =====

function syncAttendanceTab(students, ensembles) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName('Attendance');
  if (!sheet) {
    sheet = ss.insertSheet('Attendance');
  }

  // Get all program IDs from ensembles + private
  const programIds = [];
  if (ensembles) {
    Object.keys(ensembles).forEach(eid => programIds.push(eid));
  }
  programIds.push('private');

  sheet.clear();
  let col = 1;

  programIds.forEach(pid => {
    // Collect students enrolled in this program
    const enrolled = [];
    const allDates = new Set();

    Object.entries(students).forEach(([key, s]) => {
      if (s.programs && s.programs[pid]) {
        enrolled.push({ key, name: (s.profile || {}).name || key });
        const att = (s.attendance || {})[pid] || {};
        Object.keys(att).forEach(d => allDates.add(d));
      }
    });

    if (enrolled.length === 0) return;

    enrolled.sort((a, b) => a.name.localeCompare(b.name));
    const dates = Array.from(allDates).sort();

    // Program header
    const programName = pid === 'private' ? 'Private Lessons' :
      (ensembles && ensembles[pid] && ensembles[pid].info ? ensembles[pid].info.name : pid);

    // Write header row: Program Name | Student names...
    sheet.getRange(1, col).setValue(programName).setFontWeight('bold');
    enrolled.forEach((s, i) => {
      sheet.getRange(1, col + 1 + i).setValue(s.name).setFontWeight('bold');
    });

    // Write date rows
    dates.forEach((date, rowIdx) => {
      sheet.getRange(2 + rowIdx, col).setValue(date);
      enrolled.forEach((s, colIdx) => {
        const att = (students[s.key].attendance || {})[pid] || {};
        const entry = att[date];
        if (entry && entry.present) {
          sheet.getRange(2 + rowIdx, col + 1 + colIdx).setValue('P');
        } else if (entry && entry.present === false) {
          sheet.getRange(2 + rowIdx, col + 1 + colIdx).setValue('A');
        }
      });
    });

    // Move to next grid (leave a blank column gap)
    col += enrolled.length + 2;
  });

  Logger.log('Attendance tab synced');
}

// ===== PAYMENTS TAB =====

function syncPaymentsTab(students) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName('Payments');
  if (!sheet) {
    sheet = ss.insertSheet('Payments');
  }

  const headers = ['Date', 'Student', 'Amount', 'Method', 'Note', 'Program'];
  const rows = [];

  Object.entries(students).forEach(([key, s]) => {
    const name = (s.profile || {}).name || key;
    Object.values(s.payments || {}).forEach(pay => {
      rows.push([
        pay.date || '',
        name,
        pay.amount || 0,
        pay.method || '',
        pay.note || '',
        pay.programId || ''
      ]);
    });
  });

  // Sort by date descending
  rows.sort((a, b) => (b[0] || '').localeCompare(a[0] || ''));

  sheet.clear();
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold');
  if (rows.length > 0) {
    sheet.getRange(2, 1, rows.length, headers.length).setValues(rows);
    sheet.getRange(2, 3, rows.length, 1).setNumberFormat('$#,##0.00');
  }

  Logger.log('Payments tab synced: ' + rows.length + ' payments');
}

// ===== RATES TAB =====

function syncRatesTab(students) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName('Rates');
  if (!sheet) {
    sheet = ss.insertSheet('Rates');
  }

  const headers = ['Student', 'Program', 'Rate', 'Type'];
  const rows = [];

  Object.entries(students).forEach(([key, s]) => {
    const name = (s.profile || {}).name || key;
    Object.entries(s.programs || {}).forEach(([pid, prog]) => {
      rows.push([
        name,
        prog.name || pid,
        prog.rate || 0,
        prog.type || ''
      ]);
    });
  });

  rows.sort((a, b) => a[0].localeCompare(b[0]));

  sheet.clear();
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold');
  if (rows.length > 0) {
    sheet.getRange(2, 1, rows.length, headers.length).setValues(rows);
    sheet.getRange(2, 3, rows.length, 1).setNumberFormat('$#,##0.00');
  }

  Logger.log('Rates tab synced: ' + rows.length + ' entries');
}
