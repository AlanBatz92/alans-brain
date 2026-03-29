# Task Tracker Write-Back — Implementation Details

*Household Task Tracker upgraded from read-only dashboard to interactive web app with mark-as-done capability.*

Implemented: March 2026

-----

## Overview

The task tracker on `tasks.html` can now write back to the Google Sheet. Users tap a task card, pick their name, enter a PIN, and the sheet updates in real time. The existing read path, passphrase gate, and iPhone Shortcuts are completely untouched.

```
Before:  Google Sheet  -->  Apps Script (doGet)  -->  Website displays tasks

After:   Google Sheet <-->  Apps Script (doGet + doPost) <-->  Website reads AND writes
```

-----

## Security Model: Four Layers

The write-back feature adds a fourth security layer on top of the three that already existed:

| Layer | What | Where It Lives | Protects |
|-------|------|----------------|----------|
| 1. Unlisted page | `/tasks.html` not linked from `index.html` | URL structure | Casual discovery |
| 2. SHA-256 passphrase gate | `auth.js` hashes input, compares to `PASSPHRASE_HASH` | Hash in `auth.js`, passphrase in your head | Viewing the page at all |
| 3. Read key (`API_KEY`) | Sent with every `doGet` fetch | `tasks.js` source code | Fetching task data from the sheet |
| 4. Write PIN (`WRITE_PIN`) | Sent with every `doPost` request | Apps Script only + your head | Marking tasks as done |

The write PIN is **never** in any client-side file. It exists only as a JavaScript variable in memory after the user types it, and only for the duration of the browser session.

-----

## User Flow

### First Task (or After Page Reload)

1. Navigate to `/tasks.html`, enter passphrase to unlock (existing flow, unchanged)
2. Tasks load as usual
3. Tap a task card — completion drawer slides up from the bottom
4. Drawer shows:
   - Task name (e.g., "Clean Kitchen Counters")
   - Person picker — tappable name chips (dynamically populated from API)
   - PIN field — numeric keyboard (`inputmode="numeric"`)
   - "Done" button
5. Enter PIN, tap your name, tap Done
6. POST goes to Apps Script — sheet updates — drawer closes — card flashes green — data refreshes

### Subsequent Tasks (Same Session)

1. Tap a task card — drawer slides up
2. Your name is pre-selected (last used), **PIN field is hidden** (stored in session memory)
3. Tap "Done" — one tap to complete

-----

## What Changed: File by File

### `tasks.js` — Write-Back Logic

**New session variables:**
- `sessionWriteKey` — PIN stored in JS memory after first successful use
- `lastPerson` — pre-selects the last person used
- `FALLBACK_PEOPLE` — hardcoded `['Alan', 'Takyra']` if API hasn't returned names yet

**New functions:**
- `openDrawer(taskName, category, cardEl)` — populates drawer with task info, person chips, shows/hides PIN
- `closeDrawer()` — slides drawer away
- `submitDrawer()` — validates inputs, calls `markTaskDone()`, handles all error states
- `markTaskDone(taskName, category, person, writeKey)` — POSTs to Apps Script
- `getPersonList()` — dynamic person list from API `people` array, falls back to `weeklyStats` keys, then hardcoded list (`['Alan', 'Takyra', 'Cassie', 'Zion']`)

**Modified:**
- `renderTasks()` — task cards now get `data-task`, `data-category` attributes and `tappable` class
- `initTaskTracker()` — event delegation on `#tList` now handles both category collapse AND card taps; also sets up drawer event listeners (backdrop close, person picker, done button, PIN enter key)

### `tasks.html` — Drawer Markup

Added inside `#protectedContent`, between `#tWeekly` and the footer:
- Backdrop overlay (`drawer-backdrop`) — semi-transparent with blur, tappable to close
- Drawer container (`drawer`) — fixed-position bottom sheet
- Drag handle bar (visual affordance)
- Task name display
- Person picker container
- PIN input field (hidden after first successful entry)
- "Done" button
- Error message area

### `style.css` — Drawer Styles

~160 lines of new CSS, no modifications to existing rules:
- Backdrop: `rgba(10, 14, 26, 0.7)` with `backdrop-filter: blur(8px)`
- Drawer: slides up via `transform: translateY(100%)` to `translateY(0)` with spring-like cubic-bezier
- Person chips: styled like `.t-filter` buttons (same border-radius, font weight)
- PIN input: styled like `.auth-input` but with `inputmode="numeric"`, monospace font, centered text
- Done button: same teal-to-blue gradient as `.auth-btn`
- Shake animation: reuses `@keyframes inputShake` from auth gate
- Success flash: `@keyframes taskSuccess` — green inset box-shadow pulse on the task card
- `max-width: 520px` on drawer matches page content width
- Safe area padding for notched phones
- Scroll lock: `body.overflow = 'hidden'` when drawer is open, `touch-action: none` on backdrop, `overscroll-behavior: contain` on drawer — prevents background scroll on both desktop and mobile

### `auth.js` — No Changes

The passphrase gate is completely untouched.

### `index.html` — No Changes

The tasks page stays unlisted.

-----

## Apps Script Backend Changes

**File:** `code.txt` (on Desktop — paste into Google Apps Script editor)

### New: `WRITE_PIN` constant
```javascript
var WRITE_PIN = '8427'; // Change to whatever you want
```

### New: `doPost(e)` function

Handles POST requests from the website:
1. Parses `JSON.parse(e.postData.contents)`
2. Validates `payload.key === SECRET_KEY` (read key check)
3. Validates `payload.writeKey === WRITE_PIN` (write-specific check)
4. If `payload.action === 'markDone'`:
   - Finds the row where task name matches (and optionally category)
   - Sets column D (Last Completed) to `new Date()`
   - Computes Next Due = now + cycleDays
   - Sets column E (Next Due) to the computed date
   - Sets column F (Last Person) to `payload.person`
   - Appends a row to the Log sheet
5. Returns `{ success: true }` or `{ error: 'reason' }`

**Error codes returned:**
- `wrong-pin` — write PIN doesn't match
- `unauthorized` — read key doesn't match
- `task-not-found` — no matching row in the Tasks sheet
- `missing-task` — no task name in the request
- `invalid-json` — couldn't parse request body
- `unknown-action` — unrecognized action field

### Modified: `getTaskData()`

Now also returns a `people` array — unique person names from the full Log sheet (excluding "Unknown"). This powers the person picker in the drawer without hardcoding names.

```javascript
return JSON.stringify({ tasks: result, weeklyStats: stats, people: Object.keys(allPeople) });
```

### Deployment

After pasting the updated code:
1. Deploy > Manage Deployments > Edit existing deployment
2. Set Version to "New version"
3. Click Deploy
4. The URL stays the same

-----

## Google Sheet Structure

| Column | Header | Purpose |
|--------|--------|---------|
| A | Task | Task name (globally unique) |
| B | Category | Category (Kitchen, Basement, etc.) |
| C | Cycle (Days) | How often the task repeats |
| D | Last Completed | Date of last completion |
| E | Next Due | Computed: Last Completed + Cycle Days |
| F | Last Person | Who last completed the task |

**Log sheet:** Timestamp (A), Task (B), Person (C) — append-only audit trail.

Both `doGet` (NFC/Shortcuts) and `doPost` (website) write to the same columns in the same format.

-----

## Error Handling

| Error State | What Happens |
|-------------|-------------|
| Wrong PIN | PIN input shakes (reuses auth shake animation), shows "Wrong PIN" in red, clears field, refocuses |
| Task not found | Shows "Task not found in sheet — was it renamed?" in drawer |
| Network error | Shows "Couldn't reach the server" with retry capability |
| No person selected | Shows "Pick a person first" |
| No PIN entered | Shows "Enter the write PIN", focuses input |
| Double-tap | Button disables immediately on first tap, re-enables after response |

-----

## What Stays the Same

- iPhone Shortcuts — work exactly as before via `doGet` with `?task=` parameter
- The passphrase gate — `auth.js` untouched
- The read path — `doGet` + `API_KEY` unchanged
- Google Sheet structure — writing to existing columns, not adding new ones
- The unlisted page approach — `/tasks.html` absent from `index.html` nav
- Hosting — still static files, no new infrastructure
- `index.html` — no changes

-----

## Portability Note

This implementation is designed to be portable. If the task tracker moves to its own domain:
- The frontend files (`tasks.html`, `tasks.js`, `style.css`) can be moved as-is
- `API_URL` in `tasks.js` is the only connection point to the backend
- The Apps Script backend is domain-agnostic (accepts POST from any origin)
- The four-layer security model works regardless of hosting location
- Consider adding proper authentication (OAuth) if the page becomes publicly known

-----

## Future Enhancements (Not Implemented)

- Undo toast after marking done (brief "Undo" option for accidental taps)
- Lock icon in controls to manually clear the session PIN
- Add/edit tasks from the web app (same `doPost` pattern, bigger UI)
- Push notifications when tasks go overdue
- Google OAuth if the site ever goes semi-public
