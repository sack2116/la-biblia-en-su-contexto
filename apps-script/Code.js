/**
 * La Biblia en su Contexto — boletín automático (Google Apps Script).
 *
 * Gratis: guarda los suscriptores en una Hoja de cálculo de Google y envía
 * los correos desde tu Gmail. Un activador revisa cada 5 minutos:
 *   - la serie de bienvenida (pestaña "Bienvenida")
 *   - los mensajes a todos (pestaña "Mensajes")
 *
 * La página web (GitHub Pages) llama a doPost() para suscribir, confirmar y dar de baja.
 */

const CONFIG = {
  SITE_URL: 'https://sack2116.github.io/la-biblia-en-su-contexto',
  YOUTUBE_URL: 'https://www.youtube.com/@labibliaensucontexto401',
  FROM_NAME: 'La Biblia en su Contexto',
  SIGNATURE: 'Isaac Dominguez',
  SPREADSHEET_NAME: 'Boletín · La Biblia en su Contexto',
  DAY_MS: 24 * 60 * 60 * 1000,
  RESERVE_QUOTA: 10,          // correos diarios reservados para confirmaciones
  MAX_RUN_MS: 4.5 * 60 * 1000, // Apps Script corta a los 6 minutos
};

const SUBS = 'Suscriptores';
const SEQ = 'Bienvenida';
const MSG = 'Mensajes';
const HELP = 'Cómo usar';

const SUB_HEADERS = ['Correo', 'Nombre', 'Interés', 'Estado', 'Creado', 'Confirmado', 'Baja', 'Correos enviados', 'Token'];
const S = { email: 1, name: 2, interest: 3, status: 4, created: 5, confirmed: 6, unsub: 7, sent: 8, token: 9 };

const SEQ_HEADERS = ['ID', 'Día', 'Asunto', 'Vista previa', 'Mensaje', 'Texto del botón', 'Enlace del botón', 'Activo'];

const MSG_HEADERS = ['Asunto', 'Vista previa', 'Mensaje', 'Texto del botón', 'Enlace del botón', 'Enviar prueba a', '¿Enviar a todos?', 'Estado', 'Enviados', 'ID', 'Iniciado'];
const M = { subject: 1, preheader: 2, body: 3, ctaText: 4, ctaUrl: 5, testTo: 6, go: 7, status: 8, count: 9, id: 10, started: 11 };

const ACTIVE = 'Activo', PENDING = 'Pendiente', UNSUB = 'Baja';
const EMAIL_RE = /^[^\s@<>()",;:]+@[^\s@<>()",;:]+\.[^\s@<>()",;:]{2,}$/;
const INTERESTS = { todo: 'Un poco de todo', historia: 'Contexto histórico', idiomas: 'Hebreo y griego', aplicacion: 'Aplicación', familia: 'Matrimonio y familia' };

// =====================================================================
// Web app
// =====================================================================

/** El dueño abre la URL del web app una vez: autoriza y todo queda listo. */
function doGet() {
  const url = setup();
  const quota = MailApp.getRemainingDailyQuota();
  const html = `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
  <style>body{font:17px/1.6 system-ui,sans-serif;background:#061638;color:#eaf1ff;display:grid;place-items:center;min-height:90vh;margin:0;padding:16px}
  .c{max-width:520px;background:#0a2560;border:1px solid #2a4a8a;border-radius:16px;padding:28px}a{color:#9cc4ff}h1{margin-top:0}</style></head>
  <body><div class="c"><h1>✓ El boletín está listo</h1>
  <p>Las suscripciones se guardan en tu hoja: <a href="${url}" target="_blank">${CONFIG.SPREADSHEET_NAME}</a></p>
  <p>Los correos automáticos se revisan cada 5 minutos. Te quedan <b>${quota}</b> envíos de Gmail por hoy.</p>
  <p>Página pública: <a href="${CONFIG.SITE_URL}" target="_blank">${CONFIG.SITE_URL}</a></p></div></body></html>`;
  return HtmlService.createHtmlOutput(html).setTitle('Boletín listo');
}

function doPost(e) {
  let data = {};
  try { data = JSON.parse((e && e.postData && e.postData.contents) || '{}'); } catch (_) { /* vacío */ }
  let out;
  try {
    if (data.action === 'subscribe') out = subscribe_(data);
    else if (data.action === 'confirm') out = confirm_(String(data.token || ''));
    else if (data.action === 'unsubscribe') out = unsubscribe_(String(data.token || ''), !!data.commit);
    else out = { ok: false, error: 'Acción no válida.' };
  } catch (err) {
    console.error(err && err.stack || err);
    out = { ok: false, error: 'Ocurrió un error. Inténtalo de nuevo en unos minutos.' };
  }
  return ContentService.createTextOutput(JSON.stringify(out)).setMimeType(ContentService.MimeType.JSON);
}

// =====================================================================
// Acciones
// =====================================================================

function subscribe_(d) {
  const okMsg = { ok: true, message: 'Te enviamos un enlace para confirmar tu suscripción.' };
  if (d.website) return okMsg; // honeypot: bot

  const email = String(d.email || '').trim().toLowerCase();
  const name = clean_(d.name, 80);
  const interest = INTERESTS[d.interest] ? d.interest : 'todo';
  if (!EMAIL_RE.test(email) || email.length > 254) return { ok: false, error: 'Escribe un correo electrónico válido.' };
  if (!d.consent) return { ok: false, error: 'Debes aceptar recibir correos para suscribirte.' };

  // Protección contra abuso: máx. 30 suscripciones por minuto en total
  const cache = CacheService.getScriptCache();
  const minuteKey = 'rate:' + Math.floor(Date.now() / 60000);
  const count = Number(cache.get(minuteKey) || 0) + 1;
  cache.put(minuteKey, String(count), 120);
  if (count > 30) return { ok: false, error: 'Hay muchas solicitudes ahora mismo. Inténtalo en un minuto.' };

  const sheet = sheet_(SUBS);
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  let row, token, status;
  try {
    row = findRow_(sheet, S.email, email, false);
    const now = new Date();
    if (!row) {
      token = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '').slice(0, 16);
      sheet.appendRow([email, name, INTERESTS[interest], PENDING, now, '', '', '', token]);
      row = sheet.getLastRow();
      status = PENDING;
    } else {
      const vals = sheet.getRange(row, 1, 1, SUB_HEADERS.length).getValues()[0];
      token = vals[S.token - 1];
      status = vals[S.status - 1];
      if (status === ACTIVE) return okMsg; // ya suscrito: no revelamos nada
      if (status === UNSUB) {
        sheet.getRange(row, S.status, 1, 4).setValues([[PENDING, vals[S.created - 1], '', '']]);
        status = PENDING;
      }
      if (name) sheet.getRange(row, S.name).setValue(name);
    }
    SpreadsheetApp.flush();
  } finally {
    lock.releaseLock();
  }

  // No reenviar la confirmación al mismo correo más de una vez cada 2 minutos
  if (cache.get('conf:' + email)) return okMsg;
  if (MailApp.getRemainingDailyQuota() < 1) {
    return { ok: false, error: 'Hoy recibimos muchas suscripciones. Inténtalo de nuevo mañana, por favor.' };
  }
  cache.put('conf:' + email, '1', 120);
  sendMail_({ email: email, name: name, token: token }, {
    transactional: true,
    subject: 'Confirma tu suscripción a La Biblia en su Contexto',
    preheader: 'Un clic y empiezas a recibir los estudios.',
    body: 'Hola {{nombre}},\n\nGracias por suscribirte al boletín. Para empezar a recibir los estudios, confirma tu correo con el botón de abajo.',
    ctaText: 'Confirmar mi suscripción',
    ctaUrl: CONFIG.SITE_URL + '/confirmar.html?t=' + token,
  });
  return okMsg;
}

function confirm_(token) {
  if (!/^[a-f0-9]{32,64}$/.test(token)) return { ok: false, error: 'Este enlace no es válido.' };
  const sheet = sheet_(SUBS);
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  let row, sub;
  try {
    row = findRow_(sheet, S.token, token, true);
    if (!row) return { ok: false, error: 'Este enlace no es válido o ya expiró.' };
    sub = rowToSub_(sheet.getRange(row, 1, 1, SUB_HEADERS.length).getValues()[0]);
    if (sub.status === UNSUB) return { ok: true, status: 'unsubscribed' };
    if (sub.status === PENDING) {
      sheet.getRange(row, S.status).setValue(ACTIVE);
      sheet.getRange(row, S.confirmed).setValue(new Date());
      SpreadsheetApp.flush();
    }
  } finally {
    lock.releaseLock();
  }
  // Correos del día 0 al instante (no esperar al activador)
  try {
    migrate_();
    const steps = steps_().filter(function (s) { return s.day <= 0; });
    steps.forEach(function (s) { deliver_(sheet, row, sub.email, s.id, s); });
  } catch (err) { console.error(err); }
  return { ok: true, status: 'active', youtube: CONFIG.YOUTUBE_URL };
}

function unsubscribe_(token, commit) {
  if (!/^[a-f0-9]{32,64}$/.test(token)) return { ok: false, error: 'Este enlace no es válido.' };
  const sheet = sheet_(SUBS);
  const row = findRow_(sheet, S.token, token, true);
  if (!row) return { ok: false, error: 'No encontramos esta suscripción.' };
  const sub = rowToSub_(sheet.getRange(row, 1, 1, SUB_HEADERS.length).getValues()[0]);
  if (!commit) return { ok: true, email: sub.email, status: sub.status === UNSUB ? 'unsubscribed' : 'active' };
  if (sub.status !== UNSUB) {
    sheet.getRange(row, S.status).setValue(UNSUB);
    sheet.getRange(row, S.unsub).setValue(new Date());
  }
  return { ok: true, email: sub.email, status: 'unsubscribed' };
}

// =====================================================================
// Activador: secuencia + mensajes a todos
// =====================================================================

/**
 * Actualiza contenido ya guardado en la hoja cuando cambia el contenido por defecto.
 * Solo reemplaza filas que el dueño no ha editado.
 */
function migrate_() {
  const props = PropertiesService.getScriptProperties();
  const version = Number(props.getProperty('CONTENT_VERSION') || 1);
  if (version >= 2) return;
  const seq = sheet_(SEQ);
  const v = seq.getDataRange().getValues();
  const norm = function (s) { return String(s || '').replace(/\s+/g, ' ').trim(); };
  const welcome = DEFAULT_SEQUENCE[0];
  for (let r = 1; r < v.length; r++) {
    if (String(v[r][0]).trim() === 'bienvenida' && norm(v[r][4]) === norm(LEGACY_WELCOME_BODY)) {
      seq.getRange(r + 1, 3, 1, 3).setValues([[welcome.subject, welcome.preheader, welcome.body.trim()]]);
    }
  }
  props.setProperty('CONTENT_VERSION', '2');
}

function tick() {
  try { migrate_(); } catch (err) { console.error('migrate_: ' + err); }
  const started = Date.now();
  const outOfTime = function () { return Date.now() - started > CONFIG.MAX_RUN_MS; };
  const outOfQuota = function () { return MailApp.getRemainingDailyQuota() <= CONFIG.RESERVE_QUOTA; };

  const subsSheet = sheet_(SUBS);
  const msgSheet = sheet_(MSG);

  // 1) Correos de prueba
  const msgs = msgSheet.getDataRange().getValues();
  for (let r = 1; r < msgs.length; r++) {
    const testTo = String(msgs[r][M.testTo - 1] || '').trim();
    if (!testTo) continue;
    const row = r + 1;
    if (!EMAIL_RE.test(testTo)) { msgSheet.getRange(row, M.status).setValue('Correo de prueba no válido'); continue; }
    const m = msgRow_(msgs[r]);
    if (!m.subject || !m.body) { msgSheet.getRange(row, M.status).setValue('Falta asunto o mensaje'); continue; }
    if (outOfQuota()) break;
    sendMail_({ email: testTo, name: 'Prueba', token: '' }, Object.assign({}, m, { subject: '[PRUEBA] ' + m.subject }));
    msgSheet.getRange(row, M.testTo).setValue('');
    if (!m.go) msgSheet.getRange(row, M.status).setValue('Prueba enviada a ' + testTo + ' ✓');
  }

  // 2) Serie de bienvenida
  const steps = steps_();
  const subs = subsSheet.getDataRange().getValues();
  const now = Date.now();
  for (let r = 1; r < subs.length; r++) {
    const sub = rowToSub_(subs[r]);
    if (sub.status !== ACTIVE || !(sub.confirmed instanceof Date)) continue;
    for (const step of steps) {
      if (now - sub.confirmed.getTime() < step.day * CONFIG.DAY_MS) continue;
      if (hasKey_(sub.sent, step.id)) continue;
      if (outOfTime() || outOfQuota()) return;
      deliver_(subsSheet, r + 1, sub.email, step.id, step);
    }
  }

  // 3) Mensajes a todos
  for (let r = 1; r < msgs.length; r++) {
    const row = r + 1;
    const m = msgRow_(msgs[r]);
    if (!m.go || String(m.status).indexOf('Completado') === 0) continue;
    if (!m.subject || !m.body) { msgSheet.getRange(row, M.status).setValue('Falta asunto o mensaje'); continue; }
    if (m.ctaText && !/^https?:\/\//.test(m.ctaUrl)) { msgSheet.getRange(row, M.status).setValue('El enlace del botón debe empezar con https://'); continue; }

    let id = m.id, start = m.started;
    if (!id) {
      id = 'M' + Date.now().toString(36);
      start = new Date();
      msgSheet.getRange(row, M.id).setValue(id);
      msgSheet.getRange(row, M.started).setValue(start);
    }
    const startMs = start instanceof Date ? start.getTime() : now;
    const fresh = subsSheet.getDataRange().getValues();
    let sent = 0, total = 0, paused = false;
    for (let i = 1; i < fresh.length; i++) {
      const sub = rowToSub_(fresh[i]);
      if (sub.status !== ACTIVE || !(sub.confirmed instanceof Date) || sub.confirmed.getTime() > startMs) continue;
      total++;
      if (hasKey_(sub.sent, id)) { sent++; continue; }
      if (outOfTime()) { paused = true; break; }
      if (outOfQuota()) {
        msgSheet.getRange(row, M.status).setValue('Pausado: límite diario de Gmail. Continúa solo mañana.');
        msgSheet.getRange(row, M.count).setValue(sent);
        return;
      }
      if (deliver_(subsSheet, i + 1, sub.email, id, m)) sent++;
    }
    msgSheet.getRange(row, M.count).setValue(sent);
    msgSheet.getRange(row, M.status).setValue(paused || sent < total ? 'Enviando… (' + sent + ' de ' + total + ')' : 'Completado ✓ ' + Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'dd/MM/yyyy HH:mm'));
    if (paused) return;
  }
}

/** Envía un correo a una fila si aún no lo recibió. Devuelve true si se envió. */
function deliver_(sheet, row, expectedEmail, key, content) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const vals = sheet.getRange(row, 1, 1, SUB_HEADERS.length).getValues()[0];
    const sub = rowToSub_(vals);
    if (sub.email !== expectedEmail || sub.status !== ACTIVE || hasKey_(sub.sent, key)) return false;
    sendMail_(sub, content);
    sheet.getRange(row, S.sent).setValue(sub.sent ? sub.sent + ', ' + key : key);
    SpreadsheetApp.flush();
    return true;
  } catch (err) {
    console.error('No se pudo enviar ' + key + ' a ' + expectedEmail + ': ' + err);
    return false;
  } finally {
    lock.releaseLock();
  }
}

// =====================================================================
// Instalación
// =====================================================================

/** Crea la hoja (si no existe), las pestañas y el activador. Se puede ejecutar varias veces. */
function setup() {
  const props = PropertiesService.getScriptProperties();
  let ss = null;
  const id = props.getProperty('SPREADSHEET_ID');
  if (id) { try { ss = SpreadsheetApp.openById(id); } catch (_) { ss = null; } }
  if (!ss) {
    ss = SpreadsheetApp.create(CONFIG.SPREADSHEET_NAME);
    props.setProperty('SPREADSHEET_ID', ss.getId());
  }

  const subs = ensureSheet_(ss, SUBS, SUB_HEADERS, [220, 140, 160, 90, 140, 140, 140, 260, 120]);
  subs.hideColumns(S.token);

  const seq = ensureSheet_(ss, SEQ, SEQ_HEADERS, [140, 50, 300, 260, 480, 170, 260, 70]);
  if (seq.getLastRow() < 2) {
    const rows = DEFAULT_SEQUENCE.map(function (s) { return [s.id, s.day, s.subject, s.preheader, s.body.trim(), s.ctaText || '', s.ctaUrl || '', true]; });
    seq.getRange(2, 1, rows.length, SEQ_HEADERS.length).setValues(rows);
  }
  seq.getRange(2, 8, 200, 1).insertCheckboxes();
  seq.getRange(2, 1, 200, SEQ_HEADERS.length).setVerticalAlignment('top').setWrap(true);

  const msg = ensureSheet_(ss, MSG, MSG_HEADERS, [260, 220, 420, 150, 240, 200, 120, 220, 80, 100, 140]);
  msg.getRange(2, M.go, 500, 1).insertCheckboxes();
  msg.getRange(2, 1, 500, MSG_HEADERS.length).setVerticalAlignment('top').setWrap(true);
  msg.getRange(1, M.status, 1, 5).setBackground('#e8eaed');

  const help = ss.getSheetByName(HELP) || ss.insertSheet(HELP, 0);
  help.clear();
  help.getRange(1, 1, HELP_TEXT.length, 1).setValues(HELP_TEXT.map(function (t) { return [t]; }));
  help.setColumnWidth(1, 820);
  help.getRange(1, 1).setFontSize(16).setFontWeight('bold');
  help.getRange(1, 1, HELP_TEXT.length, 1).setWrap(true).setVerticalAlignment('top');

  ss.getSheets().forEach(function (sh) {
    if ([SUBS, SEQ, MSG, HELP].indexOf(sh.getName()) === -1 && sh.getLastRow() === 0 && ss.getSheets().length > 1) ss.deleteSheet(sh);
  });

  const has = ScriptApp.getProjectTriggers().some(function (t) { return t.getHandlerFunction() === 'tick'; });
  if (!has) ScriptApp.newTrigger('tick').timeBased().everyMinutes(5).create();
  return ss.getUrl();
}

function ensureSheet_(ss, name, headers, widths) {
  let sh = ss.getSheetByName(name);
  if (!sh) sh = ss.insertSheet(name);
  sh.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold').setBackground('#0a2560').setFontColor('#ffffff');
  sh.setFrozenRows(1);
  widths.forEach(function (w, i) { sh.setColumnWidth(i + 1, w); });
  return sh;
}

// =====================================================================
// Ayudantes
// =====================================================================

let ss_ = null;
function sheet_(name) {
  if (!ss_) {
    const id = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID');
    if (!id) setup();
    ss_ = SpreadsheetApp.openById(PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID'));
  }
  return ss_.getSheetByName(name) || (setup(), ss_.getSheetByName(name));
}

function findRow_(sheet, col, value, matchCase) {
  if (sheet.getLastRow() < 2) return 0;
  const cell = sheet.getRange(2, col, sheet.getLastRow() - 1, 1)
    .createTextFinder(value).matchEntireCell(true).matchCase(!!matchCase).findNext();
  return cell ? cell.getRow() : 0;
}

function rowToSub_(v) {
  return {
    email: String(v[S.email - 1] || '').trim().toLowerCase(),
    name: String(v[S.name - 1] || ''),
    status: String(v[S.status - 1] || ''),
    confirmed: v[S.confirmed - 1],
    sent: String(v[S.sent - 1] || ''),
    token: String(v[S.token - 1] || ''),
  };
}

function msgRow_(v) {
  return {
    subject: String(v[M.subject - 1] || '').trim(),
    preheader: String(v[M.preheader - 1] || '').trim(),
    body: String(v[M.body - 1] || '').trim(),
    ctaText: String(v[M.ctaText - 1] || '').trim(),
    ctaUrl: String(v[M.ctaUrl - 1] || '').trim(),
    go: v[M.go - 1] === true,
    status: String(v[M.status - 1] || ''),
    id: String(v[M.id - 1] || ''),
    started: v[M.started - 1],
  };
}

function steps_() {
  const v = sheet_(SEQ).getDataRange().getValues();
  const out = [];
  for (let r = 1; r < v.length; r++) {
    const id = String(v[r][0] || '').trim();
    if (!id || v[r][7] !== true || !String(v[r][4] || '').trim()) continue;
    out.push({ id: id, day: Number(v[r][1]) || 0, subject: String(v[r][2]), preheader: String(v[r][3] || ''), body: String(v[r][4]), ctaText: String(v[r][5] || ''), ctaUrl: String(v[r][6] || '') });
  }
  return out;
}

function hasKey_(list, key) {
  return String(list || '').split(/\s*,\s*/).indexOf(key) !== -1;
}

function clean_(s, max) {
  s = String(s || '').replace(/\s+/g, ' ').trim().slice(0, max);
  return /^[=+\-@]/.test(s) ? "'" + s : s; // evita fórmulas en la hoja
}

// =====================================================================
// Correo
// =====================================================================

function sendMail_(sub, c) {
  const fill = function (s) {
    const first = String(sub.name || '').replace(/^'/, '').trim().split(/\s+/)[0];
    return String(s || '')
      .replace(/\{\{\s*nombre\s*\}\}/gi, first || 'amigo(a)')
      .replace(/\{\{\s*YOUTUBE_URL\s*\}\}/g, CONFIG.YOUTUBE_URL)
      .replace(/\{\{\s*SITE_URL\s*\}\}/g, CONFIG.SITE_URL);
  };
  const unsubscribeUrl = !c.transactional && sub.token ? CONFIG.SITE_URL + '/baja.html?t=' + sub.token : '';
  const r = renderEmail_({
    body: fill(c.body),
    preheader: fill(c.preheader),
    ctaText: c.ctaText,
    ctaUrl: fill(c.ctaUrl),
    unsubscribeUrl: unsubscribeUrl,
    footerNote: c.transactional ? 'Si no pediste esta suscripción, ignora este correo.' : '',
  });
  MailApp.sendEmail({ to: sub.email, subject: fill(c.subject), htmlBody: r.html, body: r.text, name: CONFIG.FROM_NAME });
}

function esc_(s) {
  return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; });
}

function inline_(s) {
  return esc_(s)
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" style="color:#1f5fd6;text-decoration:underline">$1</a>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>');
}

function blocksToHtml_(text) {
  const P = "margin:0 0 16px;font:17px/1.65 Georgia,'Times New Roman',serif;color:#1d2433";
  return String(text).trim().split(/\n\s*\n/).map(function (block) {
    const lines = block.split('\n');
    if (lines.every(function (l) { return l.indexOf('> ') === 0; })) {
      return '<blockquote style="margin:0 0 18px;padding:12px 18px;border-left:3px solid #d8b25c;background:#f5f8ff;font:italic 17px/1.6 Georgia,serif;color:#24304a">' +
        lines.map(function (l) { return inline_(l.slice(2)); }).join('<br>') + '</blockquote>';
    }
    if (lines.every(function (l) { return l.indexOf('- ') === 0; })) {
      return '<ul style="' + P + ';padding-left:22px">' + lines.map(function (l) { return '<li style="margin:0 0 6px">' + inline_(l.slice(2)) + '</li>'; }).join('') + '</ul>';
    }
    return '<p style="' + P + '">' + lines.map(inline_).join('<br>') + '</p>';
  }).join('\n');
}

function renderEmail_(o) {
  const site = CONFIG.SITE_URL;
  const cta = o.ctaText && o.ctaUrl
    ? '<table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 22px"><tr><td style="border-radius:10px;background:#1f5fd6">' +
      '<a href="' + esc_(o.ctaUrl) + '" style="display:inline-block;padding:14px 26px;font:bold 16px/1 Arial,sans-serif;color:#ffffff;text-decoration:none;border-radius:10px">' + esc_(o.ctaText) + '</a></td></tr></table>'
    : '';
  const unsub = o.unsubscribeUrl ? '<a href="' + esc_(o.unsubscribeUrl) + '" style="color:#7d8db0">Darme de baja</a>' : '';
  const html = '<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>' +
    '<body style="margin:0;padding:0;background:#e9eef7">' +
    '<span style="display:none;max-height:0;overflow:hidden;opacity:0">' + esc_(o.preheader || '') + '</span>' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#e9eef7"><tr><td align="center" style="padding:24px 12px">' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border-radius:14px;overflow:hidden">' +
    '<tr><td align="center" style="background:#061638;background-image:linear-gradient(180deg,#0a2560,#061638);padding:28px 24px 22px">' +
    '<img src="' + site + '/logo.png" width="76" height="76" alt="" style="display:block;border-radius:50%;border:2px solid #b9d6ff;margin:0 auto 12px">' +
    '<div style="font:bold 22px/1.2 Georgia,serif;letter-spacing:1px;color:#ffffff">LA BIBLIA EN SU CONTEXTO</div>' +
    '<div style="font:italic 15px/1.4 Georgia,serif;color:#d8b25c;margin-top:4px">El sentido de la Escritura</div></td></tr>' +
    '<tr><td style="padding:32px 32px 12px">' + blocksToHtml_(o.body) + cta +
    '<p style="margin:8px 0 0;font:17px/1.6 Georgia,serif;color:#1d2433">Bendiciones,<br><strong>' + esc_(CONFIG.SIGNATURE) + '</strong></p></td></tr>' +
    '<tr><td style="padding:22px 32px 28px;border-top:1px solid #e4e9f2;font:13px/1.6 Arial,sans-serif;color:#7d8db0;text-align:center">' +
    (o.footerNote ? esc_(o.footerNote) + '<br>' : '') +
    'Recibes este correo porque te suscribiste en <a href="' + site + '" style="color:#7d8db0">La Biblia en su Contexto</a>.<br>' + unsub +
    '</td></tr></table></td></tr></table></body></html>';

  const text = ['LA BIBLIA EN SU CONTEXTO', '',
    String(o.body).trim().replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '$1 ($2)').replace(/\*\*([^*]+)\*\*/g, '$1').replace(/(^|[^*])\*([^*]+)\*/g, '$1$2'),
    o.ctaText && o.ctaUrl ? '\n' + o.ctaText + ': ' + o.ctaUrl : '',
    '\nBendiciones,\n' + CONFIG.SIGNATURE,
    o.unsubscribeUrl ? '\n—\nDarte de baja: ' + o.unsubscribeUrl : ''].join('\n');
  return { html: html, text: text };
}

// =====================================================================
// Contenido inicial
// =====================================================================

const DEFAULT_SEQUENCE = [
  {
    id: 'bienvenida', day: 0,
    subject: '¡Bienvenido(a)! Aquí están tus 2 regalos',
    preheader: 'Descarga el glosario y la guía de estudio.',
    body: `
Hola {{nombre}},

¡Gracias por confirmar tu suscripción! Me alegra mucho que quieras estudiar las Escrituras con más profundidad. Como te prometimos, aquí están tus **2 regalos de bienvenida**:

- [**Glosario: 10 palabras hebreas y griegas que todo creyente debe conocer**]({{SITE_URL}}/recursos/10_palabras_hebreas_y_griegas.pdf) (PDF, 1 página)
- [**Guía de estudio: El Matrimonio en su Contexto**]({{SITE_URL}}/recursos/Guia_El_Matrimonio_en_su_Contexto.pdf) (PDF, 8 páginas, ideal para estudiar en pareja)

En este boletín recibirás:

- **Estudios en contexto:** el trasfondo histórico y cultural que ilumina cada pasaje.
- **Palabras clave** del hebreo y el griego explicadas de forma sencilla.
- **Nuevos episodios y curiosidades bíblicas** en cuanto se publiquen.

Nuestro lema sale de las palabras de Jesús:

> "Escudriñad las Escrituras; porque a vosotros os parece que en ellas tenéis la vida eterna; y ellas son las que dan testimonio de mí." (Juan 5:39)

Un buen lugar para empezar es el canal, donde están todos los episodios.`,
    ctaText: 'Ver el canal en YouTube', ctaUrl: '{{YOUTUBE_URL}}',
  },
  {
    id: 'padre-que-corrio', day: 3,
    subject: 'El detalle que casi todos pasan por alto en Lucas 15',
    preheader: 'Por qué la carrera del padre habría escandalizado a sus vecinos.',
    body: `
Hola {{nombre}},

Todos conocemos la parábola del hijo pródigo. Pero hay un detalle que los primeros oyentes de Jesús no habrían pasado por alto:

> "Y cuando aún estaba lejos, lo vio su padre, y fue movido a misericordia, y corrió, y se echó sobre su cuello, y le besó." (Lucas 15:20)

En aquella cultura, un hombre mayor y respetado **no corría en público**. Para hacerlo tenía que recoger su túnica larga y exponerse a la burla. Era algo considerado indigno.

Sin embargo, el padre corre. Absorbe la vergüenza antes de que su hijo tenga que enfrentarla en el pueblo.

Ese es el corazón de la parábola: un Dios que no espera de brazos cruzados, sino que **sale corriendo al encuentro** de quien regresa.

Esto es lo que buscamos en cada estudio: leer el texto como lo escucharon sus primeros oyentes.`,
    ctaText: 'Ver más estudios', ctaUrl: '{{YOUTUBE_URL}}',
  },
  {
    id: 'tu-pregunta', day: 7,
    subject: '{{nombre}}, ¿qué pasaje te gustaría entender mejor?',
    preheader: 'Responde este correo con tu pregunta.',
    body: `
Hola {{nombre}},

Ya llevas una semana en el boletín y quiero hacerte una pregunta sencilla:

**¿Qué pasaje, personaje o tema bíblico te gustaría ver explicado en su contexto?**

Puede ser un versículo difícil, una costumbre que no entiendes o una palabra que te intriga. **Solo responde a este correo**: leo cada mensaje, y muchas de estas preguntas se convierten en futuros episodios.

Gracias por ser parte de esta comunidad que ama la Palabra.`,
  },
];

// Texto original del correo de bienvenida (versión 1), para saber si el dueño lo editó.
const LEGACY_WELCOME_BODY = `Hola {{nombre}},

¡Gracias por confirmar tu suscripción! Me alegra mucho que quieras estudiar las Escrituras con más profundidad.

En este boletín recibirás:

- **Estudios en contexto:** el trasfondo histórico y cultural que ilumina cada pasaje.
- **Palabras clave** del hebreo y el griego explicadas de forma sencilla.
- **Nuevos episodios y curiosidades bíblicas** en cuanto se publiquen.

Nuestro lema sale de las palabras de Jesús:

> "Escudriñad las Escrituras; porque a vosotros os parece que en ellas tenéis la vida eterna; y ellas son las que dan testimonio de mí." (Juan 5:39)

Un buen lugar para empezar es el canal, donde están todos los episodios.`;

const HELP_TEXT = [
  'Cómo usar el boletín',
  'Todo funciona solo. Esta hoja es tu panel: aquí ves a tus suscriptores y escribes los correos.',
  '',
  '📋 SUSCRIPTORES — Cada persona que se suscribe aparece aquí. "Pendiente" = aún no confirmó su correo. "Activo" = recibe los correos. "Baja" = se dio de baja. La columna "Correos enviados" muestra qué correos ya recibió.',
  '',
  '👋 BIENVENIDA — Serie automática. Cada fila se envía X días ("Día") después de que la persona confirma. Puedes cambiar el texto, añadir filas o desmarcar "Activo" para pausar un correo. No cambies el "ID" de un correo que ya se envió.',
  '',
  '✉️ MENSAJES — Para escribir a todos tus suscriptores:',
  '   1. Escribe el Asunto y el Mensaje en una fila nueva (Texto del botón y Enlace son opcionales).',
  '   2. Para verlo antes, pon tu correo en "Enviar prueba a".',
  '   3. Cuando esté listo, marca "¿Enviar a todos?". En unos 5 minutos empieza el envío y la columna "Estado" muestra el progreso.',
  '',
  '✍️ FORMATO del texto: línea en blanco = nuevo párrafo · **negrita** · *cursiva* · [texto](https://enlace) · empieza una línea con "> " para una cita · con "- " para una lista · {{nombre}} = nombre del suscriptor · {{YOUTUBE_URL}} = enlace del canal.',
  '',
  '⚠️ LÍMITE de Gmail: una cuenta gratuita envía unos 100 correos al día. Si tienes más suscriptores, el envío se pausa y continúa solo al día siguiente.',
];
