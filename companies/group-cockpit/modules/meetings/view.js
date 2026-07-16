/* ============================================================================
 * EPAL GROUP ERP  ·  companies/group-cockpit/modules/meetings/view.js
 * ----------------------------------------------------------------------------
 * MEETINGS & NOTES (route: group/meetings) — the group-wide meeting desk.
 *
 * The owner / super-admin schedules a meeting (topic, agenda, date+time,
 * duration, location or online link, attendees drawn from ANY sister concern);
 * every invited employee is NOTIFIED, can RSVP, and after the meeting the
 * minutes, decisions and action items are recorded against that meeting so the
 * whole thread — why we met, what we decided, who owes what by when — lives in
 * one place.
 *
 * One view serves every sub-route under Group ▸ Meetings & Notes:
 *   agenda   → KPIs, the "next up" hero, and the full meeting register (default)
 *   calendar → month grid; click a day to schedule, click a meeting to open it
 *   minutes  → minutes & standalone notes, pinnable, printable, shareable
 *   actions  → the action-item tracker (assignee · due date · done)
 *   rooms    → meeting rooms + scheduling defaults
 *
 * DATA IT OWNS (localStorage stores, ns epal.v1.):
 *   meetings        [{ id, title, topic, type, companyId, date 'YYYY-MM-DD',
 *                      time 'HH:MM', durationMin, mode, roomId, location, link,
 *                      organizerId, agenda:[{text,mins}], remindMin, status,
 *                      attendees:[{ empId, required, rsvp, attended }],
 *                      createdAt, updatedAt }]
 *   meeting_notes   [{ id, meetingId|null, kind 'minute'|'note', title, body,
 *                      decisions, authorId, at, pinned }]
 *   meeting_actions [{ id, meetingId|null, text, assigneeId, due, priority,
 *                      status 'open'|'done', createdAt, doneAt }]
 *   meeting_rooms   [{ id, name, location, capacity, facilities }]
 *   meeting_prefs   { defaultDurationMin, defaultRemindMin, defaultMode }
 *
 * BUSINESS RULES (the "why" a developer must preserve):
 *   - Only an admin/owner SCHEDULES. An ordinary employee sees only the meetings
 *     they organise or are invited to, and may change nothing but their own RSVP.
 *   - Inviting, rescheduling and cancelling all NOTIFY each attendee — an
 *     addressed notification (db.notify with `toId`), so the invite rings the
 *     attendee's bell and not the organiser's. See db.inbox() in database.js.
 *   - The organiser is an implicit attendee: they are never invited/notified and
 *     their RSVP is always 'accepted'. Removing them from a meeting is not a
 *     thing that can happen.
 *   - Double-booking is a WARNING, never a block: the schedule form lists every
 *     attendee already busy in the slot and lets the owner proceed anyway (real
 *     businesses overrule calendars; the system's job is to say so out loud).
 *   - A meeting's `status` is authoritative — 'completed' and 'cancelled' are
 *     set explicitly by a human. Time passing alone never mutates stored data;
 *     "overdue"/"in progress" are DERIVED at render time from the clock.
 *   - Cancelling KEEPS the record (with its minutes and actions) — it is history,
 *     not a mistake to erase. Only an explicit Delete removes it.
 *
 * ==> LARAVEL / PHP MAPPING: see backend/LARAVEL-BLUEPRINT.md in this folder —
 *     Meeting / MeetingAttendee / MeetingNote / MeetingAction / MeetingRoom
 *     models, a MeetingInvited/Rescheduled/Cancelled notification set fanned out
 *     over the attendees, and a MeetingPolicy carrying the rules above.
 * ==========================================================================*/

(function (EPAL) {
  'use strict';
  var ui = EPAL.ui, el = ui.el, S = EPAL.store;
  function db() { return EPAL.db; }

  /* ==========================================================================
   * CONSTANTS — the vocabulary of a meeting.
   * ========================================================================*/
  var TYPES = ['Board', 'Review', 'Stand-up', 'One-on-One', 'Client', 'Planning', 'Training', 'Interview'];

  var MODES = [['in-person', 'In person'], ['online', 'Online'], ['hybrid', 'Hybrid']];

  var DURATIONS = [[15, '15 minutes'], [30, '30 minutes'], [45, '45 minutes'], [60, '1 hour'],
    [90, '1½ hours'], [120, '2 hours'], [180, '3 hours'], [240, 'Half day']];

  var REMINDERS = [[0, 'No reminder'], [10, '10 minutes before'], [30, '30 minutes before'],
    [60, '1 hour before'], [180, '3 hours before'], [1440, '1 day before']];

  // rsvp state → the badge tone used everywhere it is shown
  var RSVP_TONE = { invited: 'info', accepted: 'good', declined: 'bad', tentative: 'warn' };
  var RSVP_LABEL = { invited: 'Invited', accepted: 'Accepted', declined: 'Declined', tentative: 'Tentative' };
  var STATUS_TONE = { scheduled: 'info', completed: 'good', cancelled: 'bad' };

  /* ==========================================================================
   * SEED — a believable meeting history so the desk is never an empty room.
   * Runs at the end of db.seed() (registerEngine), so employees already exist
   * and we can bind the seed to REAL people rather than invented ids.
   * ========================================================================*/
  var ROOMS_SEED = [
    { id: 'RM-01', name: 'Board Room',      location: 'Head Office, Gulshan-2 · Level 8', capacity: 14, facilities: 'Projector, video conferencing, whiteboard' },
    { id: 'RM-02', name: 'Meeting Room A',  location: 'Head Office, Gulshan-2 · Level 7', capacity: 8,  facilities: 'TV screen, whiteboard' },
    { id: 'RM-03', name: 'Meeting Room B',  location: 'Head Office, Gulshan-2 · Level 7', capacity: 6,  facilities: 'Whiteboard' },
    { id: 'RM-04', name: 'Travels Counter Floor', location: 'Travels Branch, Uttara',     capacity: 10, facilities: 'Open floor, portable screen' },
    { id: 'RM-05', name: 'Woodart Factory Office', location: 'Woodart Unit, Savar',       capacity: 12, facilities: 'Sample display table, projector' }
  ];

  // Local-time YYYY-MM-DD for `n` days from today. NOT toISOString() — that is
  // UTC and would slide the date back a day for a Dhaka (UTC+6) early morning.
  function ymd(d) {
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  function dayOffset(n) { var d = new Date(); d.setDate(d.getDate() + n); return ymd(d); }

  function seedMeetings() {
    // Bind to real seeded employees; fall back to the owner if a concern is thin.
    var all = db().employees();
    function from(companyId, n) {
      return all.filter(function (e) { return e.companyId === companyId; }).slice(0, n).map(function (e) { return e.id; });
    }
    function att(ids, rsvp) {
      return ids.map(function (id, i) {
        return { empId: id, required: i < 3, rsvp: rsvp || 'invited', attended: null };
      });
    }
    var OWNER = 'EPL-0001';

    return [
      { id: 'MTG-1001', title: 'Q4 FY26 Board Review', topic: 'Close the year: consolidated P&L, the Construction receivables drag, and sign-off on the FY27 budget envelope.',
        type: 'Board', companyId: 'group', date: dayOffset(-4), time: '10:00', durationMin: 120,
        mode: 'in-person', roomId: 'RM-01', location: '', link: '', organizerId: OWNER,
        agenda: [{ text: 'Consolidated P&L walkthrough', mins: 30 }, { text: 'Receivables > 60 days — Construction', mins: 30 },
                 { text: 'FY27 budget envelope per concern', mins: 45 }, { text: 'AOB', mins: 15 }],
        remindMin: 60, status: 'completed',
        attendees: att(from('construction', 2).concat(from('travels', 2)).concat(from('woodart', 1)), 'accepted'),
        createdAt: Date.now() - 12 * 864e5, updatedAt: Date.now() - 4 * 864e5 },

      { id: 'MTG-1002', title: 'Travels — Weekly Sales Stand-up', topic: 'Air ticketing + visa pipeline for the week; deadline board review.',
        type: 'Stand-up', companyId: 'travels', date: dayOffset(-2), time: '09:30', durationMin: 30,
        mode: 'in-person', roomId: 'RM-04', location: '', link: '', organizerId: OWNER,
        agenda: [{ text: 'Ticketing numbers vs target', mins: 10 }, { text: 'Visa applications at embassy', mins: 10 },
                 { text: 'TTL / deadline risks', mins: 10 }],
        remindMin: 30, status: 'completed', attendees: att(from('travels', 4), 'accepted'),
        createdAt: Date.now() - 9 * 864e5, updatedAt: Date.now() - 2 * 864e5 },

      { id: 'MTG-1003', title: 'Umrah Season Readiness', topic: 'Seat blocks, vendor rates and counter staffing before the Umrah rush.',
        type: 'Planning', companyId: 'travels', date: dayOffset(0), time: '15:00', durationMin: 60,
        mode: 'hybrid', roomId: 'RM-02', location: '', link: 'https://meet.google.com/epal-umrah-2026', organizerId: OWNER,
        agenda: [{ text: 'Contract flight seat blocks — confirmed vs held', mins: 20 },
                 { text: 'Vendor rate negotiation status', mins: 20 }, { text: 'Counter staffing roster', mins: 20 }],
        remindMin: 30, status: 'scheduled', attendees: att(from('travels', 4)),
        createdAt: Date.now() - 3 * 864e5, updatedAt: Date.now() - 3 * 864e5 },

      { id: 'MTG-1004', title: 'Skyline Developers — Fit-out Kick-off', topic: 'Interior fit-out scope, BOQ walkthrough and delivery milestones with the client.',
        type: 'Client', companyId: 'woodart', date: dayOffset(1), time: '11:30', durationMin: 90,
        mode: 'in-person', roomId: 'RM-01', location: '', link: '', organizerId: OWNER,
        agenda: [{ text: 'Scope & BOQ walkthrough', mins: 40 }, { text: 'Delivery milestones', mins: 30 },
                 { text: 'Payment schedule', mins: 20 }],
        remindMin: 60, status: 'scheduled', attendees: att(from('woodart', 3).concat(from('construction', 1))),
        createdAt: Date.now() - 2 * 864e5, updatedAt: Date.now() - 2 * 864e5 },

      { id: 'MTG-1005', title: 'IT — Sprint Planning', topic: 'Next sprint scope for the client portal and the internal ERP handover work.',
        type: 'Planning', companyId: 'it', date: dayOffset(3), time: '14:00', durationMin: 60,
        mode: 'online', roomId: '', location: '', link: 'https://meet.google.com/epal-it-sprint', organizerId: OWNER,
        agenda: [{ text: 'Last sprint review', mins: 15 }, { text: 'Backlog grooming', mins: 25 }, { text: 'Commit to sprint scope', mins: 20 }],
        remindMin: 30, status: 'scheduled', attendees: att(from('it', 3)),
        createdAt: Date.now() - 1 * 864e5, updatedAt: Date.now() - 1 * 864e5 },

      { id: 'MTG-1006', title: 'Monthly MD Review — All Concerns', topic: 'Every concern reports: revenue, margin, cash position, top three risks.',
        type: 'Review', companyId: 'group', date: dayOffset(6), time: '10:00', durationMin: 180,
        mode: 'in-person', roomId: 'RM-01', location: '', link: '', organizerId: OWNER,
        agenda: [{ text: 'Travels', mins: 30 }, { text: 'Construction', mins: 30 }, { text: 'Woodart', mins: 30 },
                 { text: 'IT Solutions', mins: 30 }, { text: 'Shop', mins: 30 }, { text: 'Group actions & close', mins: 30 }],
        remindMin: 1440, status: 'scheduled',
        attendees: att(from('travels', 1).concat(from('construction', 1)).concat(from('woodart', 1))
          .concat(from('it', 1)).concat(from('shop', 1))),
        createdAt: Date.now() - 5 * 864e5, updatedAt: Date.now() - 5 * 864e5 },

      { id: 'MTG-1007', title: 'One-on-One — Tanvir Hasan', topic: 'Quarterly career conversation: growth path, workload and tooling.',
        type: 'One-on-One', companyId: 'it', date: dayOffset(2), time: '16:30', durationMin: 45,
        mode: 'in-person', roomId: 'RM-03', location: '', link: '', organizerId: OWNER,
        agenda: [{ text: 'How the quarter felt', mins: 15 }, { text: 'Growth path & skills', mins: 20 }, { text: 'Anything blocking you', mins: 10 }],
        remindMin: 30, status: 'scheduled',
        attendees: [{ empId: 'EPL-DEV1', required: true, rsvp: 'accepted', attended: null }],
        createdAt: Date.now() - 2 * 864e5, updatedAt: Date.now() - 2 * 864e5 },

      { id: 'MTG-1008', title: 'Shop — Reorder Policy Workshop', topic: 'Fix the reorder levels that let six SKUs run dry.',
        type: 'Training', companyId: 'shop', date: dayOffset(-1), time: '12:00', durationMin: 60,
        mode: 'in-person', roomId: 'RM-02', location: '', link: '', organizerId: OWNER,
        agenda: [{ text: 'What went wrong', mins: 20 }, { text: 'New reorder thresholds', mins: 40 }],
        remindMin: 30, status: 'cancelled', attendees: att(from('shop', 3)),
        createdAt: Date.now() - 6 * 864e5, updatedAt: Date.now() - 2 * 864e5 }
    ];
  }

  function seedNotes() {
    return [
      { id: 'MN-2001', meetingId: 'MTG-1001', kind: 'minute', title: 'Minutes — Q4 FY26 Board Review',
        body: 'Consolidated revenue closed the year ahead of plan, but group margin is being eaten by Construction receivables — ৳12.4L is sitting past 60 days against a single main contractor.\n\nTravels carried the year on visa volume. Woodart is capacity-bound, not demand-bound: the Savar unit is the constraint.\n\nThe FY27 envelope was agreed in principle at last year + 12%, with the Construction line held flat until collections recover.',
        decisions: 'Construction receivables > 60 days to be escalated to the MD weekly until cleared.\nFY27 budget envelope approved in principle: +12% group-wide, Construction held flat.\nWoodart to cost a second finishing line at Savar and bring the number to the next board.',
        authorId: 'EPL-0001', at: Date.now() - 4 * 864e5 + 5400000, pinned: true },

      { id: 'MN-2002', meetingId: 'MTG-1002', kind: 'minute', title: 'Minutes — Travels Weekly Stand-up',
        body: 'Ticketing is tracking slightly under target for the week; the gap is entirely in corporate bookings, retail is fine.\n\nSeventeen visa applications are at the embassy. Two Malaysia files are at risk of missing their appointment window.\n\nThree ticketing deadlines fall inside the next five days.',
        decisions: 'The two at-risk Malaysia files get chased daily until the appointment is confirmed.\nCorporate outreach to restart this week.',
        authorId: 'EPL-0001', at: Date.now() - 2 * 864e5 + 2400000, pinned: false },

      { id: 'MN-2003', meetingId: null, kind: 'note', title: 'Thought — group-wide vendor consolidation',
        body: 'Travels, Woodart and Construction are each buying from overlapping vendors on separate terms. There is almost certainly a group rate hiding in that overlap.\n\nWorth pulling the vendor lists side by side before the next monthly review and seeing how much of the spend is actually the same handful of suppliers.',
        decisions: '', authorId: 'EPL-0001', at: Date.now() - 6 * 3600000, pinned: true }
    ];
  }

  function seedActions() {
    var all = db().employees();
    function one(companyId) {
      var e = all.filter(function (x) { return x.companyId === companyId; })[0];
      return e ? e.id : 'EPL-0001';
    }
    return [
      { id: 'MA-3001', meetingId: 'MTG-1001', text: 'Escalate the ৳12.4L Construction receivable to the main contractor in writing',
        assigneeId: one('construction'), due: dayOffset(-1), priority: 'high', status: 'open', createdAt: Date.now() - 4 * 864e5, doneAt: null },
      { id: 'MA-3002', meetingId: 'MTG-1001', text: 'Cost a second finishing line at the Savar unit and bring the number to the board',
        assigneeId: one('woodart'), due: dayOffset(9), priority: 'normal', status: 'open', createdAt: Date.now() - 4 * 864e5, doneAt: null },
      { id: 'MA-3003', meetingId: 'MTG-1001', text: 'Circulate the FY27 budget envelope to each concern head',
        assigneeId: 'EPL-0001', due: dayOffset(-2), priority: 'normal', status: 'done', createdAt: Date.now() - 4 * 864e5, doneAt: Date.now() - 3 * 864e5 },
      { id: 'MA-3004', meetingId: 'MTG-1002', text: 'Chase the two at-risk Malaysia visa files daily until the appointment is confirmed',
        assigneeId: one('travels'), due: dayOffset(1), priority: 'high', status: 'open', createdAt: Date.now() - 2 * 864e5, doneAt: null },
      { id: 'MA-3005', meetingId: 'MTG-1002', text: 'Restart corporate ticketing outreach — draft the target list',
        assigneeId: one('travels'), due: dayOffset(4), priority: 'normal', status: 'open', createdAt: Date.now() - 2 * 864e5, doneAt: null },
      { id: 'MA-3006', meetingId: 'MTG-1002', text: 'Publish the ticketing deadline board to the counter floor',
        assigneeId: one('travels'), due: dayOffset(-1), priority: 'low', status: 'done', createdAt: Date.now() - 2 * 864e5, doneAt: Date.now() - 1 * 864e5 }
    ];
  }

  EPAL.registerEngine({ name: 'meetings-seed', seed: function () {
    S.seedOnce('meeting_rooms', ROOMS_SEED);
    S.seedOnce('meeting_prefs', { defaultDurationMin: 60, defaultRemindMin: 30, defaultMode: 'in-person' });
    S.seedOnce('meetings', seedMeetings());
    S.seedOnce('meeting_notes', seedNotes());
    S.seedOnce('meeting_actions', seedActions());
  } });

  /* ==========================================================================
   * STORE ACCESSORS + DOMAIN HELPERS
   * ========================================================================*/
  function meetings() { return S.list('meetings'); }
  function notes()    { return S.list('meeting_notes'); }
  function actions()  { return S.list('meeting_actions'); }
  function rooms()    { return S.list('meeting_rooms'); }
  function prefs()    { return S.get('meeting_prefs', { defaultDurationMin: 60, defaultRemindMin: 30, defaultMode: 'in-person' }); }

  function emp(id) { return db().employee(id) || null; }
  function empName(id) { var e = emp(id); return e ? e.name : (id || 'Unknown'); }

  function meId() { return (EPAL.auth.current() || {}).id; }
  function canManage() { return EPAL.auth.isAdmin(); }                 // schedule / edit / cancel anything
  function canEdit(m) { return canManage() || m.organizerId === meId(); }

  // A meeting's clock. `date`+`time` are stored as local wall-clock strings —
  // exactly how a person wrote them down — and resolved against the local zone.
  function startsAt(m) {
    var t = Date.parse((m.date || '') + 'T' + (m.time || '00:00'));
    return isNaN(t) ? 0 : t;
  }
  function endsAt(m) { return startsAt(m) + (+m.durationMin || 30) * 60000; }
  function isPast(m) { return endsAt(m) < Date.now(); }
  function isLive(m) { return m.status === 'scheduled' && startsAt(m) <= Date.now() && endsAt(m) >= Date.now(); }

  // Every person the meeting concerns — organiser first, then the invitees.
  function participantIds(m) {
    return [m.organizerId].concat((m.attendees || []).map(function (a) { return a.empId; }));
  }
  function involves(m, empId) { return participantIds(m).indexOf(empId) >= 0; }

  /* What the CURRENT user is allowed to see. Admins hold the whole group's
     calendar; everyone else sees only the meetings they are actually part of. */
  function visibleMeetings() {
    if (canManage()) return meetings();
    var id = meId();
    return meetings().filter(function (m) { return involves(m, id); });
  }

  function myAttendance(m) {
    var id = meId();
    return (m.attendees || []).filter(function (a) { return a.empId === id; })[0] || null;
  }

  function whereText(m) {
    if (m.mode === 'online') return m.link ? 'Online' : 'Online (link to follow)';
    var r = rooms().filter(function (x) { return x.id === m.roomId; })[0];
    var place = r ? r.name : (m.location || 'Location TBC');
    return m.mode === 'hybrid' ? place + ' + online' : place;
  }
  function whereDetail(m) {
    var r = rooms().filter(function (x) { return x.id === m.roomId; })[0];
    var bits = [];
    if (r) bits.push(r.name + (r.location ? ' — ' + r.location : ''));
    else if (m.location) bits.push(m.location);
    if (m.mode !== 'in-person' && m.link) bits.push(m.link);
    return bits.join(' · ') || 'Location to be confirmed';
  }

  function coBadge(cid) {
    var co = EPAL.config.company(cid);
    if (!co) return '<span class="badge">Group</span>';
    return '<span class="badge" style="color:' + co.accent + '">' + ui.escapeHtml(co.short) + '</span>';
  }
  function badge(text, tone) {
    return '<span class="badge badge-' + tone + '">' + ui.escapeHtml(text) + '</span>';
  }

  // "Fri 18 Jul · 10:00 – 11:30"
  function whenText(m) {
    var s = new Date(startsAt(m)), e = new Date(endsAt(m));
    var d = s.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
    var t = function (x) { return String(x.getHours()).padStart(2, '0') + ':' + String(x.getMinutes()).padStart(2, '0'); };
    return d + ' · ' + t(s) + ' – ' + t(e);
  }
  function hhmm(ts) {
    var d = new Date(ts);
    return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  }
  // "in 2h 15m" / "10m ago" — derived from the clock, never stored.
  function countdown(m) {
    if (isLive(m)) return 'in progress now';
    var diff = startsAt(m) - Date.now();
    return diff < 0 ? ui.ago(startsAt(m)) : 'in ' + ui.dur(diff);
  }

  function redraw() { EPAL.router.render(); }
  function touched(store) { EPAL.bus.emit('data:changed', { store: store }); }

  /* ==========================================================================
   * NOTIFICATIONS — the reason the employee ever hears about any of this.
   * One ADDRESSED notification per attendee (`toId`), so it rings their bell
   * and not the organiser's. See db.inbox() / database.js.
   * ========================================================================*/
  function notifyAttendees(m, kind, extra) {
    var copy = {
      invite:    { level: 'info',    icon: 'calendar-plus',        title: 'Meeting invite' },
      update:    { level: 'warning', icon: 'calendar-event',       title: 'Meeting rescheduled' },
      cancel:    { level: 'error',   icon: 'calendar-x',           title: 'Meeting cancelled' },
      reminder:  { level: 'info',    icon: 'bell-fill',            title: 'Meeting reminder' },
      minutes:   { level: 'success', icon: 'journal-text',         title: 'Minutes published' }
    }[kind];
    if (!copy) return 0;

    var sent = 0;
    (m.attendees || []).forEach(function (a) {
      if (a.empId === m.organizerId) return;         // the organiser is not their own invitee
      if (kind !== 'cancel' && a.rsvp === 'declined') return;   // stop nagging someone who said no
      db().notify({
        toId: a.empId, level: copy.level, icon: copy.icon, companyId: m.companyId,
        title: copy.title + ' — ' + m.title,
        text: (extra ? extra + ' ' : '') + whenText(m) + ' · ' + whereText(m) +
              (kind === 'invite' ? ' · Please RSVP.' : '')
      });
      sent++;
    });
    return sent;
  }

  // The counterpart: tell the ORGANISER what an attendee just did.
  function notifyOrganizer(m, text, level) {
    if (m.organizerId === meId()) return;    // don't notify yourself about yourself
    db().notify({
      toId: m.organizerId, level: level || 'info', icon: 'person-check-fill', companyId: m.companyId,
      title: m.title, text: text
    });
  }

  /* ==========================================================================
   * CONFLICT DETECTION — who is already busy in this slot?
   * A warning, never a block (see the business rules at the top of this file).
   * ========================================================================*/
  function conflictsFor(draft, ignoreId) {
    var s = startsAt(draft), e = endsAt(draft);
    var out = [];
    participantIds(draft).forEach(function (pid) {
      meetings().forEach(function (other) {
        if (other.id === ignoreId || other.status === 'cancelled') return;
        if (!involves(other, pid)) return;
        if (startsAt(other) < e && endsAt(other) > s) {     // overlap test
          out.push({ empId: pid, meeting: other });
        }
      });
    });
    return out;
  }

  /* ==========================================================================
   * SECTION BAND — the house full-bleed underline band. Labels mirror the
   * registry (config.js subs); the default section owns the bare route.
   * ========================================================================*/
  var SECTIONS = [['agenda', 'Agenda'], ['calendar', 'Calendar'], ['minutes', 'Minutes & Notes'],
    ['actions', 'Action Items'], ['rooms', 'Rooms & Setup']];

  function sectionNav(sub) {
    var nav = el('div.tab-underline.mb-3');
    SECTIONS.forEach(function (s) {
      nav.appendChild(el('button' + (sub === s[0] ? '.active' : ''), { text: s[1],
        onclick: function () { EPAL.router.navigate('group/meetings' + (s[0] === 'agenda' ? '' : '/' + s[0])); } }));
    });
    return nav;
  }

  /* ==========================================================================
   * VIEW
   * ========================================================================*/
  EPAL.view('group/meetings', { render: function (ctx) {
    var sub = ctx.subId || 'agenda';
    var page = el('div.page');

    var titles = { agenda: 'Meetings & Notes', calendar: 'Meeting Calendar', minutes: 'Minutes & Notes',
      actions: 'Action Items', rooms: 'Rooms & Scheduling Defaults' };
    var subs = {
      agenda:   'Schedule the group\'s meetings, invite people from any concern, and keep the thread — agenda, minutes, decisions, actions — in one place.',
      calendar: 'The whole group\'s month at a glance. Click a day to schedule; click a meeting to open it.',
      minutes:  'What was actually said and decided — attached to its meeting, printable, shareable.',
      actions:  'Every commitment made in a meeting, with an owner and a due date. Nothing quietly disappears.',
      rooms:    'The rooms you meet in and the defaults every new meeting starts from.'
    };

    // Rooms & Setup is an admin bench, not an employee screen.
    if (sub === 'rooms' && !canManage()) { EPAL.router.navigate('group/meetings'); return; }

    page.appendChild(EPAL.pageHead({
      eyebrow: 'Epal Group · Command Layer', icon: 'calendar2-week-fill',
      title: titles[sub] || 'Meetings & Notes', sub: subs[sub],
      actions: [
        sub === 'minutes' ? el('button.btn.btn-ghost', { html: ui.icon('journal-plus') + ' New Note',
          onclick: function () { editNote(null); } }) : null,
        (sub === 'actions' && canManage()) ? el('button.btn.btn-ghost', { html: ui.icon('plus-lg') + ' New Action',
          onclick: function () { editAction(null); } }) : null,
        (sub === 'rooms' && canManage()) ? el('button.btn.btn-ghost', { html: ui.icon('door-open-fill') + ' Add Room',
          onclick: function () { editRoom(null); } }) : null,
        canManage() ? el('button.btn.btn-primary', { html: ui.icon('calendar-plus') + ' Schedule Meeting',
          onclick: function () { editMeeting(null); } }) : null
      ]
    }));
    page.appendChild(sectionNav(sub));

    if (sub === 'calendar')     renderCalendar(page);
    else if (sub === 'minutes') renderMinutes(page);
    else if (sub === 'actions') renderActions(page);
    else if (sub === 'rooms')   renderRooms(page);
    else                        renderAgenda(page);

    ctx.mount.appendChild(page);

    // Deep-link support: #/group/meetings?open=MTG-1001 opens straight to a meeting
    // (this is what a notification / a printed minute's reference points at).
    var openId = (ctx.params || {}).open;
    if (openId) {
      var m = meetings().filter(function (x) { return x.id === openId; })[0];
      if (m && (canManage() || involves(m, meId()))) openMeeting(m);
    }
  } });

  /* ==========================================================================
   * SECTION · AGENDA — KPIs, the next-up hero, and the meeting register.
   * ========================================================================*/
  function kpi(label, value, icon, foot) {
    return el('div.kpi-card', null, [
      el('div.kpi-top', null, [ el('span.kpi-label', { text: label }),
        el('span.kpi-ico', { html: '<i class="bi bi-' + icon + '"></i>' }) ]),
      el('div.kpi-value', { text: String(value) }),
      foot ? el('div.kpi-foot', null, [ el('span.text-muted', { text: foot }) ]) : null
    ]);
  }

  function renderAgenda(page) {
    var mine = visibleMeetings();
    var now = Date.now(), weekOut = now + 7 * 864e5;

    var upcoming = mine.filter(function (m) {
      return m.status === 'scheduled' && startsAt(m) >= now && startsAt(m) <= weekOut;
    }).sort(function (a, b) { return startsAt(a) - startsAt(b); });

    // Awaiting MY reply — the one number an employee actually cares about.
    var awaiting = mine.filter(function (m) {
      if (m.status !== 'scheduled' || isPast(m)) return false;
      var a = myAttendance(m);
      return a && a.rsvp === 'invited';
    });

    var myActions = actions().filter(function (a) {
      return a.status === 'open' && (canManage() || a.assigneeId === meId());
    });
    var overdue = myActions.filter(function (a) { return a.due && Date.parse(a.due + 'T23:59') < now; });

    // Hours spent in meetings this calendar month (cancelled ones never happened).
    var mStart = new Date(); mStart.setDate(1); mStart.setHours(0, 0, 0, 0);
    var monthMins = mine.filter(function (m) {
      return m.status !== 'cancelled' && startsAt(m) >= mStart.getTime() && startsAt(m) <= now;
    }).reduce(function (s, m) { return s + (+m.durationMin || 0); }, 0);

    page.appendChild(el('div.kpi-grid.stagger', null, [
      kpi('Next 7 days', upcoming.length, 'calendar2-week-fill', upcoming.length ? 'first: ' + countdown(upcoming[0]) : 'nothing scheduled'),
      kpi('Awaiting your RSVP', awaiting.length, 'envelope-exclamation-fill', awaiting.length ? 'they are waiting on you' : 'you have replied to all'),
      kpi('Open action items', myActions.length, 'check2-square', overdue.length ? overdue.length + ' past their due date' : 'none overdue'),
      kpi('Meeting hours', (monthMins / 60).toFixed(1), 'hourglass-split', 'this month, so far')
    ]));

    // ---- The next-up hero: the single most useful thing on the page --------
    var next = upcoming[0] || mine.filter(function (m) { return isLive(m); })[0];
    if (next) page.appendChild(nextUpCard(next));

    // ---- The register ------------------------------------------------------
    page.appendChild(el('div.section-label', { text: canManage() ? 'All meetings' : 'Your meetings' }));

    var mode = 'upcoming';                       // upcoming | past | all
    var pills = el('div.pill-tab.mb-3');
    [['upcoming', 'Upcoming'], ['past', 'Past'], ['all', 'All']].forEach(function (p) {
      pills.appendChild(el('button' + (mode === p[0] ? '.active' : ''), { text: p[1], onclick: function (e) {
        mode = p[0];
        ui.$$('button', pills).forEach(function (b) { b.classList.remove('active'); });
        e.target.classList.add('active');
        table.refresh();
      } }));
    });
    page.appendChild(el('div', null, [pills]));

    function rows() {
      var list = visibleMeetings();
      if (mode === 'upcoming') list = list.filter(function (m) { return !isPast(m) && m.status !== 'cancelled'; });
      if (mode === 'past')     list = list.filter(function (m) { return isPast(m) || m.status === 'cancelled'; });
      return list.sort(function (a, b) {
        return mode === 'past' ? startsAt(b) - startsAt(a) : startsAt(a) - startsAt(b);
      });
    }

    var table = EPAL.table({
      columns: [
        { key: 'title', label: 'Meeting', render: function (m) {
            var flag = isLive(m) ? ' ' + badge('Live', 'good') : '';
            return '<span class="strong">' + ui.escapeHtml(m.title) + '</span>' + flag +
                   '<div class="text-mute xs">' + ui.escapeHtml((m.topic || '').slice(0, 78) + ((m.topic || '').length > 78 ? '…' : '')) + '</div>';
          } },
        { key: 'type', label: 'Type' },
        { key: 'companyId', label: 'Concern', render: function (m) { return coBadge(m.companyId); } },
        { key: 'date', label: 'When', render: function (m) {
            return '<span class="nowrap">' + ui.escapeHtml(whenText(m)) + '</span>' +
                   '<div class="text-mute xs">' + ui.escapeHtml(m.status === 'scheduled' && !isPast(m) ? countdown(m) : ui.ago(startsAt(m))) + '</div>';
          },
          sortVal: function (m) { return startsAt(m); },
          exportVal: function (m) { return m.date + ' ' + m.time; } },
        { key: 'roomId', label: 'Where', render: function (m) { return '<span class="text-mute">' + ui.escapeHtml(whereText(m)) + '</span>'; },
          exportVal: function (m) { return whereText(m); } },
        { key: 'attendees', label: 'People', render: function (m) {
            var people = (m.attendees || []).slice(0, 4);
            var stack = people.map(function (a) {
              var name = empName(a.empId);
              return '<span class="avatar" style="background:' + ui.colorFor(name) + '" title="' + ui.escapeHtml(name) + '">' +
                     ui.escapeHtml(ui.initials(name)) + '</span>';
            }).join('');
            var more = (m.attendees || []).length - people.length;
            return '<div class="avatar-stack">' + stack + '</div>' +
                   (more > 0 ? '<span class="text-mute xs">+' + more + ' more</span>' : '');
          },
          sort: false,
          exportVal: function (m) { return (m.attendees || []).map(function (a) { return empName(a.empId); }).join('; '); } },
        { key: 'status', label: 'Status', badge: STATUS_TONE }
      ],
      rows: rows,
      filters: [{ key: 'type', label: 'Type' }, { key: 'status', label: 'Status' }, { key: 'companyId', label: 'Concern' }],
      searchKeys: ['title', 'topic', 'type'],
      exportName: 'group-meetings.csv',
      pageSize: 10,
      onRow: function (m) { openMeeting(m); },
      // House row-action grammar: edit · delete │ print · wa · gmail (no eye —
      // the ROW opens the meeting). A meeting has many attendees and no single
      // phone number, so WhatsApp goes out with an empty `phone`: wa.me/?text=…
      // opens WhatsApp's own chat picker, which is exactly the right gesture for
      // "share this to the group chat". Gmail can address them all at once.
      actions: canManage() ? ui.actions({
        edit: function (m) { editMeeting(m); },
        del: function (m) { deleteMeeting(m); },
        print: function (m) { printMeeting(m); },
        wa:    function (m) { return { phone: '', text: meetingPlainText(m) }; },
        waTitle: 'Share on WhatsApp',
        gmail: function (m) { return { to: attendeeEmails(m), subject: 'Meeting — ' + m.title, body: meetingPlainText(m) }; },
        gmailTitle: 'Email all attendees'
      }) : [
        { icon: 'printer', title: 'Print', onClick: function (m) { printMeeting(m); } }
      ],
      empty: { icon: 'calendar2-x', title: 'No meetings here',
        hint: canManage() ? 'Schedule one — everyone invited gets notified.' : 'You have no meetings in this list.' }
    });
    page.appendChild(el('div.card', null, [ el('div.card-pad', null, [ table.el ]) ]));
  }

  /* The hero card for the very next meeting — when, where, who, and the two
     buttons a person actually wants (RSVP if they owe one, open otherwise). */
  function nextUpCard(m) {
    var a = myAttendance(m);
    var live = isLive(m);

    var people = el('div.avatar-stack');
    participantIds(m).slice(0, 8).forEach(function (pid) {
      var n = empName(pid);
      people.appendChild(el('span.avatar', { style: { background: ui.colorFor(n) }, title: n, text: ui.initials(n) }));
    });

    return el('div.card.stagger', { style: { borderColor: live ? 'var(--good)' : 'var(--border-accent)' } }, [
      el('div.card-pad', null, [
        el('div.flex.items-center.justify-between.flex-wrap.gap-2', null, [
          el('div', null, [
            el('div.flex.items-center.gap-2', null, [
              el('span.section-label', { style: { margin: '0' }, text: live ? 'Happening now' : 'Next up' }),
              ui.frag(coBadge(m.companyId)),
              ui.frag(badge(m.type, 'info'))
            ]),
            el('h3', { style: { margin: '6px 0 2px' }, text: m.title }),
            el('div.text-mute.sm', { text: whenText(m) + ' · ' + whereDetail(m) }),
            el('div.text-mute.xs', { style: { marginTop: '4px' }, text: 'Called by ' + empName(m.organizerId) + ' · ' + countdown(m) })
          ]),
          el('div.flex.items-center.gap-2.flex-wrap', null, [
            people,
            (m.mode !== 'in-person' && m.link) ? el('a.btn.btn-ghost', { href: m.link, target: '_blank', rel: 'noopener',
              html: ui.icon('camera-video-fill') + ' Join' }) : null,
            (a && a.rsvp === 'invited') ? el('button.btn.btn-primary', { html: ui.icon('check-lg') + ' Accept',
              onclick: function () { setRsvp(m, meId(), 'accepted'); } }) : null,
            el('button.btn' + (a && a.rsvp === 'invited' ? '.btn-ghost' : '.btn-primary'), {
              html: ui.icon('box-arrow-up-right') + ' Open', onclick: function () { openMeeting(m); } })
          ])
        ])
      ])
    ]);
  }

  /* ==========================================================================
   * SECTION · CALENDAR — a month grid of the group's meetings.
   * Built with inline grid styling on design tokens: there is no month-grid in
   * the design system yet, and one-off layout via style objects is the house
   * pattern (Phase 4 converts these to Tailwind with everything else).
   * ========================================================================*/
  function renderCalendar(page) {
    var cursor = new Date(); cursor.setDate(1); cursor.setHours(0, 0, 0, 0);
    var host = el('div');
    page.appendChild(host);

    function draw() {
      host.innerHTML = '';
      var year = cursor.getFullYear(), month = cursor.getMonth();
      var first = new Date(year, month, 1);
      var startPad = first.getDay();                          // 0=Sun … 6=Sat
      var daysInMonth = new Date(year, month + 1, 0).getDate();
      var todayKey = ymd(new Date());

      // Bucket this month's meetings by day so each cell is one lookup.
      var byDay = {};
      visibleMeetings().forEach(function (m) {
        if (!m.date) return;
        (byDay[m.date] = byDay[m.date] || []).push(m);
      });
      Object.keys(byDay).forEach(function (k) {
        byDay[k].sort(function (a, b) { return startsAt(a) - startsAt(b); });
      });

      var monthMeetings = visibleMeetings().filter(function (m) {
        var d = new Date(startsAt(m));
        return d.getFullYear() === year && d.getMonth() === month && m.status !== 'cancelled';
      });

      var bar = el('div.flex.items-center.justify-between.flex-wrap.gap-2.mb-3', null, [
        el('div.flex.items-center.gap-2', null, [
          el('button.btn.btn-ghost', { html: ui.icon('chevron-left'), 'aria-label': 'Previous month',
            onclick: function () { cursor.setMonth(cursor.getMonth() - 1); draw(); } }),
          el('h3', { style: { margin: '0', minWidth: '190px', textAlign: 'center' },
            text: first.toLocaleDateString(undefined, { month: 'long', year: 'numeric' }) }),
          el('button.btn.btn-ghost', { html: ui.icon('chevron-right'), 'aria-label': 'Next month',
            onclick: function () { cursor.setMonth(cursor.getMonth() + 1); draw(); } }),
          el('button.btn.btn-ghost', { text: 'Today', onclick: function () {
            var t = new Date(); cursor = new Date(t.getFullYear(), t.getMonth(), 1); draw(); } })
        ]),
        el('span.text-mute.sm', { text: monthMeetings.length + ' meeting' + (monthMeetings.length === 1 ? '' : 's') + ' this month' })
      ]);
      host.appendChild(bar);

      var grid = el('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0, 1fr))', gap: '1px',
        background: 'var(--border)', border: '1px solid var(--border)', borderRadius: '12px', overflow: 'hidden' } });

      ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].forEach(function (d) {
        grid.appendChild(el('div.text-mute.xs', { style: { background: 'var(--surface-2)', padding: '8px 10px',
          fontWeight: '600', textAlign: 'center' }, text: d }));
      });

      // Leading blanks, then the real days.
      for (var p = 0; p < startPad; p++) {
        grid.appendChild(el('div', { style: { background: 'var(--surface-2)', minHeight: '108px', opacity: '.45' } }));
      }
      for (var day = 1; day <= daysInMonth; day++) {
        grid.appendChild(dayCell(new Date(year, month, day), byDay, todayKey));
      }
      // Trailing blanks so the last row is a full 7 cells.
      var used = (startPad + daysInMonth) % 7;
      if (used) for (var t = used; t < 7; t++) {
        grid.appendChild(el('div', { style: { background: 'var(--surface-2)', minHeight: '108px', opacity: '.45' } }));
      }
      host.appendChild(el('div.card', null, [ el('div.card-pad', null, [ grid ]) ]));
    }

    function dayCell(d, byDay, todayKey) {
      var key = ymd(d);
      var list = byDay[key] || [];
      var isToday = key === todayKey;

      var cell = el('div', { style: { background: 'var(--surface)', minHeight: '108px', padding: '6px',
        cursor: canManage() ? 'pointer' : 'default', position: 'relative' },
        // Clicking empty space in a day schedules INTO that day — the single
        // most natural gesture on a calendar.
        onclick: canManage() ? function (e) {
          if (e.target !== cell && e.target.parentNode !== cell) return;   // a chip was clicked, not the cell
          editMeeting(null, key);
        } : null });

      cell.appendChild(el('div.flex.items-center.justify-between', null, [
        el('span' + (isToday ? '.fw-700' : '.text-mute'), { style: isToday ? {
          background: 'var(--accent)', color: '#fff', borderRadius: '6px', padding: '1px 6px', fontSize: 'var(--fs-micro)'
        } : { fontSize: 'var(--fs-micro)' }, text: String(d.getDate()) }),
        list.length > 2 ? el('span.text-mute.xs', { text: '+' + (list.length - 2) }) : null
      ]));

      list.slice(0, 2).forEach(function (m) {
        var co = EPAL.config.company(m.companyId);
        var tone = m.status === 'cancelled' ? 'var(--text-mute)' : (co ? co.accent : 'var(--accent)');
        cell.appendChild(el('div', {
          title: m.title + ' · ' + whenText(m) + ' · ' + whereText(m),
          style: { marginTop: '4px', padding: '3px 6px', borderRadius: '6px', cursor: 'pointer',
            borderLeft: '3px solid ' + tone, background: 'var(--surface-2)',
            fontSize: 'var(--fs-micro)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
            textDecoration: m.status === 'cancelled' ? 'line-through' : 'none',
            opacity: m.status === 'cancelled' ? '.6' : '1' },
          onclick: function (e) { e.stopPropagation(); openMeeting(m); },
          text: hhmm(startsAt(m)) + ' ' + m.title
        }));
      });
      return cell;
    }

    draw();
  }

  /* ==========================================================================
   * SECTION · MINUTES & NOTES
   * ========================================================================*/
  function renderMinutes(page) {
    var visibleIds = {};
    visibleMeetings().forEach(function (m) { visibleIds[m.id] = m; });

    // A note is visible if it hangs off a meeting you can see, or it is a
    // standalone note and you are an admin (standalone notes are the owner's
    // own thinking, not company-wide reading).
    function visibleNotes() {
      return notes().filter(function (n) {
        if (n.meetingId) return !!visibleIds[n.meetingId];
        return canManage();
      }).sort(function (a, b) {
        if (!!b.pinned !== !!a.pinned) return (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0);
        return b.at - a.at;
      });
    }

    var state = { q: '', kind: 'all' };
    var bar = el('div.flex.items-center.gap-2.flex-wrap.mb-3', null, [
      el('div.search-trigger', { style: { cursor: 'text', minWidth: '260px' } }, [
        ui.frag(ui.icon('search')),
        el('input.input', { placeholder: 'Search titles, minutes, decisions…',
          style: { border: 'none', background: 'none', padding: '0' },
          oninput: ui.debounce(function (e) { state.q = e.target.value.toLowerCase(); draw(); }, 150) })
      ]),
      el('div.flex.gap-1.flex-wrap', null, [['all', 'All'], ['minute', 'Minutes'], ['note', 'Notes']].map(function (k) {
        return el('button.chip' + (k[0] === 'all' ? '.active' : ''), { text: k[1], onclick: function (e) {
          state.kind = k[0];
          ui.$$('.chip', bar).forEach(function (x) { x.classList.remove('active'); });
          e.target.classList.add('active');
          draw();
        } });
      }))
    ]);
    page.appendChild(bar);

    var grid = el('div.grid-auto.stagger');
    page.appendChild(grid);

    function draw() {
      var list = visibleNotes().filter(function (n) {
        if (state.kind !== 'all' && n.kind !== state.kind) return false;
        if (state.q && (n.title + ' ' + n.body + ' ' + (n.decisions || '')).toLowerCase().indexOf(state.q) < 0) return false;
        return true;
      });
      grid.innerHTML = '';
      list.forEach(function (n) { grid.appendChild(noteCard(n, visibleIds[n.meetingId])); });
      if (!list.length) {
        grid.appendChild(el('div.empty-state', null, [ ui.frag(ui.icon('journal-text')),
          el('h3', { text: 'Nothing written down yet' }),
          el('p.text-mute', { text: 'Minutes recorded against a meeting show up here, alongside your standalone notes.' }) ]));
      }
    }
    draw();
  }

  function noteCard(n, meeting) {
    var isMinute = n.kind === 'minute';
    return el('div.card.hover', { style: { cursor: 'pointer' }, onclick: function () { openNote(n, meeting); } }, [
      el('div.card-pad', null, [
        el('div.flex.items-center.gap-2.mb-2', null, [
          ui.frag(badge(isMinute ? 'Minutes' : 'Note', isMinute ? 'good' : 'info')),
          meeting ? ui.frag(coBadge(meeting.companyId)) : null,
          n.pinned ? ui.frag('<span class="badge badge-warn">' + ui.icon('pin-angle-fill') + ' Pinned</span>') : null
        ]),
        el('div.fw-600', { text: n.title }),
        meeting ? el('div.text-mute.xs', { style: { marginTop: '2px' }, text: meeting.title + ' · ' + whenText(meeting) }) : null,
        el('p.text-mute.sm', { style: { marginTop: '8px', display: '-webkit-box', WebkitLineClamp: '3',
          WebkitBoxOrient: 'vertical', overflow: 'hidden' }, text: n.body || '' }),
        el('div.flex.items-center.justify-between.mt-2', null, [
          el('span.text-mute.xs', { text: empName(n.authorId) + ' · ' + ui.ago(n.at) }),
          (n.decisions || '').trim()
            ? el('span.text-mute.xs', { html: ui.icon('check2-circle') + ' ' + (n.decisions.trim().split('\n').length) + ' decision(s)' })
            : null
        ])
      ])
    ]);
  }

  function openNote(n, meeting) {
    var body = el('div');
    if (meeting) {
      body.appendChild(el('div.card', { style: { marginBottom: '14px', cursor: 'pointer' },
        onclick: function () { m.close(); openMeeting(meeting); } }, [
        el('div.card-pad', null, [
          el('div.text-mute.xs', { text: 'Recorded against' }),
          el('div.fw-600', { text: meeting.title }),
          el('div.text-mute.sm', { text: whenText(meeting) + ' · ' + whereText(meeting) })
        ])
      ]));
    }
    body.appendChild(el('div.section-label', { style: { marginTop: '0' }, text: n.kind === 'minute' ? 'Minutes' : 'Note' }));
    body.appendChild(el('p', { style: { whiteSpace: 'pre-wrap', lineHeight: '1.65' }, text: n.body || '' }));

    if ((n.decisions || '').trim()) {
      body.appendChild(el('div.section-label', { text: 'Decisions' }));
      var dl = el('div.data-list');
      n.decisions.split('\n').filter(function (s) { return s.trim(); }).forEach(function (d) {
        dl.appendChild(el('div.data-row', null, [
          ui.frag('<span class="notif-ico notif-success">' + ui.icon('check-lg') + '</span>'),
          el('div.flex-1', null, [ el('div.sm', { text: d.trim() }) ])
        ]));
      });
      body.appendChild(dl);
    }

    var linked = meeting ? actions().filter(function (a) { return a.meetingId === meeting.id; }) : [];
    if (linked.length) {
      body.appendChild(el('div.section-label', { text: 'Action items from this meeting' }));
      body.appendChild(actionList(linked, function () { m.close(); openNote(n, meeting); }));
    }

    body.appendChild(el('div.text-mute.xs', { style: { marginTop: '14px' },
      text: 'Written by ' + empName(n.authorId) + ' · ' + ui.date(n.at, 'full') }));

    var m = ui.modal({
      title: n.title, icon: n.kind === 'minute' ? 'journal-text' : 'sticky-fill', size: 'lg', body: body,
      actions: [
        { label: n.pinned ? 'Unpin' : 'Pin', variant: 'ghost', icon: 'pin-angle', onClick: function () {
          n.pinned = !n.pinned; S.upsert('meeting_notes', n); touched('meeting_notes');
          ui.toast(n.pinned ? 'Pinned' : 'Unpinned', 'success'); redraw();
        } },
        { label: 'Print', variant: 'ghost', icon: 'printer', keepOpen: true, onClick: function () { printNote(n, meeting); } },
        canEditNote(n) ? { label: 'Delete', variant: 'ghost', icon: 'trash', onClick: function () { deleteNote(n); } } : null,
        canEditNote(n) ? { label: 'Edit', variant: 'primary', icon: 'pencil', onClick: function () { editNote(n); } } : null,
        { label: 'Close', variant: 'ghost' }
      ].filter(Boolean)
    });
  }

  function canEditNote(n) { return canManage() || n.authorId === meId(); }

  function editNote(n, meetingId) {
    var opts = [['', '— Standalone note (not tied to a meeting) —']].concat(
      visibleMeetings().sort(function (a, b) { return startsAt(b) - startsAt(a); }).map(function (m) {
        return [m.id, m.title + ' · ' + whenText(m)];
      }));

    EPAL.formModal({
      title: n ? 'Edit ' + (n.kind === 'minute' ? 'minutes' : 'note') : 'New note',
      icon: 'journal-plus', size: 'lg',
      record: n || { kind: meetingId ? 'minute' : 'note', meetingId: meetingId || '', pinned: false },
      fields: [
        { key: 'title', label: 'Title', type: 'text', required: true, col2: true,
          placeholder: 'e.g. Minutes — Q4 FY26 Board Review' },
        { key: 'kind', label: 'Kind', type: 'select', options: [['minute', 'Minutes of a meeting'], ['note', 'General note']],
          hint: 'Minutes are the record of a meeting; a note is anything else worth keeping.' },
        { key: 'meetingId', label: 'Attached to', type: 'select', options: opts,
          hint: 'Attach it and it shows up inside that meeting.' },
        { key: 'body', label: 'What was said / what you want to remember', type: 'textarea', rows: 9, required: true, col2: true },
        { key: 'decisions', label: 'Decisions — one per line', type: 'textarea', rows: 4, col2: true,
          placeholder: 'FY27 budget envelope approved in principle: +12% group-wide.' },
        { key: 'pinned', label: 'Pin to the top of the notes board', type: 'checkbox' }
      ],
      saveLabel: n ? 'Save' : 'Add note',
      onSave: function (v) {
        var rec = n || { id: ui.uid('MN'), authorId: meId(), at: Date.now() };
        rec.title = v.title; rec.kind = v.kind; rec.meetingId = v.meetingId || null;
        rec.body = v.body; rec.decisions = v.decisions || ''; rec.pinned = !!v.pinned;
        if (n) rec.at = n.at; else rec.at = Date.now();
        S.upsert('meeting_notes', rec);
        touched('meeting_notes');

        // Publishing minutes is news — tell the people who were in the room.
        if (!n && rec.kind === 'minute' && rec.meetingId) {
          var m = meetings().filter(function (x) { return x.id === rec.meetingId; })[0];
          if (m) {
            var sent = notifyAttendees(m, 'minutes', 'Minutes are available for');
            ui.toast('Minutes saved' + (sent ? ' · ' + sent + ' attendee' + (sent === 1 ? '' : 's') + ' notified' : ''), 'success');
          }
        } else {
          ui.toast(n ? 'Saved' : 'Note added', 'success');
        }
        redraw();
      }
    });
  }

  function deleteNote(n) {
    ui.confirm({ title: 'Delete this note?', text: '“' + n.title + '” will be removed permanently.',
      danger: true, confirmLabel: 'Delete' }).then(function (ok) {
      if (!ok) return;
      S.removeFrom('meeting_notes', n.id);
      touched('meeting_notes');
      ui.toast('Note deleted', 'success');
      redraw();
    });
  }

  /* ==========================================================================
   * SECTION · ACTION ITEMS
   * ========================================================================*/
  function isOverdue(a) { return a.status === 'open' && a.due && Date.parse(a.due + 'T23:59') < Date.now(); }

  function renderActions(page) {
    var visibleIds = {};
    visibleMeetings().forEach(function (m) { visibleIds[m.id] = m; });

    function visibleActions() {
      return actions().filter(function (a) {
        if (canManage()) return true;
        return a.assigneeId === meId() || (a.meetingId && visibleIds[a.meetingId]);
      });
    }

    var mode = 'open';
    var pills = el('div.pill-tab.mb-3');
    [['open', 'Open'], ['overdue', 'Overdue'], ['done', 'Done'], ['all', 'All']].forEach(function (p) {
      pills.appendChild(el('button' + (mode === p[0] ? '.active' : ''), { text: p[1], onclick: function (e) {
        mode = p[0];
        ui.$$('button', pills).forEach(function (b) { b.classList.remove('active'); });
        e.target.classList.add('active');
        table.refresh();
      } }));
    });
    page.appendChild(el('div', null, [pills]));

    function rows() {
      var list = visibleActions();
      if (mode === 'open')    list = list.filter(function (a) { return a.status === 'open'; });
      if (mode === 'overdue') list = list.filter(isOverdue);
      if (mode === 'done')    list = list.filter(function (a) { return a.status === 'done'; });
      return list.sort(function (a, b) {
        if (a.status !== b.status) return a.status === 'open' ? -1 : 1;
        return (Date.parse(a.due || '') || 8.64e15) - (Date.parse(b.due || '') || 8.64e15);
      });
    }

    var table = EPAL.table({
      columns: [
        { key: 'text', label: 'Action', render: function (a) {
            var m = visibleIds[a.meetingId];
            return '<span class="strong"' + (a.status === 'done' ? ' style="text-decoration:line-through;opacity:.6"' : '') + '>' +
                   ui.escapeHtml(a.text) + '</span>' +
                   (m ? '<div class="text-mute xs">from: ' + ui.escapeHtml(m.title) + '</div>' : '');
          } },
        { key: 'assigneeId', label: 'Owner', render: function (a) {
            var n = empName(a.assigneeId);
            return '<span class="nowrap"><span class="avatar" style="background:' + ui.colorFor(n) +
                   ';display:inline-grid;width:22px;height:22px;font-size:9px;vertical-align:middle;margin-right:6px">' +
                   ui.escapeHtml(ui.initials(n)) + '</span>' + ui.escapeHtml(n) + '</span>';
          },
          sortVal: function (a) { return empName(a.assigneeId); },
          exportVal: function (a) { return empName(a.assigneeId); } },
        { key: 'due', label: 'Due', render: function (a) {
            if (!a.due) return '<span class="text-mute">—</span>';
            return '<span class="nowrap' + (isOverdue(a) ? ' text-bad fw-600' : '') + '">' + ui.date(a.due) + '</span>' +
                   (isOverdue(a) ? '<div class="text-mute xs">overdue</div>' : '');
          },
          sortVal: function (a) { return Date.parse(a.due || '') || 8.64e15; } },
        { key: 'priority', label: 'Priority', badge: { high: 'bad', normal: 'info', low: 'warn' } },
        { key: 'status', label: 'Status', badge: { open: 'warn', done: 'good' } }
      ],
      rows: rows,
      filters: [{ key: 'priority', label: 'Priority' }, { key: 'status', label: 'Status' }],
      searchKeys: ['text'],
      exportName: 'group-meeting-actions.csv',
      pageSize: 12,
      actions: [
        { icon: 'check2-circle', title: 'Toggle done', onClick: function (a) { toggleAction(a); } },
        { icon: 'pencil', title: 'Edit', onClick: function (a) { editAction(a); } },
        { icon: 'trash', title: 'Delete', onClick: function (a) { deleteAction(a); } }
      ],
      empty: { icon: 'check2-all', title: 'No action items', hint: 'Commitments made in a meeting land here with an owner and a due date.' }
    });
    page.appendChild(el('div.card', null, [ el('div.card-pad', null, [ table.el ]) ]));
  }

  /* A compact action list used inside the meeting + note modals. */
  function actionList(list, after) {
    var dl = el('div.data-list');
    list.forEach(function (a) {
      dl.appendChild(el('div.data-row', { style: { alignItems: 'center', gap: '10px' } }, [
        el('button.row-act', { title: a.status === 'done' ? 'Re-open' : 'Mark done',
          html: ui.icon(a.status === 'done' ? 'check-circle-fill' : 'circle'),
          onclick: function () { toggleAction(a, after); } }),
        el('div.flex-1', null, [
          el('div.sm', { style: a.status === 'done' ? { textDecoration: 'line-through', opacity: '.6' } : null, text: a.text }),
          el('div.text-mute.xs', { text: empName(a.assigneeId) + (a.due ? ' · due ' + ui.date(a.due) : '') })
        ]),
        ui.frag(isOverdue(a) ? badge('Overdue', 'bad') : badge(a.priority, a.priority === 'high' ? 'bad' : a.priority === 'low' ? 'warn' : 'info'))
      ]));
    });
    return dl;
  }

  function toggleAction(a, after) {
    a.status = a.status === 'done' ? 'open' : 'done';
    a.doneAt = a.status === 'done' ? Date.now() : null;
    S.upsert('meeting_actions', a);
    touched('meeting_actions');
    // Closing someone else's action is worth a word to them.
    if (a.status === 'done' && a.assigneeId !== meId()) {
      db().notify({ toId: a.assigneeId, level: 'success', icon: 'check2-circle', companyId: 'group',
        title: 'Action item closed', text: '“' + a.text + '” was marked done by ' + empName(meId()) + '.' });
    }
    ui.toast(a.status === 'done' ? 'Marked done' : 'Re-opened', 'success');
    if (after) after(); else redraw();
  }

  function editAction(a, meetingId, after) {
    var meetOpts = [['', '— Not tied to a meeting —']].concat(visibleMeetings()
      .sort(function (x, y) { return startsAt(y) - startsAt(x); })
      .map(function (m) { return [m.id, m.title + ' · ' + whenText(m)]; }));

    EPAL.formModal({
      title: a ? 'Edit action item' : 'New action item', icon: 'check2-square', size: 'lg',
      record: a || { priority: 'normal', status: 'open', meetingId: meetingId || '', assigneeId: meId(), due: dayOffset(7) },
      fields: [
        { key: 'text', label: 'What needs to happen', type: 'text', required: true, col2: true,
          placeholder: 'e.g. Escalate the overdue receivable to the main contractor in writing' },
        { key: 'assigneeId', label: 'Owner', type: 'select', required: true,
          optionsFrom: function () {
            return db().employees().map(function (e) {
              var co = EPAL.config.company(e.companyId);
              return [e.id, e.name + ' — ' + e.designation + (co ? ' (' + co.short + ')' : '')];
            });
          } },
        { key: 'due', label: 'Due date', type: 'date', required: true },
        { key: 'priority', label: 'Priority', type: 'select', options: [['high', 'High'], ['normal', 'Normal'], ['low', 'Low']] },
        { key: 'meetingId', label: 'From meeting', type: 'select', options: meetOpts },
        { key: 'status', label: 'Status', type: 'select', options: [['open', 'Open'], ['done', 'Done']] }
      ],
      saveLabel: a ? 'Save' : 'Add action',
      onSave: function (v) {
        var rec = a || { id: ui.uid('MA'), createdAt: Date.now(), doneAt: null };
        var newOwner = !a || a.assigneeId !== v.assigneeId;
        rec.text = v.text; rec.assigneeId = v.assigneeId; rec.due = v.due;
        rec.priority = v.priority; rec.meetingId = v.meetingId || null; rec.status = v.status;
        rec.doneAt = v.status === 'done' ? (rec.doneAt || Date.now()) : null;
        S.upsert('meeting_actions', rec);
        touched('meeting_actions');

        // Being handed an action item is exactly the kind of thing you must be told.
        if (newOwner && rec.assigneeId !== meId() && rec.status === 'open') {
          db().notify({ toId: rec.assigneeId, level: 'warning', icon: 'check2-square', companyId: 'group',
            title: 'Action assigned to you',
            text: '“' + rec.text + '” · due ' + ui.date(rec.due) + ' · assigned by ' + empName(meId()) + '.' });
        }
        ui.toast(a ? 'Action saved' : 'Action added', 'success');
        if (after) after(); else redraw();
      }
    });
  }

  function deleteAction(a, after) {
    ui.confirm({ title: 'Delete this action item?', text: '“' + a.text + '” will be removed permanently.',
      danger: true, confirmLabel: 'Delete' }).then(function (ok) {
      if (!ok) return;
      S.removeFrom('meeting_actions', a.id);
      touched('meeting_actions');
      ui.toast('Action deleted', 'success');
      if (after) after(); else redraw();
    });
  }

  /* ==========================================================================
   * SECTION · ROOMS & SCHEDULING DEFAULTS  (admin bench)
   * ========================================================================*/
  function renderRooms(page) {
    var row = el('div.two-col');

    var table = EPAL.table({
      columns: [
        { key: 'name', label: 'Room', render: function (r) { return '<span class="strong">' + ui.escapeHtml(r.name) + '</span>'; } },
        { key: 'location', label: 'Location', render: function (r) { return '<span class="text-mute">' + ui.escapeHtml(r.location || '—') + '</span>'; } },
        { key: 'capacity', label: 'Seats', num: true },
        { key: 'facilities', label: 'Facilities', render: function (r) { return '<span class="text-mute">' + ui.escapeHtml(r.facilities || '—') + '</span>'; } }
      ],
      rows: rooms,
      searchKeys: ['name', 'location', 'facilities'],
      exportName: 'meeting-rooms.csv',
      pageSize: 8,
      onRow: function (r) { editRoom(r); },
      actions: ui.actions({ edit: function (r) { editRoom(r); }, del: function (r) { deleteRoom(r); } }),
      empty: { icon: 'door-closed', title: 'No rooms yet', hint: 'Add the rooms you actually meet in.' }
    });

    row.appendChild(el('div.card', null, [
      el('div.card-head', null, [ el('h3', { html: ui.icon('door-open-fill') + ' Meeting Rooms' }),
        el('span.card-sub', { text: 'bookable spaces' }) ]),
      el('div.card-pad', null, [ table.el ])
    ]));
    row.appendChild(defaultsCard());
    page.appendChild(row);

    // A small honest usage read — which rooms actually earn their keep.
    var usage = {};
    meetings().forEach(function (m) {
      if (!m.roomId || m.status === 'cancelled') return;
      usage[m.roomId] = (usage[m.roomId] || 0) + 1;
    });
    var used = rooms().filter(function (r) { return usage[r.id]; })
      .sort(function (a, b) { return usage[b.id] - usage[a.id]; });
    if (used.length) {
      page.appendChild(el('div.section-label', { text: 'Room usage' }));
      var dl = el('div.data-list');
      used.forEach(function (r) {
        dl.appendChild(el('div.data-row', { style: { alignItems: 'center' } }, [
          ui.frag('<span class="notif-ico notif-info">' + ui.icon('door-open') + '</span>'),
          el('div.flex-1', null, [ el('div.fw-600.sm', { text: r.name }),
            el('div.text-mute.xs', { text: r.location || '' }) ]),
          el('span.num', { text: usage[r.id] + ' meeting' + (usage[r.id] === 1 ? '' : 's') })
        ]));
      });
      page.appendChild(el('div.card', null, [ el('div.card-pad', null, [ dl ]) ]));
    }
  }

  function defaultsCard() {
    var p = prefs();
    var form = EPAL.form([
      { key: 'defaultDurationMin', label: 'Default duration', type: 'select',
        options: DURATIONS.map(function (d) { return [String(d[0]), d[1]]; }) },
      { key: 'defaultRemindMin', label: 'Default reminder', type: 'select',
        options: REMINDERS.map(function (r) { return [String(r[0]), r[1]]; }) },
      { key: 'defaultMode', label: 'Default mode', type: 'select', options: MODES }
    ], { defaultDurationMin: String(p.defaultDurationMin), defaultRemindMin: String(p.defaultRemindMin), defaultMode: p.defaultMode });

    return el('div.card', null, [
      el('div.card-head', null, [ el('h3', { html: ui.icon('sliders') + ' Scheduling Defaults' }),
        el('span.card-sub', { text: 'what a new meeting starts from' }) ]),
      el('div.card-body', null, [
        form.el,
        el('div.flex.justify-between.items-center.mt-2', null, [
          el('span.text-mute.xs', { text: 'Applies to the next meeting you schedule.' }),
          el('button.btn.btn-primary', { html: ui.icon('check-lg') + ' Save Defaults', onclick: function () {
            var v = form.values();
            S.set('meeting_prefs', { defaultDurationMin: +v.defaultDurationMin, defaultRemindMin: +v.defaultRemindMin, defaultMode: v.defaultMode });
            ui.toast('Scheduling defaults saved', 'success');
          } })
        ])
      ])
    ]);
  }

  function editRoom(r) {
    EPAL.formModal({
      title: r ? 'Edit room' : 'Add room', icon: 'door-open-fill', size: 'md', record: r || { capacity: 8 },
      fields: [
        { key: 'name', label: 'Room name', type: 'text', required: true, placeholder: 'e.g. Board Room' },
        { key: 'capacity', label: 'Seats', type: 'number', min: 1, required: true },
        { key: 'location', label: 'Location', type: 'text', col2: true, placeholder: 'e.g. Head Office, Gulshan-2 · Level 8' },
        { key: 'facilities', label: 'Facilities', type: 'text', col2: true, placeholder: 'e.g. Projector, video conferencing, whiteboard' }
      ],
      saveLabel: r ? 'Save' : 'Add room',
      onSave: function (v) {
        var rec = r || { id: ui.uid('RM') };
        rec.name = v.name; rec.capacity = +v.capacity; rec.location = v.location || ''; rec.facilities = v.facilities || '';
        S.upsert('meeting_rooms', rec);
        touched('meeting_rooms');
        ui.toast(r ? 'Room saved' : 'Room added', 'success');
        redraw();
      }
    });
  }

  function deleteRoom(r) {
    var booked = meetings().filter(function (m) { return m.roomId === r.id && m.status === 'scheduled' && !isPast(m); });
    ui.confirm({
      title: 'Delete ' + r.name + '?',
      text: booked.length
        ? booked.length + ' upcoming meeting(s) are booked into this room. They will keep the booking but the room will no longer be offered.'
        : 'The room will no longer be offered when scheduling.',
      danger: true, confirmLabel: 'Delete'
    }).then(function (ok) {
      if (!ok) return;
      S.removeFrom('meeting_rooms', r.id);
      touched('meeting_rooms');
      ui.toast('Room deleted', 'success');
      redraw();
    });
  }

  /* ==========================================================================
   * THE MEETING DETAIL — the whole thread in one modal.
   * ========================================================================*/
  function openMeeting(m) {
    var body = el('div');
    var iAm = myAttendance(m);

    // ---- the facts ---------------------------------------------------------
    var facts = el('div.card', { style: { marginBottom: '14px' } }, [
      el('div.card-pad', null, [
        el('div.flex.items-center.gap-2.flex-wrap.mb-2', null, [
          ui.frag(coBadge(m.companyId)), ui.frag(badge(m.type, 'info')),
          ui.frag(badge(m.status === 'scheduled' && isLive(m) ? 'In progress' : m.status, isLive(m) ? 'good' : STATUS_TONE[m.status])),
          m.status === 'scheduled' && !isPast(m) ? el('span.text-mute.xs', { text: countdown(m) }) : null
        ]),
        el('div.flex.items-start.gap-3.flex-wrap', null, [
          factBlock('calendar2-event', 'When', whenText(m) + ' · ' + ui.dur((+m.durationMin || 0) * 60000)),
          factBlock(m.mode === 'online' ? 'camera-video-fill' : 'geo-alt-fill', 'Where', whereDetail(m)),
          factBlock('person-badge-fill', 'Called by', empName(m.organizerId)),
          factBlock('bell', 'Reminder', (REMINDERS.filter(function (r) { return r[0] === (+m.remindMin || 0); })[0] || [0, 'No reminder'])[1])
        ]),
        (m.mode !== 'in-person' && m.link) ? el('div.mt-2', null, [
          el('a.btn.btn-primary', { href: m.link, target: '_blank', rel: 'noopener',
            html: ui.icon('camera-video-fill') + ' Join the call' })
        ]) : null
      ])
    ]);
    body.appendChild(facts);

    // ---- topic + agenda ----------------------------------------------------
    if (m.topic) {
      body.appendChild(el('div.section-label', { style: { marginTop: '0' }, text: 'Topic' }));
      body.appendChild(el('p', { style: { whiteSpace: 'pre-wrap', lineHeight: '1.65' }, text: m.topic }));
    }
    if ((m.agenda || []).length) {
      body.appendChild(el('div.section-label', { text: 'Agenda' }));
      var ag = el('div.data-list');
      (m.agenda || []).forEach(function (a, i) {
        ag.appendChild(el('div.data-row', { style: { alignItems: 'center' } }, [
          ui.frag('<span class="notif-ico notif-info">' + (i + 1) + '</span>'),
          el('div.flex-1', null, [ el('div.sm', { text: a.text }) ]),
          a.mins ? el('span.text-mute.xs.num', { text: a.mins + ' min' }) : null
        ]));
      });
      body.appendChild(ag);
    }

    // ---- attendees ---------------------------------------------------------
    body.appendChild(el('div.section-label', { text: 'Attendees (' + (m.attendees || []).length + ')' }));
    body.appendChild(attendeeList(m, function () { modal.close(); openMeeting(m); }));

    // ---- your RSVP ---------------------------------------------------------
    if (iAm && m.status === 'scheduled' && !isPast(m)) {
      var rsvpBar = el('div.card', { style: { marginTop: '12px', borderColor: 'var(--border-accent)' } }, [
        el('div.card-pad', null, [
          el('div.flex.items-center.justify-between.flex-wrap.gap-2', null, [
            el('div', null, [
              el('div.fw-600.sm', { text: 'Can you make it?' }),
              el('div.text-mute.xs', { text: 'Your reply: ' + RSVP_LABEL[iAm.rsvp] + ' — the organiser is told when you change it.' })
            ]),
            el('div.flex.gap-1', null, [
              rsvpBtn(m, 'accepted', 'Accept', 'check-lg', iAm.rsvp),
              rsvpBtn(m, 'tentative', 'Maybe', 'question-lg', iAm.rsvp),
              rsvpBtn(m, 'declined', 'Decline', 'x-lg', iAm.rsvp)
            ])
          ])
        ])
      ]);
      body.appendChild(rsvpBar);
    }

    // ---- minutes attached --------------------------------------------------
    var mins = notes().filter(function (n) { return n.meetingId === m.id; })
      .sort(function (a, b) { return b.at - a.at; });
    body.appendChild(el('div.section-label', { text: 'Minutes & notes' }));
    if (mins.length) {
      var nl = el('div.data-list');
      mins.forEach(function (n) {
        nl.appendChild(el('div.data-row', { style: { alignItems: 'center', cursor: 'pointer' },
          onclick: function () { modal.close(); openNote(n, m); } }, [
          ui.frag('<span class="notif-ico notif-success">' + ui.icon('journal-text') + '</span>'),
          el('div.flex-1', null, [ el('div.fw-600.sm', { text: n.title }),
            el('div.text-mute.xs', { text: empName(n.authorId) + ' · ' + ui.ago(n.at) }) ]),
          ui.frag(ui.icon('chevron-right'))
        ]));
      });
      body.appendChild(nl);
    } else {
      body.appendChild(el('p.text-mute.sm', { text: 'Nothing recorded yet.' }));
    }
    if (canEdit(m)) {
      body.appendChild(el('button.btn.btn-ghost.mt-2', { html: ui.icon('journal-plus') + ' Record minutes',
        onclick: function () { modal.close(); editNote(null, m.id); } }));
    }

    // ---- action items ------------------------------------------------------
    var acts = actions().filter(function (a) { return a.meetingId === m.id; });
    body.appendChild(el('div.section-label', { text: 'Action items (' + acts.filter(function (a) { return a.status === 'open'; }).length + ' open)' }));
    if (acts.length) body.appendChild(actionList(acts, function () { modal.close(); openMeeting(m); }));
    else body.appendChild(el('p.text-mute.sm', { text: 'No commitments recorded from this meeting.' }));
    if (canEdit(m)) {
      body.appendChild(el('button.btn.btn-ghost.mt-2', { html: ui.icon('plus-lg') + ' Add action item',
        onclick: function () { editAction(null, m.id, function () { modal.close(); openMeeting(m); }); } }));
    }

    /* ---- the footer: what you can DO to this meeting ---------------------*/
    var acls = [];
    if (canEdit(m) && m.status === 'scheduled') {
      acls.push({ label: 'Remind', variant: 'ghost', icon: 'bell-fill', keepOpen: true, onClick: function () {
        var sent = notifyAttendees(m, 'reminder', 'Reminder:');
        ui.toast(sent ? sent + ' reminder' + (sent === 1 ? '' : 's') + ' sent' : 'No one to remind', sent ? 'success' : 'info');
      } });
      acls.push({ label: isPast(m) ? 'Mark complete' : 'Complete', variant: 'ghost', icon: 'check2-circle',
        onClick: function () { completeMeeting(m); } });
      acls.push({ label: 'Cancel meeting', variant: 'ghost', icon: 'calendar-x', onClick: function () { cancelMeeting(m); } });
    }
    acls.push({ label: 'Print', variant: 'ghost', icon: 'printer', keepOpen: true, onClick: function () { printMeeting(m); } });
    if (canEdit(m)) acls.push({ label: 'Edit', variant: 'primary', icon: 'pencil', onClick: function () { editMeeting(m); } });
    acls.push({ label: 'Close', variant: 'ghost' });

    var modal = ui.modal({ title: m.title, icon: 'calendar2-week-fill', size: 'lg', body: body, actions: acls });
  }

  function factBlock(icon, label, value) {
    return el('div', { style: { minWidth: '180px', flex: '1' } }, [
      el('div.text-mute.xs', { html: ui.icon(icon) + ' ' + ui.escapeHtml(label) }),
      el('div.sm', { style: { marginTop: '2px' }, text: value })
    ]);
  }

  function rsvpBtn(m, state, label, icon, current) {
    var on = current === state;
    return el('button.btn' + (on ? '.btn-primary' : '.btn-ghost'), {
      html: ui.icon(icon) + ' ' + label,
      onclick: function () { setRsvp(m, meId(), state); }
    });
  }

  function attendeeList(m, after) {
    var dl = el('div.data-list');

    // The organiser sits at the top of their own meeting, always.
    var org = emp(m.organizerId);
    dl.appendChild(el('div.data-row', { style: { alignItems: 'center', gap: '10px' } }, [
      el('div.avatar', { style: { background: ui.colorFor(empName(m.organizerId)) }, text: ui.initials(empName(m.organizerId)) }),
      el('div.flex-1', null, [
        el('div.fw-600.sm', { text: empName(m.organizerId) }),
        el('div.text-mute.xs', { text: (org ? org.designation : '') + ' · Organiser' })
      ]),
      ui.frag(badge('Chairing', 'good'))
    ]));

    (m.attendees || []).forEach(function (a) {
      var e = emp(a.empId);
      var name = empName(a.empId);
      var co = e ? EPAL.config.company(e.companyId) : null;
      var isMe = a.empId === meId();

      dl.appendChild(el('div.data-row', { style: { alignItems: 'center', gap: '10px' } }, [
        el('div.avatar', { style: { background: ui.colorFor(name) }, text: ui.initials(name) }),
        el('div.flex-1', null, [
          el('div.fw-600.sm', { text: name + (isMe ? ' (you)' : '') }),
          el('div.text-mute.xs', { text: (e ? e.designation : 'Unknown') + (co ? ' · ' + co.short : '') +
            (a.required ? ' · Required' : ' · Optional') })
        ]),
        // Attendance is only a question once the meeting has actually happened.
        (m.status === 'completed' && canEdit(m))
          ? el('button.btn.btn-ghost.sm', {
              html: ui.icon(a.attended ? 'person-check-fill' : 'person-dash') + ' ' + (a.attended ? 'Attended' : 'Absent'),
              onclick: function () {
                a.attended = !a.attended;
                m.updatedAt = Date.now();
                S.upsert('meetings', m); touched('meetings');
                if (after) after();
              } })
          : ui.frag(badge(RSVP_LABEL[a.rsvp], RSVP_TONE[a.rsvp]))
      ]));
    });
    return dl;
  }

  /* ==========================================================================
   * MUTATIONS
   * ========================================================================*/
  function setRsvp(m, empId, state) {
    var a = (m.attendees || []).filter(function (x) { return x.empId === empId; })[0];
    if (!a) return;
    if (a.rsvp === state) return;
    a.rsvp = state;
    m.updatedAt = Date.now();
    S.upsert('meetings', m);
    touched('meetings');
    notifyOrganizer(m, empName(empId) + ' ' + (state === 'accepted' ? 'accepted' : state === 'declined' ? 'declined' : 'tentatively accepted') +
      ' — ' + whenText(m), state === 'declined' ? 'warning' : 'success');
    ui.toast('You are ' + RSVP_LABEL[state].toLowerCase(), state === 'declined' ? 'info' : 'success');
    redraw();
  }

  function completeMeeting(m) {
    ui.confirm({ title: 'Mark “' + m.title + '” complete?',
      text: 'It moves to Past. You can still record the minutes and mark who actually attended.',
      confirmLabel: 'Mark complete' }).then(function (ok) {
      if (!ok) return;
      m.status = 'completed';
      m.updatedAt = Date.now();
      // Everyone who accepted is assumed present until someone says otherwise —
      // an honest default that still leaves the record editable.
      (m.attendees || []).forEach(function (a) { if (a.attended == null) a.attended = a.rsvp === 'accepted'; });
      S.upsert('meetings', m);
      touched('meetings');
      ui.toast('Meeting completed — record the minutes while they are fresh', 'success');
      redraw();
    });
  }

  function cancelMeeting(m) {
    ui.confirm({ title: 'Cancel “' + m.title + '”?',
      text: 'Every attendee is notified. The meeting stays on the record as cancelled — its minutes and actions are kept.',
      danger: true, confirmLabel: 'Cancel meeting', cancelLabel: 'Keep it' }).then(function (ok) {
      if (!ok) return;
      m.status = 'cancelled';
      m.updatedAt = Date.now();
      S.upsert('meetings', m);
      touched('meetings');
      var sent = notifyAttendees(m, 'cancel', 'Cancelled:');
      ui.toast('Meeting cancelled' + (sent ? ' · ' + sent + ' attendee' + (sent === 1 ? '' : 's') + ' notified' : ''), 'success');
      redraw();
    });
  }

  function deleteMeeting(m) {
    var kids = notes().filter(function (n) { return n.meetingId === m.id; }).length +
               actions().filter(function (a) { return a.meetingId === m.id; }).length;
    ui.confirm({
      title: 'Delete “' + m.title + '”?',
      text: kids
        ? 'This meeting has ' + kids + ' attached note(s) / action item(s). They will be unlinked, not deleted. Consider cancelling instead — that keeps the history.'
        : 'The meeting will be removed permanently. Consider cancelling instead — that keeps the history.',
      danger: true, confirmLabel: 'Delete'
    }).then(function (ok) {
      if (!ok) return;
      // Unlink rather than orphan: a minute is still a record even if the meeting
      // row is gone, so it becomes a standalone note.
      notes().forEach(function (n) { if (n.meetingId === m.id) { n.meetingId = null; S.upsert('meeting_notes', n); } });
      actions().forEach(function (a) { if (a.meetingId === m.id) { a.meetingId = null; S.upsert('meeting_actions', a); } });
      S.removeFrom('meetings', m.id);
      touched('meetings');
      ui.toast('Meeting deleted', 'success');
      redraw();
    });
  }

  /* ==========================================================================
   * THE SCHEDULE / EDIT FORM
   * ========================================================================*/
  function editMeeting(m, presetDate) {
    var p = prefs();
    var isNew = !m;
    var record = m || {
      title: '', topic: '', type: 'Review', companyId: 'group',
      date: presetDate || dayOffset(1), time: '10:00',
      durationMin: p.defaultDurationMin, mode: p.defaultMode, roomId: rooms()[0] ? rooms()[0].id : '',
      location: '', link: '', remindMin: p.defaultRemindMin, agenda: []
    };

    // The scalar half of the form, from the kit.
    var form = EPAL.form([
      { key: 'title', label: 'Meeting title', type: 'text', required: true, col2: true,
        placeholder: 'e.g. Monthly MD Review — All Concerns' },
      { key: 'topic', label: 'Topic — what this meeting is FOR', type: 'textarea', rows: 3, col2: true,
        placeholder: 'The one paragraph that tells an invitee why their time is being taken.' },
      { key: 'type', label: 'Type', type: 'select', options: TYPES },
      { key: 'companyId', label: 'Concern', type: 'select',
        optionsFrom: function () {
          return [['group', 'Epal Group (cross-concern)']].concat(
            EPAL.config.companies.filter(function (c) { return c.id !== 'group'; })
              .map(function (c) { return [c.id, c.name]; }));
        } },
      { key: 'date', label: 'Date', type: 'date', required: true },
      { key: 'time', label: 'Start time', type: 'time', required: true },
      { key: 'durationMin', label: 'Duration', type: 'select',
        options: DURATIONS.map(function (d) { return [String(d[0]), d[1]]; }) },
      { key: 'remindMin', label: 'Remind attendees', type: 'select',
        options: REMINDERS.map(function (r) { return [String(r[0]), r[1]]; }) },
      { key: 'mode', label: 'Mode', type: 'select', options: MODES },
      { key: 'roomId', label: 'Room', type: 'select',
        optionsFrom: function () {
          return [['', '— Other / see location below —']].concat(rooms().map(function (r) {
            return [r.id, r.name + ' (' + r.capacity + ' seats)'];
          }));
        },
        showIf: function (v) { return v.mode !== 'online'; } },
      { key: 'location', label: 'Location (if not a room)', type: 'text', col2: true,
        placeholder: 'e.g. Client office, Banani — 4th floor',
        showIf: function (v) { return v.mode !== 'online' && !v.roomId; } },
      { key: 'link', label: 'Meeting link', type: 'text', col2: true, placeholder: 'https://meet.google.com/…',
        showIf: function (v) { return v.mode !== 'in-person'; } },
      { key: 'agenda', label: 'Agenda', type: 'items', addLabel: 'Add agenda item',
        emptyText: 'No agenda yet — an invitee reads this to know if they are needed.',
        // No width on the text column: .items-cell already flexes to fill (deepcore.css),
        // and a width is applied as `flex: 0 0 <width>` — so only the fixed one gets it.
        columns: [{ key: 'text', label: 'Agenda item', type: 'text' },
                  { key: 'mins', label: 'Minutes', type: 'number', width: '110px' }],
        footer: function (rows) {
          var total = rows.reduce(function (s, r) { return s + (+r.mins || 0); }, 0);
          return total ? '<span class="text-mute">Agenda runs <strong>' + total + ' minutes</strong></span>' : '';
        } }
    ], {
      title: record.title, topic: record.topic, type: record.type, companyId: record.companyId,
      date: record.date, time: record.time, durationMin: String(record.durationMin),
      remindMin: String(record.remindMin), mode: record.mode, roomId: record.roomId,
      location: record.location, link: record.link, agenda: record.agenda || []
    });

    // The half the kit can't do: pick people out of the whole group.
    var picker = attendeePicker((record.attendees || []).map(function (a) { return a.empId; }), record.organizerId || meId());

    var body = el('div', null, [
      form.el,
      el('div.section-label', { text: 'Attendees' }),
      picker.el
    ]);

    var forced = false;              // "schedule despite the clash" — asked once, then remembered

    var modal = ui.modal({
      title: isNew ? 'Schedule a meeting' : 'Edit meeting', icon: 'calendar-plus', size: 'lg', body: body,
      actions: [
        { label: 'Cancel', variant: 'ghost' },
        { label: isNew ? 'Schedule & notify' : 'Save & notify', variant: 'primary', icon: 'send-fill', onClick: function () {
          if (!form.validate()) { ui.toast('Please fix the highlighted fields', 'error'); return false; }
          var v = form.values();
          var picked = picker.values();
          if (!picked.length) { ui.toast('Invite at least one person — a meeting needs someone in the room', 'error'); return false; }

          // Build the draft so conflict detection sees the REAL proposed slot.
          var draft = {
            id: record.id || ui.uid('MTG'),
            title: v.title, topic: v.topic || '', type: v.type, companyId: v.companyId,
            date: v.date, time: v.time, durationMin: +v.durationMin, mode: v.mode,
            roomId: v.mode === 'online' ? '' : (v.roomId || ''),
            location: v.mode === 'online' ? '' : (v.location || ''),
            link: v.mode === 'in-person' ? '' : (v.link || ''),
            organizerId: record.organizerId || meId(),
            agenda: (v.agenda || []).filter(function (a) { return (a.text || '').trim(); }),
            remindMin: +v.remindMin,
            status: record.status || 'scheduled',
            attendees: picked.map(function (id) {
              var was = (record.attendees || []).filter(function (a) { return a.empId === id; })[0];
              return was || { empId: id, required: true, rsvp: 'invited', attended: null };
            }),
            createdAt: record.createdAt || Date.now(), updatedAt: Date.now()
          };

          // Double-booking is a warning, never a block. Ask once; if the owner
          // says "anyway", `forced` remembers it so the second Save goes straight
          // through instead of nagging about the same clash again.
          var clashes = conflictsFor(draft, draft.id);
          if (clashes.length && !forced) {
            warnClashes(clashes, function () {
              forced = true;
              commit(draft);
              modal.close();
            });
            return false;                                  // hold the form open for the answer
          }
          commit(draft);
        } }
      ]
    });

    function commit(draft) {
      // What changed decides what we say: a moved meeting is a different message
      // from a fresh invite, and only the newly added need the first one.
      var wasTime = record.date ? record.date + 'T' + record.time : null;
      var nowTime = draft.date + 'T' + draft.time;
      var moved = !isNew && wasTime !== nowTime;
      var previous = {};
      (record.attendees || []).forEach(function (a) { previous[a.empId] = true; });
      var added = draft.attendees.filter(function (a) { return !previous[a.empId]; });
      var dropped = (record.attendees || []).filter(function (a) {
        return !draft.attendees.some(function (x) { return x.empId === a.empId; });
      });

      S.upsert('meetings', draft);
      touched('meetings');

      var sent = 0;
      if (isNew) {
        sent = notifyAttendees(draft, 'invite');
      } else {
        if (moved) {
          // Everyone still invited must re-confirm a moved meeting.
          draft.attendees.forEach(function (a) { if (a.rsvp === 'accepted' || a.rsvp === 'tentative') a.rsvp = 'invited'; });
          S.upsert('meetings', draft);
          sent += notifyAttendees(draft, 'update', 'Moved to');
        }
        // Newly added people get a first-time invite regardless of a move.
        added.forEach(function (a) {
          if (a.empId === draft.organizerId) return;
          db().notify({ toId: a.empId, level: 'info', icon: 'calendar-plus', companyId: draft.companyId,
            title: 'Meeting invite — ' + draft.title,
            text: whenText(draft) + ' · ' + whereText(draft) + ' · Please RSVP.' });
          sent++;
        });
        // And the uninvited deserve to know they are off the hook.
        dropped.forEach(function (a) {
          if (a.empId === draft.organizerId) return;
          db().notify({ toId: a.empId, level: 'info', icon: 'calendar-minus', companyId: draft.companyId,
            title: 'Removed from — ' + draft.title,
            text: 'You are no longer needed at this meeting (' + whenText(draft) + ').' });
        });
      }

      ui.toast((isNew ? 'Meeting scheduled' : 'Meeting saved') +
        (sent ? ' · ' + sent + ' person' + (sent === 1 ? '' : 's') + ' notified' : ''), 'success');
      redraw();
    }
  }

  /* The double-booking warning. ui.confirm() paints its text into a <p> via
     `text:`, so a list would collapse into one run-on line — a clash list has to
     be readable at a glance, so it gets its own modal with real rows. */
  function warnClashes(clashes, onProceed) {
    var dl = el('div.data-list');
    clashes.slice(0, 8).forEach(function (c) {
      dl.appendChild(el('div.data-row', { style: { alignItems: 'center', gap: '10px' } }, [
        ui.frag('<span class="notif-ico notif-warning">' + ui.icon('exclamation-triangle-fill') + '</span>'),
        el('div.flex-1', null, [
          el('div.fw-600.sm', { text: empName(c.empId) }),
          el('div.text-mute.xs', { text: 'already in “' + c.meeting.title + '” · ' + whenText(c.meeting) })
        ])
      ]));
    });

    var m = ui.modal({
      title: clashes.length + ' scheduling clash' + (clashes.length === 1 ? '' : 'es'),
      icon: 'exclamation-triangle-fill', size: 'md',
      body: el('div', null, [
        el('p.text-muted', { text: 'These people are already booked during this slot. You can schedule anyway — the calendar is advice, not a rule.' }),
        dl,
        clashes.length > 8 ? el('div.text-mute.xs', { style: { marginTop: '8px' }, text: '…and ' + (clashes.length - 8) + ' more' }) : null
      ]),
      actions: [
        { label: 'Let me change it', variant: 'ghost' },
        { label: 'Schedule anyway', variant: 'primary', icon: 'send-fill', onClick: function () { onProceed(); } }
      ]
    });
    return m;
  }

  /* A searchable, company-grouped employee picker. Returns { el, values() }.
     The kit's form has no multi-select, and inviting people is the one thing
     this screen must make effortless — so it gets a purpose-built control. */
  function attendeePicker(selectedIds, organizerId) {
    var picked = {};
    (selectedIds || []).forEach(function (id) { picked[id] = true; });
    delete picked[organizerId];                 // the organiser is implicit, never an invitee

    var state = { q: '', company: 'all' };
    var root = el('div');

    var count = el('span.text-mute.xs');
    var chosen = el('div.flex.gap-1.flex-wrap.mb-2');
    var listBox = el('div', { style: { maxHeight: '260px', overflowY: 'auto', border: '1px solid var(--border)',
      borderRadius: '10px', padding: '4px' } });

    var bar = el('div.flex.items-center.gap-2.flex-wrap.mb-2', null, [
      el('div.search-trigger', { style: { cursor: 'text', minWidth: '220px' } }, [
        ui.frag(ui.icon('search')),
        el('input.input', { placeholder: 'Search people…', style: { border: 'none', background: 'none', padding: '0' },
          oninput: ui.debounce(function (e) { state.q = e.target.value.toLowerCase(); drawList(); }, 150) })
      ]),
      el('div.flex.gap-1.flex-wrap', null,
        [{ id: 'all', short: 'All' }].concat(EPAL.config.companies).map(function (c) {
          return el('button.chip' + (c.id === 'all' ? '.active' : ''), { type: 'button', text: c.short || c.name,
            onclick: function (e) {
              state.company = c.id;
              ui.$$('.chip', bar).forEach(function (x) { x.classList.remove('active'); });
              e.target.classList.add('active');
              drawList();
            } });
        })),
      count
    ]);

    function candidates() {
      return db().employees().filter(function (e) {
        if (e.id === organizerId) return false;
        if (e.status === 'inactive') return false;
        if (state.company !== 'all' && e.companyId !== state.company) return false;
        if (state.q && (e.name + ' ' + e.designation + ' ' + e.dept).toLowerCase().indexOf(state.q) < 0) return false;
        return true;
      });
    }

    function drawChosen() {
      chosen.innerHTML = '';
      var ids = Object.keys(picked);
      count.textContent = ids.length + ' invited';
      ids.forEach(function (id) {
        var n = empName(id);
        chosen.appendChild(el('button.chip.active', { type: 'button', title: 'Remove ' + n,
          html: ui.escapeHtml(n) + ' ' + ui.icon('x'),
          onclick: function () { delete picked[id]; drawChosen(); drawList(); } }));
      });
      if (!ids.length) chosen.appendChild(el('span.text-mute.xs', { text: 'Nobody invited yet — pick people below.' }));
    }

    function drawList() {
      listBox.innerHTML = '';
      var list = candidates();

      // "Invite this whole concern" — the gesture the owner reaches for most.
      if (state.company !== 'all' && list.length) {
        listBox.appendChild(el('button.btn.btn-ghost.sm', { type: 'button', style: { width: '100%', marginBottom: '4px' },
          html: ui.icon('people-fill') + ' Invite all ' + list.length + ' shown',
          onclick: function () { list.forEach(function (e) { picked[e.id] = true; }); drawChosen(); drawList(); } }));
      }

      list.forEach(function (e) {
        var co = EPAL.config.company(e.companyId);
        var on = !!picked[e.id];
        listBox.appendChild(el('div.data-row', {
          style: { alignItems: 'center', gap: '10px', cursor: 'pointer', padding: '6px 8px', borderRadius: '8px',
            background: on ? 'var(--surface-3)' : 'transparent' },
          onclick: function () {
            if (picked[e.id]) delete picked[e.id]; else picked[e.id] = true;
            drawChosen(); drawList();
          }
        }, [
          ui.frag(ui.icon(on ? 'check-square-fill' : 'square')),
          el('div.avatar', { style: { background: ui.colorFor(e.name), width: '26px', height: '26px', fontSize: '10px' },
            text: ui.initials(e.name) }),
          el('div.flex-1', null, [
            el('div.sm', { text: e.name }),
            el('div.text-mute.xs', { text: e.designation + ' · ' + e.dept + (co ? ' · ' + co.short : '') })
          ]),
          e.status === 'on-leave' ? ui.frag(badge('On leave', 'warn')) : null
        ]));
      });

      if (!list.length) listBox.appendChild(el('div.text-mute.sm', { style: { padding: '14px', textAlign: 'center' },
        text: 'Nobody matches that search.' }));
    }

    root.appendChild(bar);
    root.appendChild(chosen);
    root.appendChild(listBox);
    drawChosen(); drawList();

    return { el: root, values: function () { return Object.keys(picked); } };
  }

  /* ==========================================================================
   * PRINT / SHARE — documentation-grade output, the house pattern.
   * ========================================================================*/
  function attendeeEmails(m) {
    return (m.attendees || []).map(function (a) { var e = emp(a.empId); return e ? e.email : null; })
      .filter(Boolean).join(',');
  }

  // The plain-text form used for WhatsApp / Gmail bodies.
  function meetingPlainText(m) {
    var lines = [
      m.title,
      '',
      whenText(m),
      whereDetail(m),
      'Called by: ' + empName(m.organizerId)
    ];
    if (m.topic) { lines.push('', 'Topic:', m.topic); }
    if ((m.agenda || []).length) {
      lines.push('', 'Agenda:');
      m.agenda.forEach(function (a, i) { lines.push('  ' + (i + 1) + '. ' + a.text + (a.mins ? ' (' + a.mins + ' min)' : '')); });
    }
    if ((m.attendees || []).length) {
      lines.push('', 'Attendees:');
      m.attendees.forEach(function (a) { lines.push('  · ' + empName(a.empId)); });
    }
    lines.push('', '— ' + ((EPAL.config.group && EPAL.config.group.name) || 'Epal Group'));
    return lines.join('\n');
  }

  function printMeeting(m) {
    var mins = notes().filter(function (n) { return n.meetingId === m.id; }).sort(function (a, b) { return a.at - b.at; });
    var acts = actions().filter(function (a) { return a.meetingId === m.id; });
    var co = EPAL.config.company(m.companyId);

    var html = '';
    html += '<table><tbody>' +
      row('When', whenText(m) + ' · ' + ui.dur((+m.durationMin || 0) * 60000)) +
      row('Where', whereDetail(m)) +
      row('Concern', co ? co.name : 'Epal Group') +
      row('Type', m.type) +
      row('Called by', empName(m.organizerId)) +
      row('Status', m.status) +
      '</tbody></table>';

    if (m.topic) html += '<h3>Topic</h3><p>' + ui.escapeHtml(m.topic).replace(/\n/g, '<br>') + '</p>';

    if ((m.agenda || []).length) {
      html += '<h3>Agenda</h3><table><thead><tr><th>#</th><th>Item</th><th>Minutes</th></tr></thead><tbody>';
      m.agenda.forEach(function (a, i) {
        html += '<tr><td>' + (i + 1) + '</td><td>' + ui.escapeHtml(a.text) + '</td><td>' + (a.mins || '—') + '</td></tr>';
      });
      html += '</tbody></table>';
    }

    html += '<h3>Attendees</h3><table><thead><tr><th>Name</th><th>Role</th><th>RSVP</th>' +
      (m.status === 'completed' ? '<th>Attended</th>' : '') + '</tr></thead><tbody>';
    html += '<tr><td>' + ui.escapeHtml(empName(m.organizerId)) + '</td><td>Organiser</td><td>Chairing</td>' +
      (m.status === 'completed' ? '<td>Yes</td>' : '') + '</tr>';
    (m.attendees || []).forEach(function (a) {
      var e = emp(a.empId);
      html += '<tr><td>' + ui.escapeHtml(empName(a.empId)) + '</td><td>' + ui.escapeHtml(e ? e.designation : '—') + '</td><td>' +
        RSVP_LABEL[a.rsvp] + '</td>' + (m.status === 'completed' ? '<td>' + (a.attended ? 'Yes' : 'No') + '</td>' : '') + '</tr>';
    });
    html += '</tbody></table>';

    mins.forEach(function (n) {
      html += '<h3>' + ui.escapeHtml(n.title) + '</h3><p>' + ui.escapeHtml(n.body || '').replace(/\n/g, '<br>') + '</p>';
      if ((n.decisions || '').trim()) {
        html += '<h3>Decisions</h3><ul>';
        n.decisions.split('\n').filter(function (s) { return s.trim(); }).forEach(function (d) {
          html += '<li>' + ui.escapeHtml(d.trim()) + '</li>';
        });
        html += '</ul>';
      }
    });

    if (acts.length) {
      html += '<h3>Action Items</h3><table><thead><tr><th>Action</th><th>Owner</th><th>Due</th><th>Status</th></tr></thead><tbody>';
      acts.forEach(function (a) {
        html += '<tr><td>' + ui.escapeHtml(a.text) + '</td><td>' + ui.escapeHtml(empName(a.assigneeId)) + '</td><td>' +
          (a.due ? ui.date(a.due) : '—') + '</td><td>' + a.status + '</td></tr>';
      });
      html += '</tbody></table>';
    }

    ui.printDoc({
      title: m.title, subtitle: whenText(m) + ' · ' + whereText(m),
      meta: 'Meeting record · ' + ui.date(Date.now(), 'full'),
      footer: 'Meeting ' + m.id, body: html
    });

    function row(k, v) { return '<tr><td><strong>' + ui.escapeHtml(k) + '</strong></td><td>' + ui.escapeHtml(v) + '</td></tr>'; }
  }

  function printNote(n, meeting) {
    var html = '';
    if (meeting) {
      html += '<table><tbody>' +
        '<tr><td><strong>Meeting</strong></td><td>' + ui.escapeHtml(meeting.title) + '</td></tr>' +
        '<tr><td><strong>When</strong></td><td>' + ui.escapeHtml(whenText(meeting)) + '</td></tr>' +
        '<tr><td><strong>Where</strong></td><td>' + ui.escapeHtml(whereDetail(meeting)) + '</td></tr>' +
        '</tbody></table>';
    }
    html += '<p>' + ui.escapeHtml(n.body || '').replace(/\n/g, '<br>') + '</p>';
    if ((n.decisions || '').trim()) {
      html += '<h3>Decisions</h3><ul>';
      n.decisions.split('\n').filter(function (s) { return s.trim(); }).forEach(function (d) {
        html += '<li>' + ui.escapeHtml(d.trim()) + '</li>';
      });
      html += '</ul>';
    }
    ui.printDoc({
      title: n.title, subtitle: empName(n.authorId) + ' · ' + ui.date(n.at, 'full'),
      meta: (n.kind === 'minute' ? 'Minutes' : 'Note') + ' · ' + ui.date(Date.now(), 'full'),
      footer: n.id, body: html
    });
  }

})(window.EPAL = window.EPAL || {});
