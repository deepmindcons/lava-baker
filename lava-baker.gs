/**
 * Lava.top + PuzzleBot → Google Таблица «Ян Бейкер регистрации».
 *
 * Что делает скрипт:
 *  • по ссылке из бота создаёт счёт в Lava на почту человека (лист «Счета»);
 *  • каждые 5 минут (и сразу после возврата человека с оплаты) проверяет счета в Lava;
 *  • оплаченные записывает на лист «Lava.top»: дата, почта, сумма, валюта, статус;
 *  • на листе «PuzzleBot» в столбце E «Оплата» ставит «Успешно» / «Нет оплаты»
 *    (сопоставляет по почте, а если почта другая — по тегу Telegram).
 *
 * Настройка — только блок ниже. После вставки: меню «Lava» → «1. Включить автопроверку».
 */

// 1. API-ключ Lava (Lava → Интеграции → API → API key).
const LAVA_API_KEY = 'ВСТАВЬТЕ_СЮДА_API_KEY_ИЗ_LAVA';

// 2. Цены продукта «Ян Бейкер» в Lava (ID для параметра offer в ссылке из бота):
//      1750 ₽ — 7a7b5e0b-f5d3-404b-9692-c15b1eaa244b
//      2750 ₽ — d8a6b75e-2c4d-4cbf-b013-c69dcd4de923
//      3750 ₽ — b39309a1-7ddc-4a6d-a06d-fe398a2d18d5
//    Цена по умолчанию, если в ссылке не указан offer:
const DEFAULT_OFFER_ID = '7a7b5e0b-f5d3-404b-9692-c15b1eaa244b';

// 3. Любая длинная случайная строка — нужна, только если включите уведомления (вебхук) в Lava:
//    адрес вебхука будет …/exec?key=ЭТА_СТРОКА. Без вебхука всё тоже работает.
const SECRET = 'ВСТАВЬТЕ_СЮДА_СЛУЧАЙНУЮ_СТРОКУ';

// 4. Страница оплаты (папка docs, GitHub Pages)
const PAY_PAGE_URL = 'https://deepmindcons.github.io/lava-baker/';
// 5. Ссылка на бота (сюда вернёт кнопка отмены на странице Lava)
const BOT_URL = 'https://t.me/deepmindco_bot';
// 6. Команда бота, которая проверяет оплату и выдаёт доступ (сюда человек попадает после оплаты)
const PAID_URL = 'https://t.me/deepmindco_bot?start=link_RG6MJ6vWOv';

// Листы таблицы
const REG_SHEET = 'PuzzleBot';   // A — имя, B — тег, C — почта, D — доступ (заполняет бот), E — оплата (заполняет скрипт)
const LAVA_SHEET = 'Lava.top';
const PAY_SHEET = 'Счета';
const LOG_SHEET = 'Лог';

const REG_EMAIL_COL = 3;         // C
const REG_PAY_COL = 5;           // E
const REG_PAY_HEADER = 'Оплата';
const PAY_YES = 'Успешно';
const PAY_NO = 'Нет оплаты';

const LAVA_HEADER = ['Дата', 'Почта', 'Сумма', 'Валюта', 'Статус', 'Telegram', 'ID оплаты'];
const PAID = 'Успешно';
const REFUNDED = 'Возврат';
// номера колонок листа «Lava.top»
const L_STATUS = 5, L_TG = 6, L_ID = 7;

const PAY_HEADER = ['Создан', 'Telegram ID', 'Почта', 'Оффер', 'Сумма', 'Валюта', 'ID счёта', 'Статус', 'Ссылка на оплату', 'Промокод'];


// ---------------------------------------------------------------- меню

function onOpen() {
  SpreadsheetApp.getUi().createMenu('Lava')
    .addItem('1. Включить автопроверку (один раз)', 'install')
    .addItem('Показать продукты и цены Lava', 'showOffers')
    .addItem('Проверить оплаты сейчас', 'checkNow')
    .addItem('Создать тестовый счёт', 'testInvoice')
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
function tick() {
  let paid = 0;
  try {
    paid = syncInvoices();
  } finally {
    updatePayColumn();
  }
  return paid;
}

function checkNow() {
  const paid = tick();
  SpreadsheetApp.getUi().alert('Проверено. Новых оплат: ' + paid);
}


// ---------------------------------------------------------------- вход: запросы от страницы оплаты, бота и Lava

/** Приём уведомлений (вебхуков) от Lava. */
function doPost(e) {
  let result;
  try {
    result = handle(e);
    if (result.status === 'saved' || result.status === 'refunded') updatePayColumn();
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
  if (p.api === 'prices') {
    return { ok: true, prices: offerPrices(offerId), bot: BOT_URL, paidUrl: PAID_URL };
  }
  const email = normEmail(String(p.email || '').replace(/ /g, '+'));
  const validEmail = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) && email.indexOf('{{') < 0;
  if (p.api === 'check') {
    if (!validEmail) return { ok: false, error: 'email', bot: BOT_URL, paidUrl: PAID_URL };
    const found = syncInvoices(email);
    if (found) updatePayColumn();
    return { ok: true, paid: hasPaidInvoice(email), bot: BOT_URL, paidUrl: PAID_URL };
  }
  if (p.api === 'invoice') {
    const uid = String(p.uid || '').trim();
    const currency = String(p.cur || 'RUB').trim().toUpperCase();
    const promo = String(p.promo || '').trim().toUpperCase();
    if (!validEmail) return { ok: false, error: 'email', message: 'Не удалось определить вашу почту. Вернитесь в бот и введите почту ещё раз.' };
    if (promo && !/^[A-Z0-9_-]{3,36}$/.test(promo)) {
      return { ok: false, error: 'promo', message: 'Промокод может состоять только из латинских букв, цифр, «-» и «_».' };
    }
    try {
      const inv = getOrCreateInvoice(email, uid, offerId, currency, promo);
      writeLog(null, 'PAY', { status: 'redirect', email: email, uid: uid, promo: promo, invoice: inv.id });
      return { ok: true, paymentUrl: inv.paymentUrl };
    } catch (err) {
      const msg = String(err.message || err);
      writeLog(null, 'PAY', { status: 'error', email: email, uid: uid, promo: promo, error: msg });
      if (promo && / 400: /.test(msg)) {
        return { ok: false, error: 'promo', message: 'Промокод не подошёл. Проверьте его или оплатите без промокода.' };
      }
      return { ok: false, error: 'failed', message: 'Не получилось создать оплату. Попробуйте ещё раз через минуту или напишите нам в боте.' };
    }
  }
  return { ok: false, error: 'unknown' };
}

function hasPaidInvoice(email) {
  const lava = lavaSheet();
  const last = lava.getLastRow();
  if (last < 2) return false;
  return lava.getRange(2, 1, last - 1, LAVA_HEADER.length).getValues()
    .some(function (r) { return normEmail(r[1]) === email && r[L_STATUS - 1] === PAID; });
}


// ---------------------------------------------------------------- счета

/** Куда Lava вернёт покупателя после оплаты / ошибки / отмены. */
function returnUrls(email, uid, offerId) {
  const q = 'email=' + encodeURIComponent(email) + '&uid=' + encodeURIComponent(uid) +
            '&offer=' + encodeURIComponent(offerId);
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
function getOrCreateInvoice(email, uid, offerId, currency, promo) {
  promo = promo || '';
  if (!offerId || offerId.indexOf('ВСТАВЬТЕ') === 0) {
    throw new Error('Не указан DEFAULT_OFFER_ID вверху скрипта.');
  }
  const sheet = paySheet();
  const lock = LockService.getScriptLock();
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
          return { id: r[6], paymentUrl: r[8] };
        }
      }
    }

    const res = UrlFetchApp.fetch('https://gate.lava.top/api/v3/invoice', {
      method: 'post',
      contentType: 'application/json',
      headers: { 'X-Api-Key': LAVA_API_KEY, Accept: 'application/json' },
      payload: JSON.stringify(Object.assign({
        email: email,
        offerId: offerId,
        currency: currency,
        buyerLanguage: 'RU',
        clientUtm: { utm_source: 'puzzlebot', utm_content: uid },
      }, promo ? { promoCode: promo } : {}, returnUrls(email, uid, offerId))),
      muteHttpExceptions: true,
    });
    const code = res.getResponseCode();
    const text = res.getContentText();
    if (code !== 200 && code !== 201) {
      throw new Error('Lava ответила кодом ' + code + ': ' + text.slice(0, 300));
    }
    const data = JSON.parse(text);
    if (!data.paymentUrl) throw new Error('Lava не вернула ссылку на оплату: ' + text.slice(0, 300));
    const money = data.amountTotal || {};
    sheet.appendRow([new Date(), uid, email, offerId, Number(money.amount) || '', String(money.currency || currency),
                     data.id, 'ожидает оплаты', data.paymentUrl, promo]);
    return { id: data.id, paymentUrl: data.paymentUrl };
  } finally {
    lock.releaseLock();
  }
}

/**
 * Проверить в Lava статус неоплаченных счетов из листа «Счета» (за последние 3 дня)
 * и записать оплаченные на лист «Lava.top». Возвращает число новых оплат.
 */
function syncInvoices(onlyEmail) {
  if (typeof onlyEmail !== 'string') onlyEmail = '';
  const sheet = paySheet();
  const last = sheet.getLastRow();
  if (last < 2) return 0;
  const rows = sheet.getRange(2, 1, last - 1, PAY_HEADER.length).getValues();
  const paid = [];
  const errors = [];
  rows.forEach(function (r, i) {
    if (r[7] !== 'ожидает оплаты' || !r[6]) return;
    if (onlyEmail && r[2] !== onlyEmail) return;
    const created = new Date(r[0]).getTime();
    if (Date.now() - created > 3 * 24 * 3600 * 1000) {
      sheet.getRange(i + 2, 8).setValue('не оплачен (истёк)');
      return;
    }
    let inv;
    try {
      inv = lavaGet('https://gate.lava.top/api/v1/invoices/' + encodeURIComponent(r[6]));
    } catch (err) {
      errors.push(r[6] + ': ' + String(err.message || err).slice(0, 200));
      return;
    }
    const status = String(inv.status || '').toUpperCase();
    if (status === 'COMPLETED' || status === 'SUBSCRIPTION-ACTIVE' || status === 'SUBSCRIPTION_ACTIVE') {
      paid.push({ row: i + 2, r: r, inv: inv });
    } else if (status === 'FAILED') {
      sheet.getRange(i + 2, 8).setValue('не оплачен');
    }
  });

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
          lava.appendRow([
            x.inv.datetime ? new Date(x.inv.datetime) : new Date(), r[2],
            r[4], String(r[5]).toUpperCase(), PAID, r[1], r[6],
          ]);
        } else if (!lava.getRange(at + 2, L_TG).getValue()) {
          // Оплату уже записал вебхук — допишем Telegram
          lava.getRange(at + 2, L_TG).setValue(r[1]);
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


// ---------------------------------------------------------------- столбец «Оплата» на листе PuzzleBot

/** Проставить «Успешно» / «Нет оплаты» напротив каждой регистрации. */
function updatePayColumn() {
  const ss = SpreadsheetApp.getActive();
  const reg = ss.getSheetByName(REG_SHEET);
  if (!reg) return;
  if (reg.getRange(1, REG_PAY_COL).getValue() !== REG_PAY_HEADER) {
    reg.getRange(1, REG_PAY_COL).setValue(REG_PAY_HEADER).setFontWeight('bold');
  }
  const last = reg.getLastRow();
  if (last < 2) return;

  const paidEmails = {};
  const paidTags = {};
  const lava = lavaSheet();
  if (lava.getLastRow() > 1) {
    lava.getRange(2, 1, lava.getLastRow() - 1, LAVA_HEADER.length).getValues().forEach(function (r) {
      if (r[L_STATUS - 1] !== PAID) return;
      if (r[1]) paidEmails[normEmail(r[1])] = true;
      const tag = normTag(r[L_TG - 1]);
      if (tag) paidTags[tag] = true;
    });
  }

  const rows = reg.getRange(2, 1, last - 1, REG_PAY_COL).getValues();
  const out = [];
  let changed = false;
  rows.forEach(function (r) {
    const email = normEmail(r[REG_EMAIL_COL - 1]);
    const tag = normTag(r[1]);
    let v = '';
    if (email || tag) v = (email && paidEmails[email]) || (tag && paidTags[tag]) ? PAY_YES : PAY_NO;
    if (v !== r[REG_PAY_COL - 1]) changed = true;
    out.push([v]);
  });
  if (changed) reg.getRange(2, REG_PAY_COL, out.length, 1).setValues(out);
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
  const mine = ownProductId();
  // Уведомления приходят по всем продуктам аккаунта — берём только продукт этого мероприятия
  if (mine && product.id && String(product.id) !== mine) {
    return { status: 'ignored', reason: 'другой продукт' };
  }
  const sheet = lavaSheet();
  const contractId = String(p.contractId || '');
  const email = normEmail(p.buyer && p.buyer.email);
  if (contractId && sheet.getRange(1, L_ID, sheet.getMaxRows(), 1).createTextFinder(contractId).matchEntireCell(true).findNext()) {
    return { status: 'duplicate' };
  }
  sheet.appendRow([
    new Date(), email, Number(p.amount) || p.amount || '', String(p.currency || '').toUpperCase(), PAID, '', contractId,
  ]);
  return { status: 'saved', email: email };
}

function markRefund(p) {
  const d = p.data || {};
  const email = normEmail(d.customer_email);
  const productId = String((d.product && d.product.product_id) || '');
  const mine = ownProductId();
  if (mine && productId && productId !== mine) return { status: 'ignored', reason: 'другой продукт' };
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
  const cache = CacheService.getScriptCache();
  const hit = cache.get('prices_' + offerId);
  if (hit) return JSON.parse(hit);
  let prices = [];
  try {
    lavaOffers().forEach(function (o) { if (o.offerId === offerId) prices = o.prices; });
  } catch (err) {
    writeLog(null, 'PAY', { status: 'prices_error', error: String(err.message || err) });
  }
  if (!prices.length) return [{ currency: 'RUB' }, { currency: 'USD' }, { currency: 'EUR' }];
  cache.put('prices_' + offerId, JSON.stringify(prices), 600);
  return prices;
}

/** ID продукта, к которому относится DEFAULT_OFFER_ID ('' — если узнать не удалось). Кэш на 6 часов. */
function ownProductId() {
  const cache = CacheService.getScriptCache();
  const key = 'product_' + DEFAULT_OFFER_ID;
  const hit = cache.get(key);
  if (hit) return hit;
  let id = '';
  try {
    lavaOffers().forEach(function (o) { if (o.offerId === DEFAULT_OFFER_ID) id = String(o.productId || ''); });
  } catch (err) {
    return '';
  }
  if (id) cache.put(key, id, 21600);
  return id;
}

/** Меню: показать продукты и ID их цен — чтобы вписать нужный в DEFAULT_OFFER_ID. */
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
