// Sprint 44 — Expanded Institutional Engine TDD Scaffold.
// Validates the time-boundary math of the new HOSPITAL_SHIFTS matrix in
// isolation before porting it into app/api/dispatch/route.js. Mirrors the
// shape of test-ticketmaster-geocoder.js / test-campus-engine.js.

const HOSPITAL_SHIFTS = [
  { start: 390, end: 450, mod: 4.0, label: "Morning Shift Overlap" },     // 6:30 AM - 7:30 AM
  { start: 870, end: 930, mod: 2.0, label: "Afternoon Clinic Shift" },    // 2:30 PM - 3:30 PM
  { start: 1110, end: 1170, mod: 3.0, label: "Evening Nursing Shift" },   // 6:30 PM - 7:30 PM
  { start: 1350, end: 1410, mod: 2.0, label: "Night Admin Shift" },       // 10:30 PM - 11:30 PM
];

function getHospitalShift(wallMinutes) {
  return HOSPITAL_SHIFTS.find(s => wallMinutes >= s.start && wallMinutes <= s.end) || null;
}

function assert(name, actual, expected) {
  const pass = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`${pass ? "PASS" : "FAIL"} — ${name}`);
  if (!pass) {
    console.log("   expected:", expected);
    console.log("   actual:  ", actual);
    process.exitCode = 1;
  }
}

// Assert 1: 6:45 AM falls inside the morning overlap window.
const a1 = getHospitalShift(405);
assert("Morning Overlap @ 405 mins → 4.0x / Morning Shift Overlap",
  { mod: a1?.mod, label: a1?.label },
  { mod: 4.0, label: "Morning Shift Overlap" });

// Assert 2: 2:45 PM falls inside the afternoon clinic window.
const a2 = getHospitalShift(885);
assert("Afternoon Clinic @ 885 mins → 2.0x / Afternoon Clinic Shift",
  { mod: a2?.mod, label: a2?.label },
  { mod: 2.0, label: "Afternoon Clinic Shift" });

// Assert 3: 6:45 PM falls inside the evening nursing window.
const a3 = getHospitalShift(1125);
assert("Evening Nursing @ 1125 mins → 3.0x / Evening Nursing Shift",
  { mod: a3?.mod, label: a3?.label },
  { mod: 3.0, label: "Evening Nursing Shift" });

// Assert 4: 10:45 PM falls inside the night admin window.
const a4 = getHospitalShift(1365);
assert("Night Admin @ 1365 mins → 2.0x / Night Admin Shift",
  { mod: a4?.mod, label: a4?.label },
  { mod: 2.0, label: "Night Admin Shift" });

// Assert 5: 12:00 PM falls in dead time — no match.
const a5 = getHospitalShift(720);
assert("Dead Time @ 720 mins → null", a5, null);
