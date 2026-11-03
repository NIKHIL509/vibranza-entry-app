/**
 * VIBRANZA 2026–27 · House Entry Manager
 * Vivekananda Public School, Daporijo
 *
 * Google Apps Script web app bound to the "VIBRANZA_App_Database" Google Sheet.
 * Every write goes through this file: login → role check → rules check → write → audit log.
 * The browser is never trusted.
 */

const SH = {
  USERS: 'Users', STU: 'Students', EV: 'Events', EN: 'Entries', RU: 'Rules',
  EX: 'Exceptions', PT: 'Points', RS: 'Results', AU: 'Audit', CL: 'Classes'
};
const ROLES = ['AUTHORITY', 'TEACHER', 'LEADER', 'JUDGE'];
const ACTIVE = ['Pending', 'Approved'];
const SESSION_SECONDS = 6 * 60 * 60;

/* =========================================================== WEB APP */
function doGet(e) {
  const t = HtmlService.createTemplateFromFile('Index');
  t.view = (e && e.parameter && e.parameter.view) || '';
  return t.evaluate()
    .setTitle('VIBRANZA 2026–27 · Entry Manager')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}
function include(name) { return HtmlService.createHtmlOutputFromFile(name).getContent(); }

/* =========================================================== SHEET HELPERS */
function sheet_(name) {
  const s = SpreadsheetApp.getActive().getSheetByName(name);
  if (!s) throw new Error('Missing sheet: ' + name + '. Run setup() once.');
  return s;
}
function cell_(v) {
  if (v instanceof Date) {
    const tz = Session.getScriptTimeZone();
    return v.getFullYear() < 1900 ? Utilities.formatDate(v, tz, 'HH:mm') : Utilities.formatDate(v, tz, 'yyyy-MM-dd');
  }
  return v === null || v === undefined ? '' : v;
}
function read_(name) {
  const values = sheet_(name).getDataRange().getValues();
  const head = values.shift().map(h => String(h).trim());
  const out = [];
  values.forEach((r, i) => {
    if (!r.some(c => c !== '' && c !== null)) return;
    const o = { _row: i + 2 };
    head.forEach((k, j) => { if (k) o[k] = cell_(r[j]); });
    out.push(o);
  });
  return out;
}
function headers_(name) {
  const s = sheet_(name);
  return s.getRange(1, 1, 1, s.getLastColumn()).getValues()[0].map(h => String(h).trim());
}
function append_(name, obj) {
  const h = headers_(name);
  sheet_(name).appendRow(h.map(k => obj[k] === undefined ? '' : obj[k]));
}
function update_(name, row, obj) {
  const s = sheet_(name), h = headers_(name);
  const cur = s.getRange(row, 1, 1, h.length).getValues()[0];
  h.forEach((k, j) => { if (Object.prototype.hasOwnProperty.call(obj, k)) cur[j] = obj[k]; });
  s.getRange(row, 1, 1, h.length).setValues([cur]);
}
function delete_(name, row) { sheet_(name).deleteRow(row); }
function yes_(v) { return /^(y|yes|true|1)$/i.test(String(v).trim()); }
function now_() { return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm:ss'); }
function audit_(user, action, details) {
  try { append_(SH.AU, { Time: now_(), User: user, Action: action, Details: typeof details === 'string' ? details : JSON.stringify(details) }); } catch (e) { }
}
function withLock_(fn) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try { return fn(); } finally { lock.releaseLock(); }
}

/* =========================================================== AUTH */
function login(userId, pin) {
  const id = String(userId || '').trim().toLowerCase();
  const cache = CacheService.getScriptCache(), fk = 'f_' + id;
  const fails = Number(cache.get(fk) || 0);
  if (fails >= 5) throw new Error('Too many wrong PINs. Try again after 15 minutes or ask the school office.');
  const u = read_(SH.USERS).find(x => String(x.UserID).trim().toLowerCase() === id);
  if (!u || !yes_(u.Active || 'Yes') || String(u.PIN).trim() === '' || String(u.PIN).trim() !== String(pin || '').trim()) {
    cache.put(fk, String(fails + 1), 900);
    audit_(userId, 'LOGIN_FAILED', '');
    throw new Error('Wrong User ID or PIN.');
  }
  cache.remove(fk);
  const token = Utilities.getUuid();
  CacheService.getScriptCache().put('t_' + token, String(u.UserID), SESSION_SECONDS);
  audit_(u.UserID, 'LOGIN', '');
  return { token: token, user: pubUser_(u) };
}
function logout(token) { CacheService.getScriptCache().remove('t_' + token); return true; }
function pubUser_(u) { return { id: String(u.UserID), name: u.Name, role: String(u.Role).toUpperCase().trim(), house: u.House || '' }; }
function me_(token) {
  const id = token && CacheService.getScriptCache().get('t_' + token);
  if (!id) throw new Error('SESSION_EXPIRED');
  const u = read_(SH.USERS).find(x => String(x.UserID) === id);
  if (!u || !yes_(u.Active || 'Yes')) throw new Error('SESSION_EXPIRED');
  const p = pubUser_(u);
  if (ROLES.indexOf(p.role) < 0) throw new Error('Your account has no valid role. Contact the school office.');
  return p;
}
function need_(user, roles) {
  if (roles.indexOf(user.role) < 0) throw new Error('Not allowed for your role (' + user.role + ').');
}

/* =========================================================== CONTEXT + RULES ENGINE */
function ctx_() {
  const classes = read_(SH.CL).map(c => String(c.Class));
  return {
    classes: classes.length ? classes : ['LKG', 'UKG', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10'],
    students: read_(SH.STU), events: read_(SH.EV), entries: read_(SH.EN),
    rules: read_(SH.RU), exceptions: read_(SH.EX)
  };
}
function activeRules_(c, id) { return c.rules.filter(r => String(r.RuleID).trim().toUpperCase() === id && yes_(r.Active)); }
function scopeMatch_(r, ev) { const s = String(r.Scope || 'All').trim().toLowerCase(); return s === '' || s === 'all' || s === String(ev.Module).toLowerCase() || s === String(ev.EventID).toLowerCase(); }
function rule_(c, id, ev) {
  const rs = activeRules_(c, id).filter(r => !ev || scopeMatch_(r, ev));
  if (!rs.length) return null;
  // most specific scope wins: EventID > Module > All
  rs.sort((a, b) => spec_(b, ev) - spec_(a, ev));
  return rs[0];
}
function spec_(r, ev) { const s = String(r.Scope || '').toLowerCase(); if (ev && s === String(ev.EventID).toLowerCase()) return 3; if (ev && s === String(ev.Module).toLowerCase()) return 2; return 1; }
function flag_(c, id, ev, dflt) { const r = rule_(c, id, ev); return r ? yes_(r.Value) : dflt; }
function excepted_(c, adm, ruleId, eventId) {
  return c.exceptions.some(x => String(x.AdmNo) === String(adm) && String(x.RuleID).toUpperCase() === ruleId &&
    (String(x.EventID || '') === '' || String(x.EventID) === String(eventId)));
}
function classIdx_(c, cls) { return c.classes.indexOf(String(cls).trim()); }
function minutes_(t) { const m = String(t || '').match(/^(\d{1,2}):(\d{2})/); return m ? (+m[1]) * 60 + (+m[2]) : null; }
function evStart_(ev) {
  if (!ev.Date || !ev.Start) return null;
  const d = String(ev.Date).split('-').map(Number), m = minutes_(ev.Start);
  if (d.length < 3 || m === null) return null;
  return new Date(d[0], d[1] - 1, d[2], Math.floor(m / 60), m % 60);
}
function isEntryEvent_(ev) { return String(ev.Type).toLowerCase() !== 'no points' && !yes_(ev.NoEntries); }

/**
 * Returns the list of rule violations for putting student `stu` into event `ev`.
 * `ignoreEntryId` lets approval / editing re-check an existing entry without counting itself.
 */
function check_(c, user, ev, stu, ignoreEntryId) {
  const v = [];
  const add = (id, msg) => { if (!excepted_(c, stu.AdmNo, id, ev.EventID)) v.push({ rule: id, msg: msg }); };
  const countPending = flag_(c, 'COUNT_PENDING', ev, true);
  const live = c.entries.filter(e => String(e.EntryID) !== String(ignoreEntryId) &&
    (e.Status === 'Approved' || (countPending && e.Status === 'Pending')));

  if (!isEntryEvent_(ev)) add('EVENT_OPEN', 'This item does not take house entries.');
  // Locks and deadlines stop houses, not the school authority (late changes are still logged).
  if (user.role !== 'AUTHORITY') {
    if (yes_(ev.Locked)) add('EVENT_LOCK', 'Entries for this event are locked.');
    if (flag_(c, 'ENTRY_LOCK', ev, false)) add('ENTRY_LOCK', 'Entries are locked for ' + ev.Module + '.');
    const dl = rule_(c, 'ENTRY_DEADLINE', ev);
    if (dl && String(dl.Value).trim()) {
      const d = new Date(String(dl.Value).replace(' ', 'T'));
      if (!isNaN(d) && new Date() > d) add('ENTRY_DEADLINE', 'Entry deadline passed (' + dl.Value + ').');
    }
    const cb = rule_(c, 'CLOSE_HOURS_BEFORE', ev), st = evStart_(ev);
    if (cb && st && Number(cb.Value) >= 0 && new Date() > new Date(st.getTime() - Number(cb.Value) * 3600000))
      add('CLOSE_HOURS_BEFORE', 'Entries closed ' + cb.Value + ' h before the event.');
  }

  if (!stu.House) add('HOUSE_MATCH', 'Student has no house assigned.');
  else if (user.role !== 'AUTHORITY' && String(stu.House) !== String(user.house)) add('HOUSE_MATCH', 'Student is not in ' + user.house + '.');

  if (flag_(c, 'CLASS_RANGE', ev, true)) {
    const i = classIdx_(c, stu.Class), a = classIdx_(c, ev.FromClass), b = classIdx_(c, ev.ToClass);
    if (i < 0 || (a >= 0 && i < a) || (b >= 0 && i > b)) add('CLASS_RANGE', 'Class ' + stu.Class + ' is not eligible (Class ' + ev.FromClass + '–' + ev.ToClass + ').');
  }
  if (flag_(c, 'GENDER_MATCH', ev, true)) {
    if (ev.Gender === 'Boys' && stu.Gender !== 'Boy') add('GENDER_MATCH', 'Boys-only event.');
    if (ev.Gender === 'Girls' && stu.Gender !== 'Girl') add('GENDER_MATCH', 'Girls-only event.');
  }
  if (live.some(e => String(e.EventID) === String(ev.EventID) && String(e.AdmNo) === String(stu.AdmNo)))
    add('DUPLICATE', 'Already entered in this event.');

  const sameHouse = live.filter(e => String(e.EventID) === String(ev.EventID) && String(e.House) === String(stu.House));
  if (flag_(c, 'HOUSE_LIMIT', ev, true) && Number(ev.MaxPerHouse) > 0 && sameHouse.length >= Number(ev.MaxPerHouse))
    add('HOUSE_LIMIT', stu.House + ' already has ' + sameHouse.length + ' of ' + ev.MaxPerHouse + ' entries here.');

  const sMap = {}; c.students.forEach(s => sMap[String(s.AdmNo)] = s);
  if (Number(ev.ReqBoys) > 0 && stu.Gender === 'Boy' && sameHouse.filter(e => (sMap[String(e.AdmNo)] || {}).Gender === 'Boy').length >= Number(ev.ReqBoys))
    add('TEAM_MIX', 'Team needs exactly ' + ev.ReqBoys + ' boys — already full.');
  if (Number(ev.ReqGirls) > 0 && stu.Gender === 'Girl' && sameHouse.filter(e => (sMap[String(e.AdmNo)] || {}).Gender === 'Girl').length >= Number(ev.ReqGirls))
    add('TEAM_MIX', 'Team needs exactly ' + ev.ReqGirls + ' girls — already full.');

  const evMap = {}; c.events.forEach(e => evMap[String(e.EventID)] = e);
  const mine = live.filter(e => String(e.AdmNo) === String(stu.AdmNo)).map(e => evMap[String(e.EventID)]).filter(Boolean);
  if (yes_(ev.CountsToLimit)) {
    activeRules_(c, 'MAX_ITEMS_PER_STUDENT').filter(r => scopeMatch_(r, ev)).forEach(r => {
      const lim = Number(r.Value); if (!(lim >= 0)) return;
      const scope = String(r.Scope || 'All').toLowerCase();
      const n = mine.filter(m => yes_(m.CountsToLimit) && (scope === 'all' || scope === '' || scope === String(m.Module).toLowerCase())).length;
      if (n >= lim) add('MAX_ITEMS_PER_STUDENT', stu.Name + ' is already in ' + n + ' item(s) — limit ' + lim + (scope === 'all' || scope === '' ? '' : ' for ' + r.Scope) + '.');
    });
  }
  if (flag_(c, 'TIME_CLASH', ev, true) && ev.Date && minutes_(ev.Start) !== null && minutes_(ev.End) !== null) {
    const s1 = minutes_(ev.Start), e1 = minutes_(ev.End);
    const clash = mine.find(m => m.Date === ev.Date && minutes_(m.Start) !== null && minutes_(m.End) !== null && minutes_(m.Start) < e1 && minutes_(m.End) > s1);
    if (clash) add('TIME_CLASH', 'Time clash with ' + clash.Event + ' (' + clash.Start + '–' + clash.End + ').');
  }
  return v;
}

/* =========================================================== DATA FOR THE APP */
function getData(token) {
  const user = me_(token), c = ctx_();
  const all = user.role === 'AUTHORITY';
  const evMap = {}; c.events.forEach(e => evMap[String(e.EventID)] = e);
  const stuMap = {}; c.students.forEach(s => stuMap[String(s.AdmNo)] = s);
  const myStudents = all ? c.students : c.students.filter(s => String(s.House) === String(user.house));
  const entries = c.entries.filter(e => all || user.role === 'JUDGE' || String(e.House) === String(user.house)).map(e => {
    const ev = evMap[String(e.EventID)] || {}, s = stuMap[String(e.AdmNo)] || {};
    return strip_(Object.assign({}, e, { EventName: ev.Event || '?', Module: ev.Module || '', StudentName: s.Name || '?', Class: s.Class || '', Gender: s.Gender || '' }));
  });
  // per-student counted-item totals (live), so the form can show "1/2" next to each name
  const countPending = true;
  const counts = {};
  c.entries.filter(e => e.Status === 'Approved' || (countPending && e.Status === 'Pending')).forEach(e => {
    const ev = evMap[String(e.EventID)]; if (!ev) return;
    const k = String(e.AdmNo); counts[k] = counts[k] || { All: 0 };
    if (yes_(ev.CountsToLimit)) { counts[k].All++; counts[k][ev.Module] = (counts[k][ev.Module] || 0) + 1; }
  });
  const houseCount = {};
  c.entries.filter(e => ACTIVE.indexOf(e.Status) >= 0).forEach(e => { const k = e.EventID + '|' + e.House; houseCount[k] = (houseCount[k] || 0) + 1; });
  return {
    user: user,
    classes: c.classes,
    students: myStudents.map(strip_),
    events: c.events.map(strip_),
    entries: entries,
    rules: all ? c.rules.map(strip_) : c.rules.filter(r => yes_(r.Active)).map(r => ({ RuleID: r.RuleID, Description: r.Description, Value: r.Value, Scope: r.Scope })),
    exceptions: all ? c.exceptions.map(strip_) : [],
    users: all ? read_(SH.USERS).map(u => strip_(Object.assign({}, u, { PIN: u.PIN ? '••••' : '' }))) : [],
    points: read_(SH.PT).map(strip_),
    results: read_(SH.RS).map(strip_),
    counts: counts, houseCount: houseCount,
    leaderCanApprove: flag_(c, 'LEADER_CAN_APPROVE', null, true),
    houses: houses_(c)
  };
}
function strip_(o) { const x = Object.assign({}, o); delete x._row; return x; }
function houses_(c) { const h = {}; c.students.forEach(s => { if (s.House) h[s.House] = 1; }); return Object.keys(h).sort(); }

/** Live check used by the form before saving (no write). */
function previewEntry(token, eventId, admNo) {
  const user = me_(token), c = ctx_();
  const ev = c.events.find(e => String(e.EventID) === String(eventId));
  const stu = c.students.find(s => String(s.AdmNo) === String(admNo));
  if (!ev || !stu) return [{ rule: 'NOT_FOUND', msg: 'Pick an event and a student.' }];
  return check_(c, user, ev, stu, null);
}

/* =========================================================== ENTRY ACTIONS */
function addEntry(token, eventId, admNo, note) {
  return withLock_(() => {
    const user = me_(token); need_(user, ['AUTHORITY', 'TEACHER', 'LEADER']);
    const c = ctx_();
    const ev = c.events.find(e => String(e.EventID) === String(eventId));
    const stu = c.students.find(s => String(s.AdmNo) === String(admNo));
    if (!ev) throw new Error('Event not found.');
    if (!stu) throw new Error('Student not found.');
    const v = check_(c, user, ev, stu, null);
    if (v.length) throw new Error('Blocked: ' + v.map(x => x.msg).join(' | '));
    let status = 'Pending';
    if (user.role === 'AUTHORITY') status = 'Approved';
    else if (user.role === 'TEACHER' && flag_(c, 'TEACHER_AUTO_APPROVE', ev, true)) status = 'Approved';
    else if (user.role === 'LEADER' && flag_(c, 'LEADER_AUTO_APPROVE', ev, false)) status = 'Approved';
    const id = 'N' + Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyMMddHHmmss') + Math.floor(Math.random() * 90 + 10);
    const row = { EntryID: id, EventID: ev.EventID, AdmNo: stu.AdmNo, House: stu.House, Status: status, AddedBy: user.id, AddedAt: now_(), ApprovedBy: status === 'Approved' ? user.id : '', ApprovedAt: status === 'Approved' ? now_() : '', Note: note || '' };
    append_(SH.EN, row);
    audit_(user.id, 'ADD_ENTRY', row);
    return { ok: true, status: status, id: id };
  });
}
function entryAndPerm_(c, user, entryId) {
  const e = c.entries.find(x => String(x.EntryID) === String(entryId));
  if (!e) throw new Error('Entry not found.');
  if (user.role !== 'AUTHORITY' && String(e.House) !== String(user.house)) throw new Error('This entry belongs to another house.');
  return e;
}
function approveEntry(token, entryId) {
  return withLock_(() => {
    const user = me_(token), c = ctx_();
    need_(user, ['AUTHORITY', 'TEACHER', 'LEADER']);
    if (user.role === 'LEADER' && !flag_(c, 'LEADER_CAN_APPROVE', null, true)) throw new Error('House leaders cannot approve — ask your house teacher.');
    const e = entryAndPerm_(c, user, entryId);
    if (e.Status !== 'Pending') throw new Error('Only pending entries can be approved.');
    const ev = c.events.find(x => String(x.EventID) === String(e.EventID)), stu = c.students.find(s => String(s.AdmNo) === String(e.AdmNo));
    const v = check_(c, user, ev, stu, e.EntryID);
    if (v.length) throw new Error('Cannot approve: ' + v.map(x => x.msg).join(' | '));
    update_(SH.EN, e._row, { Status: 'Approved', ApprovedBy: user.id, ApprovedAt: now_() });
    audit_(user.id, 'APPROVE', e.EntryID);
    return { ok: true };
  });
}
function rejectEntry(token, entryId, reason) {
  return withLock_(() => {
    const user = me_(token), c = ctx_();
    need_(user, ['AUTHORITY', 'TEACHER', 'LEADER']);
    if (user.role === 'LEADER' && !flag_(c, 'LEADER_CAN_APPROVE', null, true)) throw new Error('House leaders cannot reject — ask your house teacher.');
    const e = entryAndPerm_(c, user, entryId);
    if (e.Status !== 'Pending') throw new Error('Only pending entries can be rejected. Approved entries can be changed only by the school authority.');
    update_(SH.EN, e._row, { Status: 'Rejected', ApprovedBy: user.id, ApprovedAt: now_(), Note: reason || e.Note });
    audit_(user.id, 'REJECT', { id: e.EntryID, reason: reason });
    return { ok: true };
  });
}
function withdrawEntry(token, entryId) {
  return withLock_(() => {
    const user = me_(token), c = ctx_();
    need_(user, ['AUTHORITY', 'TEACHER', 'LEADER']);
    const e = entryAndPerm_(c, user, entryId);
    if (user.role !== 'AUTHORITY' && e.Status !== 'Pending') throw new Error('Approved entries can be changed only by the school authority.');
    update_(SH.EN, e._row, { Status: 'Withdrawn', ApprovedBy: user.id, ApprovedAt: now_() });
    audit_(user.id, 'WITHDRAW', e.EntryID);
    return { ok: true };
  });
}

/* =========================================================== AUTHORITY-ONLY EDITING */
function adminEditEntry(token, entryId, changes, force, reason) {
  return withLock_(() => {
    const user = me_(token); need_(user, ['AUTHORITY']);
    const c = ctx_(), e = entryAndPerm_(c, user, entryId);
    const next = Object.assign({}, e, changes || {});
    if (ACTIVE.indexOf(next.Status) >= 0) {
      const ev = c.events.find(x => String(x.EventID) === String(next.EventID)), stu = c.students.find(s => String(s.AdmNo) === String(next.AdmNo));
      if (!ev || !stu) throw new Error('Event or student not found.');
      next.House = stu.House;
      const v = check_(c, user, ev, stu, e.EntryID);
      if (v.length && !force) return { ok: false, violations: v };
      if (v.length && !reason) throw new Error('Give a reason to override the rules.');
    }
    update_(SH.EN, e._row, { EventID: next.EventID, AdmNo: next.AdmNo, House: next.House, Status: next.Status, Note: reason ? ('[Override] ' + reason) : (next.Note || '') });
    audit_(user.id, force ? 'ADMIN_OVERRIDE' : 'ADMIN_EDIT', { id: e.EntryID, changes: changes, reason: reason });
    return { ok: true };
  });
}
function adminDeleteEntry(token, entryId, reason) {
  return withLock_(() => {
    const user = me_(token); need_(user, ['AUTHORITY']);
    const c = ctx_(), e = entryAndPerm_(c, user, entryId);
    delete_(SH.EN, e._row);
    audit_(user.id, 'ADMIN_DELETE', { entry: strip_(e), reason: reason });
    return { ok: true };
  });
}
/** Generic upsert for Rules / Events / Users / Exceptions / Points (authority only). */
const EDITABLE = { Events: 'EventID', Users: 'UserID', Exceptions: null, Points: 'Type', Students: 'AdmNo' };
function adminSave(token, table, rec, originalKey) {
  return withLock_(() => {
    const user = me_(token); need_(user, ['AUTHORITY']);
    if (!Object.prototype.hasOwnProperty.call(EDITABLE, table)) throw new Error('Table not editable.');
    const key = EDITABLE[table], rows = read_(table);
    const r = Object.assign({}, rec); delete r._row;
    if (table === 'Users') {
      r.Role = String(r.Role || '').toUpperCase();
      if (ROLES.indexOf(r.Role) < 0) throw new Error('Role must be one of ' + ROLES.join(', '));
      if (r.PIN === '••••') delete r.PIN;          // unchanged PIN
    }
    if (table === 'Exceptions') { r.GrantedBy = user.id; r.GrantedAt = now_(); append_(table, r); audit_(user.id, 'ADD_EXCEPTION', r); return { ok: true }; }
    const find = String(originalKey || r[key]);
    const cur = rows.find(x => String(x[key]) === find);
    if (cur) update_(table, cur._row, r); else append_(table, r);
    audit_(user.id, 'SAVE_' + table.toUpperCase(), r);
    return { ok: true };
  });
}
function adminDelete(token, table, keyValue, rowNo) {
  return withLock_(() => {
    const user = me_(token); need_(user, ['AUTHORITY']);
    if (!Object.prototype.hasOwnProperty.call(EDITABLE, table)) throw new Error('Table not editable.');
    const key = EDITABLE[table], rows = read_(table);
    const cur = key ? rows.find(x => String(x[key]) === String(keyValue)) : rows[Number(rowNo)];
    if (!cur) throw new Error('Row not found.');
    delete_(table, cur._row);
    audit_(user.id, 'DELETE_' + table.toUpperCase(), strip_(cur));
    return { ok: true };
  });
}

/** Rules can repeat one RuleID with different scopes, so they are matched on RuleID + Scope. */
function saveRule(token, rec, orig) {
  return withLock_(() => {
    const user = me_(token); need_(user, ['AUTHORITY']);
    const r = { RuleID: String(rec.RuleID || '').trim().toUpperCase(), Value: rec.Value, Scope: String(rec.Scope || 'All').trim(), Active: yes_(rec.Active) ? 'Yes' : 'No' };
    if (!r.RuleID) throw new Error('Rule ID required.');
    const rows = read_(SH.RU);
    const o = orig || r;
    const cur = rows.find(x => String(x.RuleID).toUpperCase() === String(o.RuleID).toUpperCase() && String(x.Scope || 'All').toLowerCase() === String(o.Scope || 'All').toLowerCase());
    r.Description = rec.Description || (cur && cur.Description) || '';
    r.Notes = rec.Notes || (cur && cur.Notes) || '';
    if (cur) update_(SH.RU, cur._row, r); else append_(SH.RU, r);
    audit_(user.id, 'SAVE_RULE', r);
    return { ok: true };
  });
}

/* =========================================================== RESULTS + SCOREBOARD */
function saveResults(token, eventId, places) {
  return withLock_(() => {
    const user = me_(token); need_(user, ['AUTHORITY', 'JUDGE']);
    const c = ctx_(), ev = c.events.find(e => String(e.EventID) === String(eventId));
    if (!ev) throw new Error('Event not found.');
    if (user.role === 'JUDGE' && String(ev.InCharge) !== String(user.id)) throw new Error('You are not the in-charge of this event.');
    if (user.role === 'JUDGE' && read_(SH.RS).some(r => String(r.EventID) === String(eventId) && yes_(r.Published))) throw new Error('Results already published — only the school authority can change them.');
    const pts = read_(SH.PT).find(p => String(p.Type) === String(ev.Type)) || {};
    // remove old rows for this event (bottom-up)
    read_(SH.RS).filter(r => String(r.EventID) === String(eventId)).map(r => r._row).sort((a, b) => b - a).forEach(r => delete_(SH.RS, r));
    (places || []).forEach(p => {
      if (!p || (!p.House && !p.AdmNo)) return;
      let house = p.House;
      if (p.AdmNo) { const s = c.students.find(x => String(x.AdmNo) === String(p.AdmNo)); if (s) house = s.House; }
      append_(SH.RS, { EventID: eventId, Place: p.Place, House: house, AdmNo: p.AdmNo || '', Points: Number(pts['P' + p.Place] || 0), Published: user.role === 'AUTHORITY' ? 'Yes' : 'No', EnteredBy: user.id, EnteredAt: now_() });
    });
    audit_(user.id, 'SAVE_RESULTS', { eventId: eventId, places: places });
    return { ok: true };
  });
}
function publishResults(token, eventId, publish) {
  return withLock_(() => {
    const user = me_(token); need_(user, ['AUTHORITY']);
    read_(SH.RS).filter(r => String(r.EventID) === String(eventId)).forEach(r => update_(SH.RS, r._row, { Published: publish ? 'Yes' : 'No' }));
    audit_(user.id, publish ? 'PUBLISH' : 'UNPUBLISH', eventId);
    return { ok: true };
  });
}
/** Public, no login: published points only. */
function getScoreboard() {
  const ev = {}; read_(SH.EV).forEach(e => ev[String(e.EventID)] = e);
  const board = {}, recent = [];
  read_(SH.RS).filter(r => yes_(r.Published)).forEach(r => {
    const h = r.House || '—', m = (ev[String(r.EventID)] || {}).Module || 'Other';
    board[h] = board[h] || { House: h, Total: 0 };
    board[h].Total += Number(r.Points) || 0;
    board[h][m] = (board[h][m] || 0) + (Number(r.Points) || 0);
    if (String(r.Place) === '1') recent.push({ Event: (ev[String(r.EventID)] || {}).Event || r.EventID, House: h, At: r.EnteredAt });
  });
  recent.sort((a, b) => String(b.At).localeCompare(String(a.At)));
  return { rows: Object.keys(board).map(k => board[k]).sort((a, b) => b.Total - a.Total), recent: recent.slice(0, 8), updated: now_() };
}

/* =========================================================== AUDIT VIEW */
function getAudit(token, limit) {
  const user = me_(token); need_(user, ['AUTHORITY']);
  const rows = read_(SH.AU).map(strip_);
  return rows.slice(Math.max(0, rows.length - (limit || 200))).reverse();
}

/* =========================================================== ONE-TIME SETUP */
/** Run once from the editor: creates any missing sheets with the right headers and default rules. */
function setup() {
  const ss = SpreadsheetApp.getActive();
  const schema = {
    Users: ['UserID', 'Name', 'Role', 'House', 'PIN', 'Active', 'Phone'],
    Students: ['AdmNo', 'Name', 'Class', 'Section', 'Gender', 'House'],
    Classes: ['Class'],
    Events: ['EventID', 'Module', 'Event', 'Category', 'FromClass', 'ToClass', 'Gender', 'Type', 'MaxPerHouse', 'CountsToLimit', 'ReqBoys', 'ReqGirls', 'Date', 'Start', 'End', 'Venue', 'InCharge', 'Locked', 'NoEntries'],
    Entries: ['EntryID', 'EventID', 'AdmNo', 'House', 'Status', 'AddedBy', 'AddedAt', 'ApprovedBy', 'ApprovedAt', 'Note'],
    Rules: ['RuleID', 'Description', 'Value', 'Scope', 'Active', 'Notes'],
    Exceptions: ['AdmNo', 'RuleID', 'EventID', 'Reason', 'GrantedBy', 'GrantedAt'],
    Points: ['Type', 'P1', 'P2', 'P3', 'P4'],
    Results: ['EventID', 'Place', 'House', 'AdmNo', 'Points', 'Published', 'EnteredBy', 'EnteredAt'],
    Audit: ['Time', 'User', 'Action', 'Details']
  };
  Object.keys(schema).forEach(n => {
    let s = ss.getSheetByName(n);
    if (!s) { s = ss.insertSheet(n); s.getRange(1, 1, 1, schema[n].length).setValues([schema[n]]).setFontWeight('bold'); s.setFrozenRows(1); }
  });
  if (read_(SH.CL).length === 0) sheet_(SH.CL).getRange(2, 1, 12, 1).setValues(['LKG', 'UKG', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10'].map(x => [x]));
  if (read_(SH.RU).length === 0) {
    sheet_(SH.RU).getRange(2, 1, DEFAULT_RULES.length, 6).setValues(DEFAULT_RULES);
  }
  ['Students', 'Classes', 'Entries', 'Results'].forEach(n => sheet_(n).getRange('A:D').setNumberFormat('@'));
  return 'Setup complete';
}
const DEFAULT_RULES = [
  ['MAX_ITEMS_PER_STUDENT', 'Max competitive items one student may enter (events with CountsToLimit = Yes)', 2, 'Arts', 'Yes', 'Change the number or add another row for Sports / All'],
  ['MAX_ITEMS_PER_STUDENT', 'Max competitive items one student may enter', 2, 'Sports', 'Yes', ''],
  ['MAX_ITEMS_PER_STUDENT', 'Max competitive items across the whole fest', 4, 'All', 'No', 'Turn on to cap the total'],
  ['HOUSE_LIMIT', 'Respect "MaxPerHouse" in the Events sheet', 'Yes', 'All', 'Yes', ''],
  ['CLASS_RANGE', 'Student class must be within the event class range', 'Yes', 'All', 'Yes', ''],
  ['GENDER_MATCH', 'Boys / Girls events only for that gender', 'Yes', 'All', 'Yes', ''],
  ['TIME_CLASH', 'Block a student from two events at the same time (when times are filled)', 'Yes', 'All', 'Yes', ''],
  ['COUNT_PENDING', 'Count pending entries towards limits (prevents overbooking)', 'Yes', 'All', 'Yes', ''],
  ['LEADER_CAN_APPROVE', 'House leaders may approve / reject entries of their house', 'Yes', 'All', 'Yes', 'Set to No for teacher-only approval'],
  ['LEADER_AUTO_APPROVE', "Leader's entries are approved immediately", 'No', 'All', 'Yes', ''],
  ['TEACHER_AUTO_APPROVE', "Teacher's entries are approved immediately", 'Yes', 'All', 'Yes', ''],
  ['ENTRY_LOCK', 'Lock all entries for a day (Value Yes = locked)', 'No', 'Arts', 'Yes', 'Scope: Arts / Sports / Exhibition / All'],
  ['ENTRY_LOCK', 'Lock all entries for a day', 'No', 'Sports', 'Yes', ''],
  ['ENTRY_LOCK', 'Lock all entries for a day', 'No', 'Exhibition', 'Yes', ''],
  ['ENTRY_DEADLINE', 'Entries close at this date-time (yyyy-mm-dd hh:mm)', '2026-11-12 17:00', 'All', 'Yes', ''],
  ['CLOSE_HOURS_BEFORE', 'Entries close this many hours before an event that has a date & start time', 2, 'All', 'Yes', '']
];
