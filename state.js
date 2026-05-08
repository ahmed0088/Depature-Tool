// ═══════════════════════════════════════════════════════════
//  state.js  —  Single source of truth for all app data
//  Import this file before any feature module.
// ═══════════════════════════════════════════════════════════

// ── Departure board ───────────────────────────────────────
let depRooms   = [];
let depFilter_ = 'all';
let depSize    = 'md';
let depLog     = [];

// ── Arrivals ──────────────────────────────────────────────
let arrGuests  = [];
let arrFilter_ = 'all';

// ── Purpose of stay ───────────────────────────────────────
let purposeGuests  = [];
let purposeFilter_ = 'all';
let _purposeTitle  = 'Purpose of Stay Report';

// ── Immigration ───────────────────────────────────────────
let immigAllRows2  = [];
let immigFilter2_  = 'all';

// ── Modals ────────────────────────────────────────────────
let guestModalTarget = 'arrivals';

// ── Checklist ─────────────────────────────────────────────
let clEditMode = false;
const clState  = { done: new Set(), skipped: new Set() };

let CL_STEPS = [
  { id:1,  phase:'pre',  name:'Cancel non-guaranteed bookings',          tag:'check',  hint:'Filter reservations with no guarantee and cancel per policy.' },
  { id:2,  phase:'pre',  name:'CC recancellations',                      tag:'check',  hint:'Run credit card recancellations for failed/declined cards.' },
  { id:3,  phase:'pre',  name:'Cancel OTA rooms + mark card invalid',    tag:'check',  hint:'Cancel Booking.com/OTA rooms with invalid VCCs.' },
  { id:4,  phase:'pre',  name:'Check immigration / nationality report',  tag:'check',  hint:'Verify all in-house guests have nationality assigned.' },
  { id:5,  phase:'pre',  name:'Charge VCCs for tomorrow arrivals',       tag:'charge', hint:'Charge Virtual Credit Cards due tonight for tomorrow.' },
  { id:6,  phase:'pre',  name:'Update no-show sheet (pre-run)',          tag:'check',  hint:'Flag expected no-shows before running the night audit.' },
  { id:7,  phase:'pre',  name:'Save Inhouse Guest Complimentary report', tag:'save',   hint:'Export and save complimentary in-house guest report.' },
  { id:8,  phase:'pre',  name:'Zero rate room report — remove pseudo',   tag:'check',  hint:'Run zero-rate report. Pseudo rooms must be empty.' },
  { id:9,  phase:'pre',  name:'Paidout report + attach commission docs',  tag:'scan',   hint:'Save paidout report and scan/attach receipts.' },
  { id:10, phase:'pre',  name:'Refund report + attach documents',        tag:'scan',   hint:'Save refund report and scan/attach refund slips.' },
  { id:11, phase:'pre',  name:'Rate check — select check-in & search',   tag:'check',  hint:'Perform rate check before running the night.' },
  { id:12, phase:'run',  name:'Run the night audit',                     tag:'run',    hint:'Execute the night audit in Opera. Do not interrupt.' },
  { id:13, phase:'post', name:'Manager report',                          tag:'save',   hint:'Generate and save the manager report.' },
  { id:14, phase:'post', name:'No-show report + post charges',           tag:'save',   hint:'Finalise no-show list and post charges.' },
  { id:15, phase:'post', name:'Negative posting report',                 tag:'check',  hint:'Review all negative postings and resolve discrepancies.' },
  { id:16, phase:'post', name:'Room recancellations (post-night)',       tag:'check',  hint:'Process room recancellations held until after audit.' },
  { id:17, phase:'post', name:'Flash report',                            tag:'save',   hint:'Prepare and distribute the flash report.' },
];

// ── Shifts ────────────────────────────────────────────────
let activeShift = 'morning';

const SHIFTS = {
  morning:   { label:'Morning Shift',   time:'07:00 – 15:00', color:'#f0a43a', tasks:[], done:[], resetAt:'' },
  afternoon: { label:'Afternoon Shift', time:'15:00 – 23:00', color:'#5ab4e8', tasks:[], done:[], resetAt:'' },
  mid:       { label:'Mid Shift',       time:'12:00 – 20:00', color:'#8b7cf8', tasks:[], done:[], resetAt:'' },
  night:     { label:'Night Shift',     time:'23:00 – 07:00', color:'#3ecf8e', tasks:[], done:[], resetAt:'' },
};

const DEFAULT_TASKS = {
  morning: [
    { id:'m1', name:'Check overnight log from night shift',   hint:'Review all notes and handover items.' },
    { id:'m2', name:'Review arrivals for the day',            hint:'Check VIPs, special requests, early arrivals.' },
    { id:'m3', name:'Follow up on pending checkouts',         hint:'Call rooms not checked out by 11:00.' },
    { id:'m4', name:'Reconcile front desk float',             hint:'Count cash and verify amounts.' },
    { id:'m5', name:'Update departure board',                 hint:'Mark completed checkouts.' },
  ],
  afternoon: [
    { id:'a1', name:'Receive handover from morning shift',    hint:'Review all pending items and guest notes.' },
    { id:'a2', name:'Process remaining check-ins',            hint:'Prioritise waiting guests.' },
    { id:'a3', name:'Handle guest requests and complaints',   hint:'Log all issues in the complaint register.' },
    { id:'a4', name:'Prepare departure list for tomorrow',    hint:'Print and review next day departures.' },
    { id:'a5', name:'Update room status report',              hint:'Coordinate with housekeeping.' },
  ],
  mid: [
    { id:'md1', name:'Cover lunch breaks for morning shift',  hint:'Ensure front desk is staffed at all times.' },
    { id:'md2', name:'Process group check-ins',               hint:'Have keys and welcome packs ready.' },
    { id:'md3', name:'Coordinate with housekeeping',          hint:'Follow up on delayed departures.' },
    { id:'md4', name:'Handle concierge requests',             hint:'Transport, restaurant, tour bookings.' },
  ],
  night: [
    { id:'n1', name:'Receive handover from afternoon shift',  hint:'Review all outstanding items.' },
    { id:'n2', name:'Complete night audit checklist',         hint:'Follow all steps in the Night Run Checklist.' },
    { id:'n3', name:'Handle late arrivals',                   hint:'Check in pending arrivals after midnight.' },
    { id:'n4', name:'Prepare morning shift report',           hint:'Summarise events, balance, issues.' },
    { id:'n5', name:'Security rounds log',                    hint:'Complete and sign all security round docs.' },
  ],
};

// ── Feedback ──────────────────────────────────────────────
let feedbackLog = [];

// ── Copy buffers ──────────────────────────────────────────
let natCopyText  = '';
let rentCopyText = '';
let naCopyText   = '';
