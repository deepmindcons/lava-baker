/**
 * Lava.top + PuzzleBot → Google Таблица «Ян Бейкер регистрации».
 *
 * Что делает скрипт:
 *  • по ссылке из бота создаёт счёт в Lava на почту человека (лист «Счета»);
 *  • каждые 5 минут (и сразу после возврата человека с оплаты) проверяет счета в Lava;
 *  • оплаченные записывает на лист «Lava.top»: дата, почта, сумма, валюта, статус, тариф;
 *  • на листе «PuzzleBot» в столбце E «Оплата» ставит «Успешно» / «Нет оплаты»
 *    (по почте, а если почта другая — по тегу Telegram);
 *  • после оплаты сам запускает в PuzzleBot команду выдачи доступа (одна для всех цен).
 *
 * Настройка — только блок ниже. После вставки: меню «Lava» → «1. Включить автопроверку».
 */

// 1. API-ключ Lava (Lava → Интеграции → API → API key).
const LAVA_API_KEY = 'ВСТАВЬТЕ_СЮДА_API_KEY_ИЗ_LAVA';

// 2. Секретное слово для уведомлений (вебхука) Lava: любая длинная случайная строка из латинских букв и цифр.
//    Адрес вебхука в Lava: …/exec?key=ЭТА_СТРОКА. С вебхуком Lava сама сразу сообщает об оплате,
//    без него скрипт находит оплаты проверками по расписанию (медленнее). В GitHub строку не храним.
const SECRET = 'ВСТАВЬТЕ_СЮДА_СЛУЧАЙНУЮ_СТРОКУ';

// 3. Страница оплаты (папка docs, GitHub Pages)
const PAY_PAGE_URL = 'https://deepmindcons.github.io/lava-baker/';
// 4. Ссылка на бота (сюда вернёт кнопка отмены на странице Lava)
const BOT_URL = 'https://t.me/deepmindco_bot';
// 5. Команда бота после оплаты (если PAY_PAGE_URL пустой). Обычно не нужна — оставьте пустой.
const PAID_URL = '';

// 6. Автовыдача доступа: как только оплата найдена, скрипт сам запускает команду в боте этому человеку.
//    Токен: PuzzleBot → Бот → Настройки → Интеграции → Входящие запросы → «Сгенерировать API токен».
//    Не публикуйте токен (в GitHub он не должен попасть). Пока здесь заглушка — автовыдача выключена.
const PUZZLEBOT_TOKEN = 'ВСТАВЬТЕ_СЮДА_API_ТОКЕН_PUZZLEBOT';
//    Точное название команды в PuzzleBot, которая выдаёт доступ (и ставит категорию «доступ получен»).
//    Вписывайте только в Apps Script, в GitHub название команды не храним.
const ACCESS_COMMAND = 'ВСТАВЬТЕ_СЮДА_НАЗВАНИЕ_КОМАНДЫ';

// 7. Тарифы. offer — ID цены в Lava (меню «Lava» → «Показать продукты и цены Lava»),
//    sheet — лист регистраций, command — какую команду бота запустить после оплаты.
//    was — прежние названия (цены) тарифа, если цену поменяете: старые оплаты засчитаются так же.
//    Первый тариф — цена по умолчанию, если в ссылке не указан offer.
const REG_SHEET = 'PuzzleBot';
const TARIFFS = [
  { name: '1750', offer: '7a7b5e0b-f5d3-404b-9692-c15b1eaa244b', sheet: REG_SHEET, command: ACCESS_COMMAND },
  { name: '2750', offer: 'd8a6b75e-2c4d-4cbf-b013-c69dcd4de923', sheet: REG_SHEET, command: ACCESS_COMMAND },
  { name: '3750', offer: 'b39309a1-7ddc-4a6d-a06d-fe398a2d18d5', sheet: REG_SHEET, command: ACCESS_COMMAND },
];
const DEFAULT_OFFER_ID = TARIFFS[0].offer;

// Листы таблицы. Лист регистраций — REG_SHEET:
//   A — имя, B — тег, C — почта, D — доступ (заполняет бот), E — оплата (заполняет скрипт)
const LAVA_SHEET = 'Lava.top';
const PAY_SHEET = 'Счета';
const LOG_SHEET = 'Лог';

const REG_EMAIL_COL = 3;         // C
const REG_PAY_COL = 5;           // E
const REG_PAY_HEADER = 'Оплата';
const PAY_YES = 'Успешно';
const PAY_NO = 'Нет оплаты';
const PAY_OTHER = 'Оплачен другой тариф: ';

const LAVA_HEADER = ['Дата', 'Почта', 'Сумма', 'Валюта', 'Статус', 'Telegram', 'ID оплаты', 'Тариф'];
const PAID = 'Успешно';
const REFUNDED = 'Возврат';
// номера колонок листа «Lava.top»
const L_STATUS = 5, L_TG = 6, L_ID = 7, L_TARIFF = 8;

const PAY_HEADER = ['Создан', 'Telegram ID', 'Почта', 'Оффер', 'Сумма', 'Валюта', 'ID счёта', 'Статус', 'Ссылка на оплату', 'Промокод',
                    'Telegram ID (число)', 'Команда в боте'];
const P_TID = 11, P_SENT = 12;   // номера колонок листа «Счета»

// Как часто перепроверять неоплаченные счета (вебхук сообщает об оплатах сразу, проверки — страховка)
const FRESH_AGE = 60 * 60 * 1000;            // счета младше часа — при каждой проверке (раз в 5 минут)
const OLD_CHECK_EVERY = 3 * 60 * 60 * 1000;  // более старые — раз в 3 часа
const INVOICE_TTL = 3 * 24 * 3600 * 1000;    // через 3 дня неоплаченный счёт считаем истёкшим
const FETCH_BATCH = 20;                      // сколько счетов спрашивать у Lava одновременно
const PRICES_REFRESH_EVERY = 30 * 60 * 1000;  // как часто обновлять цены тарифов из Lava
const LAVA_TRIES = 3;                        // попыток создать счёт, если Lava временно сбоит


/** Тариф по ID цены Lava (или null). */
function tariffByOffer(offerId) {
  offerId = String(offerId || '');
  for (let i = 0; i < TARIFFS.length; i++) if (TARIFFS[i].offer === offerId) return TARIFFS[i];
  return null;
}

/** Тариф по названию из колонки «Тариф» листа «Lava.top» (или null). */
function tariffByName(name) {
  name = String(name || '').trim();
  for (let i = 0; i < TARIFFS.length; i++) if (TARIFFS[i].name === name) return TARIFFS[i];
  for (let i = 0; i < TARIFFS.length; i++) if ((TARIFFS[i].was || []).indexOf(name) >= 0) return TARIFFS[i];
  return null;
}


// ---------------------------------------------------------------- меню

function onOpen() {
  SpreadsheetApp.getUi().createMenu('Lava')
    .addItem('1. Включить автопроверку (один раз)', 'install')
    .addItem('Показать продукты и цены Lava', 'showOffers')
    .addItem('Проверить оплаты сейчас', 'checkNow')
    .addItem('Создать тестовый счёт', 'testInvoice')
    .addItem('Проверить автовыдачу доступа в боте', 'testBotCommand')
    .addToUi();
}

/** Запустить один раз: создаёт листы и включает проверку каждые 5 минут. */
function install() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'tick') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('tick').timeBased().everyMinutes(5).create();
  paySheet();
  lavaSheet();
  tick();
  SpreadsheetApp.getUi().alert('Готово: автопроверка оплат включена (каждые 5 минут).');
}

/** Запускается по расписанию: проверяет счета и обновляет столбец «Оплата». */
function tick(full) {
  let paid = 0;
  // Цены тарифов держим в кэше свежими, чтобы страница оплаты открывалась быстро
  try {
    const props = PropertiesService.getScriptProperties();
    if (Date.now() - (Number(props.getProperty('lastPrices')) || 0) > PRICES_REFRESH_EVERY) {
      refreshPrices();
      props.setProperty('lastPrices', String(Date.now()));
    }
  } catch (err) {
    writeLog(null, 'PAY', { status: 'prices_error', error: String(err.message || err) });
  }
  try {
    // Счета младше часа проверяем каждые 5 минут, старые — раз в 3 часа (или по кнопке в меню)
    const props = PropertiesService.getScriptProperties();
    const lastFull = Number(props.getProperty('lastFullCheck')) || 0;
    if (full !== true) full = Date.now() - lastFull > OLD_CHECK_EVERY;
    if (full) props.setProperty('lastFullCheck', String(Date.now()));
    paid = syncInvoices('', full);
  } finally {
    updatePayColumn();
    deliverAccess();
  }
  return paid;
}

function checkNow() {
  const paid = tick(true);
  SpreadsheetApp.getUi().alert('Проверено. Новых оплат: ' + paid);
}


// ---------------------------------------------------------------- вход: запросы от страницы оплаты, бота и Lava

/** Приём уведомлений (вебхуков) от Lava. */
function doPost(e) {
  let result;
  try {
    result = handle(e);
    if (result.status === 'saved' || result.status === 'refunded') updatePayColumn();
    if (result.status === 'saved') deliverAccess();
  } catch (err) {
    result = { status: 'error', error: String(err) };
  }
  writeLog(e, 'POST', result);
  return reply(result);
}

/**
 * Запросы со страницы оплаты и из бота (…/exec?api=…):
 *   api=prices[&offer=…]                              — цены оффера по валютам
 *   api=invoice&uid=…&email=…[&offer=…&cur=…&promo=…] — создать счёт, вернуть ссылку на оплату
 *   api=check&email=…                                 — проверить оплату этой почты
 *   api=check&email=…&format=text                     — то же для PuzzleBot: ответ одним словом paid / unpaid
 */
function doGet(e) {
  if (e && e.parameter && e.parameter.api) {
    let out;
    try {
      out = api(e.parameter);
    } catch (err) {
      out = { ok: false, error: 'failed', message: String(err.message || err) };
    }
    if (e.parameter.format === 'text') {
      return ContentService.createTextOutput(out.paid ? 'paid' : 'unpaid');
    }
    return reply(out);
  }
  return reply({ status: 'ok', note: 'Скрипт работает.' });
}

function api(p) {
  const offerId = String(p.offer || DEFAULT_OFFER_ID).trim();
  if (p.api !== 'check' && !tariffByOffer(offerId)) {
    return { ok: false, error: 'offer', message: 'Неизвестный тариф. Вернитесь в бот и нажмите кнопку тарифа ещё раз.' };
  }
  if (p.api === 'prices') {
    return { ok: true, prices: offerPrices(offerId), bot: BOT_URL, paidUrl: PAID_URL };
  }
  const email = normEmail(String(p.email || '').replace(/ /g, '+'));
  const validEmail = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) && email.indexOf('{{') < 0;
  if (p.api === 'check') {
    if (!validEmail) return { ok: false, error: 'email', bot: BOT_URL, paidUrl: PAID_URL };
    const found = syncInvoices(email);
    if (found) { updatePayColumn(); deliverAccess(); }
    // &offer=… — проверить оплату только этого тарифа; без offer — любого
    const only = p.offer ? tariffByOffer(String(p.offer).trim()) : null;
    if (p.offer && !only) return { ok: false, error: 'offer', bot: BOT_URL, paidUrl: PAID_URL };
    return { ok: true, paid: hasPaidInvoice(email, only), bot: BOT_URL, paidUrl: PAID_URL };
  }
  if (p.api === 'invoice') {
    const uid = String(p.uid || '').trim();
    // Числовой Telegram ID из бота — по нему скрипт после оплаты запускает команду выдачи доступа
    const tid = /^\d{3,15}$/.test(String(p.tid || '').trim()) ? String(p.tid).trim() : '';
    const currency = String(p.cur || 'RUB').trim().toUpperCase();
    const promo = String(p.promo || '').trim().toUpperCase();
    if (!validEmail) return { ok: false, error: 'email', message: 'Не удалось определить вашу почту. Вернитесь в бот и введите почту ещё раз.' };
    if (promo && !/^[A-Z0-9_-]{3,36}$/.test(promo)) {
      return { ok: false, error: 'promo', message: 'Промокод может состоять только из латинских букв, цифр, «-» и «_».' };
    }
    const tariffName = (tariffByOffer(offerId) || {}).name || offerId;
    // Защита от повторной оплаты: если этот человек уже оплатил тариф с тем же доступом — второй счёт не создаём
    if (alreadyPaid(email, tid, tariffByOffer(offerId))) {
      writeLog(null, 'PAY', { status: 'already_paid', tariff: tariffName, email: email, uid: uid });
      return { ok: false, error: 'paid', message: PAID_MESSAGE };
    }
    try {
      const inv = getOrCreateInvoice(email, uid, offerId, currency, promo, tid);
      writeLog(null, 'PAY', { status: 'redirect', tariff: tariffName, email: email, uid: uid, promo: promo, invoice: inv.id });
      return { ok: true, paymentUrl: inv.paymentUrl };
    } catch (err) {
      const msg = String(err.message || err);
      writeLog(null, 'PAY', { status: 'error', tariff: tariffName, email: email, uid: uid, promo: promo, error: msg });
      if (promo && / 400: /.test(msg)) {
        return { ok: false, error: 'promo', message: 'Промокод не подошёл. Проверьте его или оплатите без промокода.' };
      }
      if (err.alreadyPaid) return { ok: false, error: 'paid', message: PAID_MESSAGE };
      if (err.lavaDown) {
        return { ok: false, error: 'unavailable', message: 'Платёжная система временно недоступна. Попробуйте ещё раз через несколько минут.' };
      }
      return { ok: false, error: 'failed', message: 'Не получилось создать оплату. Попробуйте ещё раз.' };
    }
  }
  return { ok: false, error: 'unknown' };
}

const PAID_MESSAGE = 'Вы уже оплатили этот тариф. Доступ отправлен вам в бот и на почту — повторно платить не нужно.';

/** Оплатил ли человек (по почте или числовому Telegram ID) тариф с той же командой доступа. */
function alreadyPaid(email, tid, tariff) {
  if (!tariff) return false;
  const same = function (t) { return t && t.command === tariff.command; };
  const lava = lavaSheet();
  if (lava.getLastRow() > 1) {
    const hit = lava.getRange(2, 1, lava.getLastRow() - 1, LAVA_HEADER.length).getValues().some(function (r) {
      // оплата без тарифа записана прошлой версией скрипта — это тоже оплата этой встречи
      const name = String(r[L_TARIFF - 1] || '').trim();
      return r[L_STATUS - 1] === PAID && normEmail(r[1]) === email && (!name || same(tariffByName(name)));
    });
    if (hit) return true;
  }
  if (!tid) return false;
  const pay = paySheet();
  if (pay.getLastRow() < 2) return false;
  return pay.getRange(2, 1, pay.getLastRow() - 1, PAY_HEADER.length).getValues().some(function (r) {
    return r[7] === 'оплачен' && String(r[P_TID - 1] || '').replace(/^'/, '') === tid && same(tariffByOffer(r[3]));
  });
}

function hasPaidInvoice(email, tariff) {
  const lava = lavaSheet();
  const last = lava.getLastRow();
  if (last < 2) return false;
  return lava.getRange(2, 1, last - 1, LAVA_HEADER.length).getValues()
    .some(function (r) {
      return normEmail(r[1]) === email && r[L_STATUS - 1] === PAID &&
             (!tariff || tariffByName(r[L_TARIFF - 1]) === tariff);
    });
}


// ---------------------------------------------------------------- счета

/** Куда Lava вернёт покупателя после оплаты / ошибки / отмены. */
function returnUrls(email, uid, offerId, tid) {
  // tid обязательно передаём дальше: если оплата не прошла и человек повторяет её со страницы возврата,
  // новый счёт должен знать его Telegram ID, иначе после оплаты некому отправить доступ
  const q = 'email=' + encodeURIComponent(email) + '&uid=' + encodeURIComponent(uid) +
            '&offer=' + encodeURIComponent(offerId) + (tid ? '&tid=' + encodeURIComponent(tid) : '');
  const urls = {};
  if (PAY_PAGE_URL) {
    const base = PAY_PAGE_URL.replace(/[?#].*$/, '');
    urls.successful_return_url = base + '?done=1&' + q;
    urls.failure_return_url = base + '?failed=1&' + q;
  } else if (PAID_URL || BOT_URL) {
    urls.successful_return_url = PAID_URL || BOT_URL;
  }
  if (BOT_URL) urls.cancel_return_url = BOT_URL;
  return urls;
}

/** Счёт для человека: повторно использует неоплаченный счёт за последние 12 часов. */
function getOrCreateInvoice(email, uid, offerId, currency, promo, tid) {
  promo = promo || '';
  tid = tid || '';
  if (!offerId || offerId.indexOf('ВСТАВЬТЕ') === 0) {
    throw new Error('Не указан ID цены тарифа в TARIFFS вверху скрипта.');
  }
  const sheet = paySheet();
  const lock = LockService.getScriptLock();

  // 1. Есть ли у человека свежий неоплаченный счёт с теми же параметрами — тогда отдаём его
  let reuse = null;
  lock.waitLock(25000);
  try {
    const last = sheet.getLastRow();
    if (last > 1) {
      const rows = sheet.getRange(2, 1, last - 1, PAY_HEADER.length).getValues();
      for (let i = rows.length - 1; i >= 0; i--) {
        const r = rows[i];
        const fresh = (Date.now() - new Date(r[0]).getTime()) < 12 * 3600 * 1000;
        if (fresh && r[2] === email && String(r[1]) === uid && r[3] === offerId && r[5] === currency &&
            r[7] === 'ожидает оплаты' && r[8] && String(r[9] || '') === promo) {
          if (tid && !r[P_TID - 1]) sheet.getRange(i + 2, P_TID).setValue("'" + tid);
          reuse = { row: i + 2, id: r[6], paymentUrl: r[8] };
          break;
        }
      }
    }
  } finally {
    lock.releaseLock();
  }
  if (reuse) {
    // Старый счёт отдаём, только если по нему ещё можно платить: после отказа банка Lava его закрывает,
    // и человек снова попадал бы на неработающую оплату
    let status = '';
    try { status = String(lavaGet('https://gate.lava.top/api/v1/invoices/' + encodeURIComponent(reuse.id)).status || '').toUpperCase(); }
    catch (err) { status = ''; }   // Lava не ответила — отдаём старый счёт, как раньше
    if (status === 'COMPLETED' || status === 'SUBSCRIPTION-ACTIVE' || status === 'SUBSCRIPTION_ACTIVE') {
      const e = new Error('счёт ' + reuse.id + ' уже оплачен');
      e.alreadyPaid = true;
      throw e;
    }
    if (!status || status === 'NEW' || status === 'IN-PROGRESS' || status === 'IN_PROGRESS') {
      return { id: reuse.id, paymentUrl: reuse.paymentUrl };
    }
    sheet.getRange(reuse.row, 8).setValue('не оплачен');   // FAILED / CANCELLED и т. п. — создаём новый счёт
  }

  // 2. Создаём счёт в Lava — без блокировки, чтобы люди не ждали друг друга.
  //    Если Lava временно сбоит (ошибка 5xx или нет связи), повторяем запрос ещё 2 раза с паузой.
  const request = {
    method: 'post',
    contentType: 'application/json',
    headers: { 'X-Api-Key': LAVA_API_KEY, Accept: 'application/json' },
    payload: JSON.stringify(Object.assign({
      email: email,
      offerId: offerId,
      currency: currency,
      buyerLanguage: 'RU',
      clientUtm: { utm_source: 'puzzlebot', utm_content: uid },
    }, promo ? { promoCode: promo } : {}, returnUrls(email, uid, offerId, tid))),
    muteHttpExceptions: true,
  };
  let code = 0, text = '';
  for (let attempt = 1; attempt <= LAVA_TRIES; attempt++) {
    try {
      const res = UrlFetchApp.fetch('https://gate.lava.top/api/v3/invoice', request);
      code = res.getResponseCode();
      text = res.getContentText();
    } catch (err) {
      code = 0;
      text = 'нет связи с Lava: ' + String(err.message || err);
    }
    if (code !== 0 && code < 500) break;
    if (attempt < LAVA_TRIES) Utilities.sleep(2000 * attempt);
  }
  if (code !== 200 && code !== 201) {
    const e = new Error('Lava ответила кодом ' + code + ': ' + text.slice(0, 300) +
                        (code === 0 || code >= 500 ? ' (после ' + LAVA_TRIES + ' попыток)' : ''));
    e.lavaDown = code === 0 || code >= 500;
    throw e;
  }
  const data = JSON.parse(text);
  if (!data.paymentUrl) throw new Error('Lava не вернула ссылку на оплату: ' + text.slice(0, 300));
  const money = data.amountTotal || {};

  // 3. Записываем счёт в таблицу (короткая блокировка только на запись)
  lock.waitLock(25000);
  try {
    sheet.appendRow([new Date(), uid, email, offerId, Number(money.amount) || '', String(money.currency || currency),
                     data.id, 'ожидает оплаты', data.paymentUrl, promo, tid ? "'" + tid : '', '']);
  } finally {
    lock.releaseLock();
  }
  return { id: data.id, paymentUrl: data.paymentUrl };
}

/**
 * Проверить в Lava статус неоплаченных счетов из листа «Счета» и записать оплаченные на лист «Lava.top».
 *   onlyEmail — проверить только счета этой почты (любого возраста);
 *   full      — проверить и старые счета (старше часа), иначе только свежие.
 * Счета спрашиваем у Lava пачками по FETCH_BATCH одновременно. Возвращает число новых оплат.
 */
function syncInvoices(onlyEmail, full) {
  if (typeof onlyEmail !== 'string') onlyEmail = '';
  const sheet = paySheet();
  const last = sheet.getLastRow();
  if (last < 2) return 0;
  const rows = sheet.getRange(2, 1, last - 1, PAY_HEADER.length).getValues();
  const paid = [];
  const errors = [];
  const todo = [];
  rows.forEach(function (r, i) {
    if (r[7] !== 'ожидает оплаты' || !r[6]) return;
    if (onlyEmail && r[2] !== onlyEmail) return;
    const age = Date.now() - new Date(r[0]).getTime();
    if (age > INVOICE_TTL) {
      sheet.getRange(i + 2, 8).setValue('не оплачен (истёк)');
      return;
    }
    if (!onlyEmail && !full && age > FRESH_AGE) return;
    todo.push({ row: i + 2, r: r });
  });

  for (let b = 0; b < todo.length; b += FETCH_BATCH) {
    const batch = todo.slice(b, b + FETCH_BATCH);
    let responses;
    try {
      responses = UrlFetchApp.fetchAll(batch.map(function (x) {
        return {
          url: 'https://gate.lava.top/api/v1/invoices/' + encodeURIComponent(x.r[6]),
          headers: { 'X-Api-Key': LAVA_API_KEY, Accept: 'application/json' },
          muteHttpExceptions: true,
        };
      }));
    } catch (err) {
      errors.push('пачка счетов: ' + String(err.message || err).slice(0, 200));
      continue;
    }
    batch.forEach(function (x, k) {
      const res = responses[k];
      const code = res.getResponseCode();
      if (code !== 200) {
        errors.push(x.r[6] + ': Lava ответила кодом ' + code + ': ' + res.getContentText().slice(0, 150));
        return;
      }
      let inv;
      try { inv = JSON.parse(res.getContentText()); } catch (e) { errors.push(x.r[6] + ': не JSON'); return; }
      const status = String(inv.status || '').toUpperCase();
      if (status === 'COMPLETED' || status === 'SUBSCRIPTION-ACTIVE' || status === 'SUBSCRIPTION_ACTIVE') {
        paid.push({ row: x.row, r: x.r, inv: inv });
      } else if (status === 'FAILED') {
        sheet.getRange(x.row, 8).setValue('не оплачен');
      }
    });
  }

  if (paid.length) {
    const lock = LockService.getScriptLock();
    lock.waitLock(25000);
    try {
      const lava = lavaSheet();
      paid.forEach(function (x) {
        const r = x.r;
        const ids = lava.getLastRow() > 1
          ? lava.getRange(2, L_ID, lava.getLastRow() - 1, 1).getValues().map(function (v) { return String(v[0]); })
          : [];
        const at = ids.indexOf(String(r[6]));
        if (at < 0) {
          const t = tariffByOffer(r[3]);
          lava.appendRow([
            x.inv.datetime ? new Date(x.inv.datetime) : new Date(), r[2],
            r[4], String(r[5]).toUpperCase(), PAID, r[1], r[6], t ? t.name : '',
          ]);
        } else {
          // Оплату уже записал вебхук — допишем Telegram и тариф
          if (!lava.getRange(at + 2, L_TG).getValue()) lava.getRange(at + 2, L_TG).setValue(r[1]);
          const t = tariffByOffer(r[3]);
          if (t && !lava.getRange(at + 2, L_TARIFF).getValue()) lava.getRange(at + 2, L_TARIFF).setValue(t.name);
        }
        sheet.getRange(x.row, 8).setValue('оплачен');
      });
    } finally {
      lock.releaseLock();
    }
  }
  if (paid.length || errors.length) {
    writeLog(null, 'INVOICES', { status: 'checked', paid: paid.length, errors: errors });
  }
  return paid.length;
}


// ---------------------------------------------------------------- автовыдача доступа через PuzzleBot

/**
 * Для каждого оплаченного счёта с числовым Telegram ID, по которому ещё не запускали выдачу,
 * вызывает в PuzzleBot команду его тарифа (TARIFFS → command) этому человеку (метод API sendCommand).
 * Результат пишется в колонку «Команда в боте» листа «Счета». При ошибке — до 3 попыток
 * (раз в 5 минут). Если что-то не сработает, остаются проверки по таймерам в самом боте.
 */
function deliverAccess() {
  if (PUZZLEBOT_TOKEN.indexOf('ВСТАВЬТЕ') === 0) return 0;
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) return 0;
  let sent = 0;
  try {
    const sheet = paySheet();
    const last = sheet.getLastRow();
    if (last < 2) return 0;
    const rows = sheet.getRange(2, 1, last - 1, PAY_HEADER.length).getValues();
    // одному человеку — одна команда каждого вида, даже если оплаченных счетов несколько
    const done = {};
    const key = function (tid, cmd) { return tid + '|' + cmd; };
    rows.forEach(function (r) {
      const t = tariffByOffer(r[3]);
      const tid = String(r[P_TID - 1] || '').replace(/^'/, '');
      if (t && String(r[P_SENT - 1]).indexOf('отправлено') === 0) done[key(tid, t.command)] = true;
    });
    // Если у оплаченного счёта нет Telegram ID — берём его из других счетов этого же человека (по почте или тегу)
    const tidByEmail = {}, tidByUid = {};
    rows.forEach(function (r) {
      const tid = String(r[P_TID - 1] || '').replace(/^'/, '');
      if (!/^\d+$/.test(tid)) return;
      if (r[2]) tidByEmail[normEmail(r[2])] = tid;
      const u = normTag(r[1]);
      if (u) tidByUid[u] = tid;
    });
    rows.forEach(function (r, i) {
      let tid = String(r[P_TID - 1] || '').replace(/^'/, '');
      if (!/^\d+$/.test(tid) && r[7] === 'оплачен') {
        tid = tidByEmail[normEmail(r[2])] || tidByUid[normTag(r[1])] || '';
        if (tid) sheet.getRange(i + 2, P_TID).setValue("'" + tid);
      }
      const mark = String(r[P_SENT - 1] || '');
      if (r[7] !== 'оплачен' || !/^\d+$/.test(tid) || mark.indexOf('отправлено') === 0) return;
      const tries = (mark.match(/^ошибка (\d)/) || [])[1] | 0;
      if (tries >= 3) return;
      const t = tariffByOffer(r[3]);
      if (!t) {
        if (!mark) sheet.getRange(i + 2, P_SENT).setValue('ошибка 3/3: неизвестный тариф');
        return;
      }
      if (t.command.indexOf('ВСТАВЬТЕ') === 0) return;   // команда этого тарифа ещё не вписана
      if (done[key(tid, t.command)]) {
        sheet.getRange(i + 2, P_SENT).setValue('отправлено ранее');
        return;
      }
      const res = puzzleSendCommand(tid, t.command);
      if (res.ok) {
        sheet.getRange(i + 2, P_SENT).setValue('отправлено ' +
          Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'dd.MM HH:mm') + ' — ' + t.command);
        done[key(tid, t.command)] = true;
        sent++;
      } else {
        sheet.getRange(i + 2, P_SENT).setValue('ошибка ' + (tries + 1) + '/3: ' + res.error);
      }
    });
  } finally {
    lock.releaseLock();
  }
  if (sent) writeLog(null, 'BOT', { status: 'access_sent', count: sent });
  return sent;
}

function puzzleSendCommand(tid, command) {
  const url = 'https://api.puzzlebot.top/?token=' + encodeURIComponent(PUZZLEBOT_TOKEN) +
    '&method=sendCommand&command_name=' + encodeURIComponent(command) +
    '&platform_chat_id=' + encodeURIComponent(tid) + '&platform=tg';
  try {
    const res = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
    const text = res.getContentText();
    let data = {};
    try { data = JSON.parse(text); } catch (e) { /* не JSON */ }
    if (res.getResponseCode() === 200 && Number(data.code) === 0) return { ok: true };
    return { ok: false, error: String(data.description || text).slice(0, 150) };
  } catch (err) {
    return { ok: false, error: String(err.message || err).slice(0, 150) };
  }
}

/** Меню: проверить связь с PuzzleBot — отправить команду выдачи доступа на ваш Telegram ID. */
function testBotCommand() {
  const ui = SpreadsheetApp.getUi();
  const ans = ui.prompt('Проверка автовыдачи', 'Ваш числовой Telegram ID (команда «' + ACCESS_COMMAND + '» придёт вам в бот):',
    ui.ButtonSet.OK_CANCEL);
  if (ans.getSelectedButton() !== ui.Button.OK) return;
  const tid = ans.getResponseText().trim();
  if (!/^\d+$/.test(tid)) { ui.alert('Нужен числовой ID, только цифры.'); return; }
  const res = puzzleSendCommand(tid, ACCESS_COMMAND);
  ui.alert(res.ok ? 'Готово: команда отправлена, проверьте бота.' : 'Не получилось: ' + res.error);
}


// ---------------------------------------------------------------- столбец «Оплата» на листе регистраций

/**
 * На листе «PuzzleBot» напротив регистрации ставит «Успешно» (оплачена любая цена) или «Нет оплаты».
 * Оплата без тарифа (пришла не через бота или записана прошлой версией скрипта) тоже засчитывается.
 * Если когда-нибудь у тарифов будут разные листы — на чужом листе будет «Оплачен другой тариф: …».
 */
function updatePayColumn() {
  const ss = SpreadsheetApp.getActive();
  // кто что оплатил: email/тег → { '1750': true, ..., '?': true }
  const byEmail = {};
  const byTag = {};
  const add = function (map, k, name) { if (k) (map[k] = map[k] || {})[name || '?'] = true; };
  const lava = lavaSheet();
  if (lava.getLastRow() > 1) {
    lava.getRange(2, 1, lava.getLastRow() - 1, LAVA_HEADER.length).getValues().forEach(function (r) {
      if (r[L_STATUS - 1] !== PAID) return;
      const name = String(r[L_TARIFF - 1] || '').trim();
      add(byEmail, normEmail(r[1]), name);
      add(byTag, normTag(r[L_TG - 1]), name);
    });
  }

  const sheetNames = [];
  TARIFFS.forEach(function (t) { if (sheetNames.indexOf(t.sheet) < 0) sheetNames.push(t.sheet); });
  sheetNames.forEach(function (sheetName) {
    const reg = ss.getSheetByName(sheetName);
    if (!reg) return;
    if (reg.getRange(1, REG_PAY_COL).getValue() !== REG_PAY_HEADER) {
      reg.getRange(1, REG_PAY_COL).setValue(REG_PAY_HEADER).setFontWeight('bold');
    }
    const last = reg.getLastRow();
    if (last < 2) return;
    const rows = reg.getRange(2, 1, last - 1, REG_PAY_COL).getValues();
    const out = [];
    let changed = false;
    rows.forEach(function (r) {
      const email = normEmail(r[REG_EMAIL_COL - 1]);
      const tag = normTag(r[1]);
      let v = '';
      if (email || tag) {
        const paid = Object.assign({}, (email && byEmail[email]) || {}, (tag && byTag[tag]) || {});
        const names = Object.keys(paid);
        const here = names.some(function (n) {
          if (n === '?') return true;
          const t = tariffByName(n);
          return t && t.sheet === sheetName;
        });
        const others = names.filter(function (n) {
          const t = tariffByName(n);
          return t && t.sheet !== sheetName;
        });
        if (here) v = PAY_YES;
        else if (others.length) v = PAY_OTHER + others.join(', ');
        else v = PAY_NO;
      }
      if (v !== r[REG_PAY_COL - 1]) changed = true;
      out.push([v]);
    });
    if (changed) reg.getRange(2, REG_PAY_COL, out.length, 1).setValues(out);
  });
}

/** Тег Telegram в одном виде: без @, без HTML-ссылки, строчными. «test» не считаем тегом. */
function normTag(v) {
  const t = String(v || '').replace(/<[^>]*>/g, '').replace(/^@/, '').trim().toLowerCase();
  return t && t !== 'test' ? t : '';
}


// ---------------------------------------------------------------- уведомления (вебхук) Lava — необязательно

function handle(e) {
  if (!e || !e.parameter || e.parameter.key !== SECRET || SECRET.indexOf('ВСТАВЬТЕ') === 0) {
    return { status: 'forbidden', reason: 'нет ключа или ключ не совпадает с SECRET' };
  }
  let p;
  try {
    p = JSON.parse(e.postData.contents);
  } catch (err) {
    return { status: 'ignored', reason: 'not json' };
  }
  const event = p.eventType || p.event_type || '';
  const lock = LockService.getScriptLock();
  lock.waitLock(25000);
  try {
    if (event === 'payment.success' || event === 'subscription.recurring.payment.success') return savePayment(p);
    if (event === 'refund.success') return markRefund(p);
    return { status: 'ignored', event: event };
  } finally {
    lock.releaseLock();
  }
}

function savePayment(p) {
  const product = p.product || {};
  const sheet = lavaSheet();
  const contractId = String(p.contractId || '');
  const email = normEmail(p.buyer && p.buyer.email);
  // Если это оплата счёта из бота — найдём его на листе «Счета»
  let payRow = 0;
  let tg = '';
  let tariff = tariffByOffer(p.offer && p.offer.id);
  const pay = paySheet();
  if (contractId && pay.getLastRow() > 1) {
    const rows = pay.getRange(2, 1, pay.getLastRow() - 1, PAY_HEADER.length).getValues();
    for (let i = 0; i < rows.length; i++) {
      if (String(rows[i][6]) === contractId) {
        payRow = i + 2;
        tg = rows[i][1];
        tariff = tariffByOffer(rows[i][3]) || tariff;
        break;
      }
    }
  }
  // Уведомления приходят по всем продуктам аккаунта — берём только счета из бота и продукт(ы) этого мероприятия
  if (!payRow) {
    const mine = ownProductIds();
    if (!product.id || mine.indexOf(String(product.id)) < 0) {
      return { status: 'ignored', reason: 'другой продукт' };
    }
  }
  if (contractId && sheet.getRange(1, L_ID, sheet.getMaxRows(), 1).createTextFinder(contractId).matchEntireCell(true).findNext()) {
    if (payRow) pay.getRange(payRow, 8).setValue('оплачен');
    return { status: 'duplicate' };
  }
  if (payRow) pay.getRange(payRow, 8).setValue('оплачен');
  sheet.appendRow([
    new Date(), email, Number(p.amount) || p.amount || '', String(p.currency || '').toUpperCase(), PAID, tg, contractId,
    tariff ? tariff.name : '',
  ]);
  return { status: 'saved', email: email };
}

function markRefund(p) {
  const d = p.data || {};
  const email = normEmail(d.customer_email);
  const productId = String((d.product && d.product.product_id) || '');
  const mine = ownProductIds();
  if (!productId || mine.indexOf(productId) < 0) return { status: 'ignored', reason: 'другой продукт' };
  const sheet = lavaSheet();
  const last = sheet.getLastRow();
  if (!email || last < 2) return { status: 'ignored' };
  const rows = sheet.getRange(2, 1, last - 1, LAVA_HEADER.length).getValues();
  let count = 0;
  rows.forEach(function (r, i) {
    if (normEmail(r[1]) === email && r[L_STATUS - 1] === PAID) {
      sheet.getRange(i + 2, L_STATUS).setValue(REFUNDED);
      count++;
    }
  });
  return { status: 'refunded', count: count };
}


// ---------------------------------------------------------------- каталог Lava

/** Все цены (офферы) аккаунта: [{productId, title, offerId, offerName, prices: [{currency, amount}]}] */
function lavaOffers() {
  const out = [];
  let url = 'https://gate.lava.top/api/v2/products?feedVisibility=ALL';
  for (let i = 0; url && i < 20; i++) {
    const data = lavaGet(url);
    (data.items || []).forEach(function (it) {
      const d = it.data || it;
      (d.offers || []).forEach(function (o) {
        out.push({
          productId: d.id, title: d.title || '', offerId: o.id, offerName: o.name || '',
          prices: (o.prices || []).filter(function (x) { return x.currency; })
            .map(function (x) { return { currency: String(x.currency).toUpperCase(), amount: x.amount }; }),
        });
      });
    });
    url = data.nextPage || null;
  }
  return out;
}

/** Цены оффера в разных валютах: [{currency, amount}]. Кэш на 10 минут. */
function offerPrices(offerId) {
  const hit = CacheService.getScriptCache().get('prices_' + offerId);
  if (hit) return JSON.parse(hit);
  let prices = [];
  try {
    prices = refreshPrices()[offerId] || [];
  } catch (err) {
    writeLog(null, 'PAY', { status: 'prices_error', error: String(err.message || err) });
  }
  if (!prices.length) return [{ currency: 'RUB' }, { currency: 'USD' }, { currency: 'EUR' }];
  return prices;
}

/**
 * Загрузить из Lava цены всех тарифов и сохранить в кэш на 6 часов. Вызывается по расписанию раз в
 * PRICES_REFRESH_EVERY, поэтому страница оплаты получает цены из кэша мгновенно, не дожидаясь Lava.
 * Возвращает { offerId: [{currency, amount}] }.
 */
function refreshPrices() {
  const cache = CacheService.getScriptCache();
  const out = {};
  lavaOffers().forEach(function (o) {
    if (!tariffByOffer(o.offerId) || !o.prices.length) return;
    out[o.offerId] = o.prices;
    cache.put('prices_' + o.offerId, JSON.stringify(o.prices), 21600);
  });
  return out;
}

/** ID продуктов Lava, к которым относятся цены из TARIFFS ([] — если узнать не удалось). Кэш на 6 часов. */
function ownProductIds() {
  const cache = CacheService.getScriptCache();
  const key = 'products_' + TARIFFS.map(function (t) { return t.offer; }).join(',');
  const hit = cache.get(key);
  if (hit) return JSON.parse(hit);
  const ids = [];
  try {
    lavaOffers().forEach(function (o) {
      const id = String(o.productId || '');
      if (id && tariffByOffer(o.offerId) && ids.indexOf(id) < 0) ids.push(id);
    });
  } catch (err) {
    return [];
  }
  if (ids.length) cache.put(key, JSON.stringify(ids), 21600);
  return ids;
}

/** Меню: показать продукты и ID их цен — чтобы вписать нужные в TARIFFS. */
function showOffers() {
  let text;
  try {
    const offers = lavaOffers();
    text = offers.length ? offers.map(function (o) {
      const sums = o.prices.map(function (x) { return x.amount + ' ' + x.currency; }).join(' / ');
      return '• ' + o.title + (o.offerName ? ' — ' + o.offerName : '') + '\n   ' + sums + '\n   ID цены: ' + o.offerId;
    }).join('\n\n') : 'Lava не вернула ни одного продукта.';
  } catch (err) {
    text = 'Ошибка: ' + String(err.message || err);
  }
  writeLog(null, 'OFFERS', { result: text });
  SpreadsheetApp.getUi().alert(text + '\n\n(Этот список также записан на лист «Лог» — оттуда удобно копировать.)');
}

function lavaGet(url) {
  const res = UrlFetchApp.fetch(url, {
    headers: { 'X-Api-Key': LAVA_API_KEY, Accept: 'application/json' },
    muteHttpExceptions: true,
  });
  const code = res.getResponseCode();
  if (code === 401 || code === 403) {
    throw new Error('Lava не приняла API-ключ (код ' + code + '). Проверьте LAVA_API_KEY.');
  }
  if (code !== 200) {
    throw new Error('Lava ответила кодом ' + code + ': ' + res.getContentText().slice(0, 300));
  }
  return JSON.parse(res.getContentText());
}


// ---------------------------------------------------------------- проверка без бота

/** Создаёт тестовый счёт и показывает ссылку. Платить не обязательно. */
function testInvoice() {
  const ui = SpreadsheetApp.getUi();
  const ans = ui.prompt('Тестовый счёт', 'Почта покупателя (не та, на которую зарегистрирован аккаунт Lava):', ui.ButtonSet.OK_CANCEL);
  if (ans.getSelectedButton() !== ui.Button.OK) return;
  const email = normEmail(ans.getResponseText());
  if (!email) return;
  try {
    const inv = getOrCreateInvoice(email, 'test', DEFAULT_OFFER_ID, 'RUB', '');
    ui.alert('Счёт создан. Ссылка на оплату — на листе «Счета»:\n' + inv.paymentUrl);
  } catch (err) {
    ui.alert('Не получилось: ' + String(err.message || err));
  }
}


// ---------------------------------------------------------------- листы и мелочи

function lavaSheet() {
  const ss = SpreadsheetApp.getActive();
  let sheet = ss.getSheetByName(LAVA_SHEET);
  if (!sheet) sheet = ss.insertSheet(LAVA_SHEET);
  if (sheet.getRange(1, LAVA_HEADER.length).getValue() !== LAVA_HEADER[LAVA_HEADER.length - 1]) {
    sheet.getRange(1, 1, 1, LAVA_HEADER.length).setValues([LAVA_HEADER]).setFontWeight('bold');
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function paySheet() {
  const ss = SpreadsheetApp.getActive();
  let sheet = ss.getSheetByName(PAY_SHEET);
  if (!sheet) {
    sheet = ss.insertSheet(PAY_SHEET);
    sheet.appendRow(PAY_HEADER);
    sheet.setFrozenRows(1);
    sheet.getRange('1:1').setFontWeight('bold');
  } else if (sheet.getRange(1, PAY_HEADER.length).getValue() !== PAY_HEADER[PAY_HEADER.length - 1]) {
    // Лист создан прошлой версией скрипта — дописываем новые колонки в шапку
    sheet.getRange(1, 1, 1, PAY_HEADER.length).setValues([PAY_HEADER]).setFontWeight('bold');
  }
  return sheet;
}

function writeLog(e, method, result) {
  try {
    const ss = SpreadsheetApp.getActive();
    let log = ss.getSheetByName(LOG_SHEET);
    if (!log) {
      log = ss.insertSheet(LOG_SHEET);
      log.appendRow(['Время', 'Метод', 'Ключ верный', 'Ответ скрипта', 'Что прислали (начало)']);
      log.setFrozenRows(1);
      log.getRange('1:1').setFontWeight('bold');
    }
    const keyOk = !!(e && e.parameter && e.parameter.key === SECRET);
    const body = (e && e.postData && e.postData.contents) || '';
    log.appendRow([new Date(), method, keyOk ? 'да' : 'нет', JSON.stringify(result), "'" + body.slice(0, 1500)]);
  } catch (err) {
    // журнал не должен мешать записи оплаты
  }
}

function normEmail(v) {
  return String(v || '').trim().toLowerCase();
}

function reply(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
