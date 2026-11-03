# VIBRANZA 2026–27 · House Entry Manager

A Google Apps Script web app for **Vivekananda Public School, Daporijo**.
House leaders and house teachers register and approve their house's participants;
the app enforces every rule (2 items per student, house limits, class, gender, team mix, deadlines…);
only the **school authority** can edit approved entries, events, rules, users and results.

```
Phone / laptop  ──►  Apps Script web app (src/)  ──►  Google Sheet "VIBRANZA_App_Database"
 (login: User ID + PIN)    every write: role check → rules check → write → audit log
```

---

## 1. Who can do what

| Role | Can | Cannot |
|---|---|---|
| **AUTHORITY** | Everything: add / edit / delete / override any entry, edit Events, Rules, Users, Exceptions, enter & publish results, lock days, read the audit log. Locks and deadlines do not stop the authority. | — |
| **TEACHER** (house teacher) | Add participants for **own house** (auto-approved by default), approve / reject / withdraw **pending** entries of own house. | Touch other houses, change approved entries, rules, events, results. |
| **LEADER** (house captain) | Add participants for **own house** (go to *Pending*), approve / reject pending entries if `LEADER_CAN_APPROVE = Yes`, withdraw pending entries. | Same as teacher, plus cannot approve when the rule is set to No. |
| **JUDGE** (optional) | Enter results for events where `Events.InCharge` = their User ID (unpublished until the authority publishes). | Everything else. |

Login is **User ID + PIN** (works with any phone, no Google account needed). PINs are visible only in the sheet, which only the authority opens.

---

## 2. Rules — how restrictions work

Two places, both editable **only by the authority**:

**a) Rules sheet / Rules tab** (general rules, one row each)

| RuleID | What it does | Default |
|---|---|---|
| `MAX_ITEMS_PER_STUDENT` | Max items a student may enter. Only events with `CountsToLimit = Yes` count. Add one row per scope. | 2 for **Arts**, 2 for **Sports**; an **All = 4** row is present but off |
| `HOUSE_LIMIT` | Enforce `MaxPerHouse` from the Events sheet | On |
| `CLASS_RANGE` | Student's class must be within `FromClass–ToClass` | On |
| `GENDER_MATCH` | Boys / Girls events only for that gender | On |
| `TIME_CLASH` | No two events at the same time for one student (when Date/Start/End are filled) | On |
| `COUNT_PENDING` | Pending entries count towards limits (stops overbooking) | Yes |
| `LEADER_CAN_APPROVE` | Captains may approve / reject | Yes |
| `LEADER_AUTO_APPROVE` | Captain's entries skip approval | No |
| `TEACHER_AUTO_APPROVE` | Teacher's entries skip approval | Yes |
| `ENTRY_LOCK` | Value **Yes** locks a whole day (Scope = Exhibition / Arts / Sports / All). Also one tap on the Dashboard. | No |
| `ENTRY_DEADLINE` | Entries close at `yyyy-mm-dd hh:mm` | 2026-11-12 17:00 |
| `CLOSE_HOURS_BEFORE` | Entries close N hours before an event that has a date & start time | 2 |

**Scope** can be `All`, a day (`Exhibition`, `Arts`, `Sports`) or a single Event ID (`E086`). The most specific active row wins.
Example: to allow **3 Arts items**, change the Arts row value to 3. To cap the whole fest at 4, set the All row Active = Yes.

**b) Events sheet / Events tab** (per-event limits)

| Column | Meaning |
|---|---|
| `MaxPerHouse` | Entries per house (blank = no limit) — e.g. 1 for Junior solo dance, 2 for speech, 7 for kabaddi, 15 for march past |
| `CountsToLimit` | Yes = counts towards `MAX_ITEMS_PER_STUDENT` (solo / off-stage / pair events). Group & team events are No. |
| `ReqBoys` / `ReqGirls` | Team mix, e.g. Senior Debate 2 + 2, Junior relay 2 + 2 |
| `Date`, `Start`, `End` | Used for time-clash and close-before rules (blank = not scheduled) |
| `Locked` | Yes = this one event stops taking entries |
| `InCharge` | User ID of the judge who may enter results |
| `NoEntries` | Yes = ceremonies / operations rows (never take entries) |

**c) Exceptions** — let one student break one rule (optionally for one event) with a reason, without switching the rule off for everyone. Logged.

Every rule is checked **twice**: when the entry is added and again when it is approved, so a rule changed in between is still respected.

---

## 3. Set-up (first time, ~20 minutes)

### Step 1 — the database
1. Upload **`VIBRANZA_App_Database.xlsx`** to Google Drive → right-click → **Open with → Google Sheets** → **File → Save as Google Sheets**.
2. Keep this sheet **private** (only the authority account). Nobody else needs access — the app writes for them.

The file already contains: 237 students, 161 programme items with limits from the updated lists, 16 default rules, points table, and 13 user accounts (ADMIN + teacher + 2 captains per house).

### Step 2 — the code (choose A or B)

**A. Copy-paste (no tools)**
1. In the Google Sheet: **Extensions → Apps Script**.
2. Create files with the same names and paste the contents: `Code.gs`, `Index.html`, `App.html`, `Styles.html` (use **+ → HTML** for the html files, name them without `.html`).
3. Project Settings → tick **Show "appsscript.json"** → paste `src/appsscript.json`.
4. Select function **`setup`** → **Run** → allow permissions. (Adds any missing sheets/headers; safe to run again.)

**B. GitHub + clasp (recommended — version history)**
```bash
npm install -g @google/clasp
clasp login
git clone https://github.com/<you>/vibranza-entry-app.git && cd vibranza-entry-app
# Script ID: Google Sheet → Extensions → Apps Script → Project Settings → Script ID
cp .clasp.json.example .clasp.json   # paste the Script ID
clasp push -f
```
Then run `setup` once from the Apps Script editor.

### Step 3 — publish the web app
Apps Script → **Deploy → New deployment → Web app**
- Execute as: **Me** (the authority account)
- Who has access: **Anyone**
- Deploy → copy the **/exec** URL.

Share the URL with captains and teachers (WhatsApp is fine). Add it to the phone home screen.
Public live scoreboard for the big screen: **`<URL>?view=board`** (refreshes every 30 s, shows published results only).

> After changing code later: **Deploy → Manage deployments → Edit → Version: New version → Deploy** (the URL stays the same).

### Step 4 — users and PINs
Open the **Users** tab in the app (or the Users sheet):
- Replace names "Garuda House Teacher", "Garuda Captain (Boy)" etc. with real names and phone numbers.
- **Change the ADMIN PIN (2026) immediately.** Each account has its own random PIN; give each person only their own.
- Add more authority accounts (Principal, office) or judges as needed. Set `Active = No` to block someone.

---

## 4. Daily use

**Captain / teacher**
1. *Add entry* → Day → Category → Event (shows `house entries / max`) → Student list shows **only eligible students of your house** with their current item count → live rule check → **Add entry**.
2. *My house* → Pending list → **Approve / Reject** (teacher, or captain if allowed) → *Print approved list*.
3. *Gaps* → events your house has not entered, events with free places, students not in any event.

**Authority**
- *Dashboard*: entries per house, pending count, students without an event, one-tap day locks.
- *All entries*: filter, approve, edit, delete; if an edit breaks a rule you can **Override with reason** (logged).
- *Events / Rules / Users / Exceptions*: edit anything; changes apply immediately to everyone.
- *Results*: pick event → 1st–4th (student for individual events, house for team/group events) → points from the Points table → saved as published; judges' results wait for **Publish**.
- *Audit log*: every login, entry, approval, edit, override and rule change with time and user.

---

## 5. Auto-deploy from GitHub (optional)

`.github/workflows/test-and-deploy.yml` runs the rules tests on every push to `main` and, if secrets exist, pushes to Apps Script and updates the live deployment.

Repository → Settings → Secrets and variables → Actions:
| Secret | Value |
|---|---|
| `CLASPRC_JSON` | contents of `~/.clasprc.json` after `clasp login` on your PC |
| `SCRIPT_ID` | the Apps Script project ID |
| `DEPLOYMENT_ID` | from **Deploy → Manage deployments** (the web-app deployment) |

Also enable the Apps Script API once: <https://script.google.com/home/usersettings>.

---

## 6. Tests

`npm test` (or `node tests/rules.test.js`) runs the real `Code.gs` against an in-memory copy of the sheet and checks 30 scenarios: login, PIN lockout after 5 wrong tries, house isolation, PIN hiding, class/gender/house checks, per-house limit, 2-item limit per day, group events not counted, duplicates, approval permissions, approved-entry protection, rule edits, exceptions, day lock (authority bypass), authority override, team mix (2 boys + 2 girls), time clash, entries closing before an event, results and scoreboard.

---

## 7. Next year

1. Make a copy of the Google Sheet (and the script comes with it).
2. Clear **Entries, Results, Exceptions, Audit**; update **Students** and **Events**; adjust **Rules**.
3. Deploy a new web app URL.

## 8. Limits to know
- Needs internet (each save takes ~1–2 s). Keep the Excel Event Manager / printed house forms as the offline fallback.
- Google quotas comfortably cover a 250-student school.
- Simultaneous saves are serialized with a script lock, so two captains cannot overbook the same event.

## Project structure
```
src/
  Code.gs          server: auth, rules engine, entries, admin, results, scoreboard, setup()
  Index.html       page shell
  App.html         client app (role-based tabs)
  Styles.html      mobile-first styles
  appsscript.json  manifest (web app executes as owner, anyone with the link)
tests/
  rules.test.js    rules-engine tests (Node, no Google account needed)
  seed.json        students / events / users used by the tests
.github/workflows/test-and-deploy.yml
```
