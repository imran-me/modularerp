# Meetings & Notes — Laravel backend blueprint

Source of truth: `companies/group-cockpit/modules/meetings/view.js` (the whole module) +
`platform/data/database.js` (`notify()` / `inbox()` — the addressed-notification plumbing
this module leans on). Route today: `#/group/meetings` (module.json).
Line refs below are `view.js:N` / `db:N`.

## Purpose & screens
The owner/super-admin's meeting desk for the whole group: call a meeting with people from
any sister concern, have them actually be told about it, and keep the whole thread — why we
met, what we decided, who owes what by when — attached to the meeting itself.

One view serves five sections via the house section band (view.js SECTIONS); `agenda` owns
the bare route.
- **Agenda** (default) — four KPIs (Next 7 days / Awaiting your RSVP / Open action items /
  Meeting hours this month), a "next up" hero card for the nearest meeting (with Join + a
  one-tap Accept when an RSVP is owed), and the meeting register: a datatable with
  Upcoming/Past/All pills, type+status+concern filters, CSV export, row-click → detail modal,
  and the house row-action grammar `edit · delete │ print · wa · gmail`.
- **Calendar** — month grid of every visible meeting; click empty space in a day to schedule
  into that day, click a meeting chip to open it. Cancelled meetings render struck through.
- **Minutes & Notes** — card board of minutes (attached to a meeting) and standalone notes,
  searchable, kind-filtered, pinnable; detail modal renders body + decisions + the meeting's
  action items, printable.
- **Action Items** — every commitment made in a meeting: owner, due date, priority, done
  toggle; Open/Overdue/Done/All pills. Overdue is derived from the clock, never stored.
- **Rooms & Setup** (admin only) — room CRUD, a room-usage read, and the scheduling defaults
  (`meeting_prefs`) every new meeting starts from.

**Detail modal** (view.js openMeeting) — facts row (when/where/called-by/reminder), Join
button for online+hybrid, topic, numbered agenda with per-item minutes, attendee list with
RSVP badges (or attendance toggles once completed), your own RSVP bar, attached minutes,
action items, and the footer verbs: Remind / Complete / Cancel meeting / Print / Edit.

## Entities & fields
Today all state lives in localStorage stores (view.js store accessors).

**meetings** (store `meetings`):
- id: string PK, `MTG`-prefixed uid (seed uses `MTG-1001`… style)
- title: string, required · topic: text (the "why your time is being taken" paragraph)
- type: enum Board | Review | Stand-up | One-on-One | Client | Planning | Training | Interview
- companyId: string FK companies, `'group'` = cross-concern
- date: date `YYYY-MM-DD` · time: string `HH:MM` — stored as LOCAL WALL-CLOCK strings, exactly
  as a person wrote them down, resolved against the local zone (view.js startsAt)
- durationMin: int (15|30|45|60|90|120|180|240)
- mode: enum in-person | online | hybrid
- roomId: string FK meeting_rooms, nullable (blank when mode=online)
- location: string — free-text fallback used only when no room is chosen
- link: string — video link, used when mode != in-person
- organizerId: string FK employees
- agenda: array of `{ text, mins }` (embedded today → own table)
- remindMin: int (0|10|30|60|180|1440); 0 = no reminder
- status: enum scheduled | completed | cancelled
- attendees: array of attendee objects (below)
- createdAt / updatedAt: ms timestamps

**meeting_attendees** (embedded array today → own pivot table):
- meeting_id FK · employee_id FK
- required: bool (required vs optional invitee)
- rsvp: enum invited | accepted | declined | tentative (default invited)
- attended: bool nullable — null until the meeting is completed

**meeting_notes** (store `meeting_notes`):
- id: string PK, `MN`-prefixed uid · meetingId: FK meetings, NULLABLE (a standalone note)
- kind: enum minute | note · title: string, required · body: text, required
- decisions: text — one decision per line (split on `\n` for display/print)
- authorId: FK employees · at: ms timestamp · pinned: bool

**meeting_actions** (store `meeting_actions`):
- id: string PK, `MA`-prefixed uid · meetingId: FK meetings, nullable
- text: string, required · assigneeId: FK employees · due: date
- priority: enum high | normal | low · status: enum open | done
- createdAt: ms · doneAt: ms nullable

**meeting_rooms** (store `meeting_rooms`):
- id: string PK, `RM`-prefixed · name: string · location: string
- capacity: int · facilities: string

**meeting_prefs** (store `meeting_prefs`, a singleton object → a settings row):
- defaultDurationMin: int · defaultRemindMin: int · defaultMode: enum

## Business rules
1. **Only an admin/owner schedules** — `canManage()` is `EPAL.auth.isAdmin()` (owner|admin).
   Everyone else sees only meetings they organise or are invited to (`visibleMeetings()`),
   and may change nothing but their own RSVP. `rooms` redirects non-admins to the bare route.
2. **Inviting/rescheduling/cancelling NOTIFIES each attendee** — one ADDRESSED notification
   per attendee (`db.notify({ toId })`, view.js notifyAttendees), so the invite rings the
   attendee's bell and never the organiser's. See rule 8.
3. **The organiser is an implicit attendee** — never invited, never notified, RSVP is always
   "Chairing"; the attendee picker excludes them outright (view.js attendeePicker).
4. **A declined invitee is not nagged** — reminders and reschedule notices skip
   `rsvp === 'declined'`; a cancellation still reaches everyone (notifyAttendees).
5. **Moving a meeting resets the RSVPs** — if date+time changed, every `accepted`/`tentative`
   attendee drops back to `invited` and must re-confirm (view.js commit). Agreeing to Tuesday
   is not agreeing to Thursday.
6. **Double-booking warns, never blocks** — `conflictsFor()` finds every participant already
   in an overlapping, non-cancelled meeting (`start < end && end > start`) and lists them;
   the owner may proceed anyway (view.js warnClashes). Real businesses overrule calendars;
   the system's job is to say so out loud.
7. **Status is authoritative, time is derived** — `completed`/`cancelled` are set by a human.
   Time passing NEVER mutates stored data: "in progress", "overdue" and "past" are computed
   at render time from the clock (isLive/isPast/isOverdue).
8. **Addressed vs broadcast notifications** (db:464-476, the one shared-file change this
   module needed): a notification with no `toId` is a BROADCAST and reaches everyone (all
   pre-existing/seeded alerts); one with `toId` reaches only that employee. `db.inbox()`
   applies the rule; the topbar bell, the Notification Center and the group dashboard's
   alerts card all read through it. "Mark all read" and "Clear read" are scoped to the
   inbox — marking someone else's unopened invite read on their behalf would be a lie.
9. **Cancelling keeps the record** — with its minutes and actions; it is history, not a
   mistake to erase. Only an explicit Delete removes a meeting, and a delete UNLINKS its
   notes/actions (they become standalone) rather than orphaning or destroying them.
10. **Completing assumes the accepted attended** — `attended ??= (rsvp === 'accepted')`, an
    honest default that stays editable per person (view.js completeMeeting).
11. **Publishing minutes is news** — first minutes recorded against a meeting notify its
    attendees; being handed an action item notifies its new owner; closing someone else's
    action tells them.
12. **A meeting needs someone in the room** — save is blocked with an empty attendee list.

## Routes
```
GET    /group/meetings                        MeetingController@index      (agenda)
GET    /group/meetings/calendar               MeetingController@calendar
GET    /group/meetings/minutes                MeetingNoteController@index
GET    /group/meetings/actions                MeetingActionController@index
GET    /group/meetings/rooms                  MeetingRoomController@index  (admin)
GET    /group/meetings/{meeting}              MeetingController@show
POST   /group/meetings                        MeetingController@store      (notifies invitees)
PUT    /group/meetings/{meeting}              MeetingController@update     (notifies on move/add/drop)
DELETE /group/meetings/{meeting}              MeetingController@destroy
POST   /group/meetings/{meeting}/cancel       MeetingController@cancel     (notifies attendees)
POST   /group/meetings/{meeting}/complete     MeetingController@complete
POST   /group/meetings/{meeting}/remind       MeetingController@remind
POST   /group/meetings/{meeting}/rsvp         MeetingRsvpController@store  (notifies organiser)
PUT    /group/meetings/{meeting}/attendance   MeetingAttendanceController@update
GET    /group/meetings/{meeting}/print        MeetingController@print      (PDF)
POST   /group/meeting-notes                   MeetingNoteController@store
PUT    /group/meeting-notes/{note}            MeetingNoteController@update
DELETE /group/meeting-notes/{note}            MeetingNoteController@destroy
POST   /group/meeting-actions                 MeetingActionController@store
PUT    /group/meeting-actions/{action}        MeetingActionController@update
DELETE /group/meeting-actions/{action}        MeetingActionController@destroy
POST   /group/meeting-actions/{action}/toggle MeetingActionController@toggle
resource /group/meeting-rooms                 MeetingRoomController        (admin)
PUT    /group/meeting-prefs                   MeetingPrefController@update (admin)
```

## Controllers
- **MeetingController** — index scopes through `Meeting::visibleTo(auth()->user())`; store/update
  wrap the notification fan-out in one DB transaction (persist first, notify after commit, so a
  rolled-back save never sends an invite). update() diffs date+time (→ reset RSVPs + notify
  "rescheduled"), added attendees (→ first-time invite) and dropped attendees (→ "removed").
  `conflicts()` is a query, not a constraint: `?force=1` proceeds past it.
- **MeetingRsvpController** — the ONLY meeting write an ordinary employee may make, and only
  for their own attendee row.
- **MeetingNoteController / MeetingActionController** — CRUD + the notify side-effects in
  rules 11.
- **MeetingRoomController / MeetingPrefController** — admin-gated setup.

## Models & migrations
```php
Meeting: id, title, topic, type, company_id, starts_at (datetime), duration_min,
         mode, meeting_room_id?, location, link, organizer_id, remind_min, status,
         timestamps
  // NOTE: the SPA stores date + time separately as local wall-clock strings. Server-side,
  // fold them into ONE `starts_at` and store the tenant timezone (Asia/Dhaka) — do not
  // store UTC and re-derive, or a meeting will drift across a DST/zone change.
  hasMany(MeetingAttendee) · hasMany(MeetingAgendaItem) · hasMany(MeetingNote)
  hasMany(MeetingAction)   · belongsTo(Employee,'organizer_id') · belongsTo(MeetingRoom)
  scopeVisibleTo($user) — admin: all; else where organizer_id = $user->id
                          orWhereHas('attendees', fn($q) => $q->where('employee_id', $user->id))
  getEndsAtAttribute() — starts_at->addMinutes(duration_min)
  scopeOverlapping($start,$end) — where('starts_at','<',$end)->where(raw ends_at,'>',$start)

MeetingAgendaItem: id, meeting_id, position, text, mins
MeetingAttendee:   id, meeting_id, employee_id, required, rsvp, attended?, timestamps
                   unique(meeting_id, employee_id)
MeetingNote:       id, meeting_id?, kind, title, body, decisions, author_id, pinned, timestamps
MeetingAction:     id, meeting_id?, text, assignee_id, due, priority, status, done_at?, timestamps
MeetingRoom:       id, name, location, capacity, facilities, timestamps
                   // soft-delete: an upcoming meeting keeps a deleted room's booking (view.js deleteRoom)
```
Add `to_id` (nullable FK employees) to the existing **notifications** table — the whole
addressed/broadcast rule (rule 8) is that one nullable column. Index `(to_id, read)`.

## Policies/permissions
`MeetingPolicy`:
- `viewAny` — any authenticated user (the query scope does the narrowing, not the gate)
- `view` — admin, organiser, or an attendee
- `create` / `update` / `delete` / `cancel` / `complete` / `remind` — admin OR organiser
- `rsvp` — the attendee themselves only (never on someone else's behalf)
- `manageRooms` / `managePrefs` — admin only

## Events
- `MeetingScheduled` → `MeetingInvited` notification, fanned out over attendees (queued)
- `MeetingRescheduled` → `MeetingRescheduled` notification + RSVP reset
- `MeetingCancelled` → `MeetingCancelled` notification (reaches even those who declined)
- `MeetingReminderRequested` → `MeetingReminder` notification (manual "Remind" button)
- `MinutesPublished` → `MeetingMinutesPublished` notification
- `ActionItemAssigned` / `ActionItemClosed` → notify the owner
- `AttendeeResponded` → notify the organiser
All notifications implement Laravel's `Notification` with the `database` channel writing the
`to_id` column; mail/WhatsApp channels are the natural next step (the SPA already composes the
same plain-text body — `meetingPlainText()` — for its Gmail/WhatsApp share buttons).

**Scheduled reminders**: `remind_min` is honest intent that the SPA can only fire manually
(no backend). Server-side this becomes a scheduled command
(`meetings:dispatch-reminders`, every minute) selecting meetings where
`starts_at - remind_min <= now() AND reminder_sent_at IS NULL AND status = 'scheduled'`,
then dispatching `MeetingReminder` and stamping `reminder_sent_at` — add that column.

## Engine dependencies
- **notifications** (`db.notify` / `db.inbox`) — the module's whole point. Requires the
  `to_id` column described above.
- **employees** — the attendee pool is `db.employees()` across every concern; the picker is
  company-filtered but never company-limited (a group meeting spans concerns by design).
- **config.companies** — concern badges/accents on rows, chips and calendar meeting bars.
- No **bridge** events: meetings record no money, so nothing rolls up to the Group books.
- No **ledger** posting. If meeting costs (venue hire, catering) are ever tracked, they
  belong in the existing expenses kit, not here.
