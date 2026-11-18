# Lava.top + PuzzleBot — Ян Бейкер

Оплата встречи через Lava.top из PuzzleBot с записью в Google Таблицу «Ян Бейкер регистрации».

## Как это работает

1. В боте человек оставляет почту и нажимает кнопку тарифа.
2. Кнопка открывает страницу оплаты (`docs/index.html`, GitHub Pages) — там выбор валюты и промокод.
3. Страница просит скрипт (`lava-baker.gs`, Apps Script в таблице) создать счёт в Lava на почту человека и переводит на оплату.
4. После оплаты Lava возвращает на страницу, та отмечает оплату и отправляет человека в бота.
5. Скрипт пишет оплату на лист «Lava.top», а на листе «PuzzleBot» ставит в столбце «Оплата» «Успешно» / «Нет оплаты».
   Раз в 5 минут скрипт сам перепроверяет неоплаченные счета.

## Ссылки для кнопок в боте

| Тариф | Ссылка |
|---|---|
| 1750 ₽ | `https://deepmindcons.github.io/lava-baker/?uid={{USERNAME_TEXT}}&tid={{USER_ID_TEXT}}&email={{email_baker}}&offer=7a7b5e0b-f5d3-404b-9692-c15b1eaa244b` |
| 2750 ₽ | `https://deepmindcons.github.io/lava-baker/?uid={{USERNAME_TEXT}}&tid={{USER_ID_TEXT}}&email={{email_baker}}&offer=d8a6b75e-2c4d-4cbf-b013-c69dcd4de923` |
| 3750 ₽ | `https://deepmindcons.github.io/lava-baker/?uid={{USERNAME_TEXT}}&tid={{USER_ID_TEXT}}&email={{email_baker}}&offer=b39309a1-7ddc-4a6d-a06d-fe398a2d18d5` |

Проверка оплаты из бота (ответ `paid` / `unpaid`):

```
https://script.google.com/macros/s/AKfycbwQQkjdvZejB8kAPMtp6ealfiYciTFmaAYALwJ3fENSw2Fwpk9JJbdfvq8UAqjMIIZKgg/exec?api=check&email={{email_baker}}&format=text
```

## Важно

- API-ключ Lava хранится **только** в Apps Script, в этом репозитории его нет и быть не должно.
- После правок `lava-baker.gs` вставьте код в Apps Script и выпустите новую версию развёртывания
  (Развертывание → Управление развертываниями → карандаш → Новая версия), чтобы адрес `/exec` не поменялся.

---

# Lava.top + PuzzleBot — Deep Body Camp

Отдельный скрипт `bodycamp.gs` и отдельная страница оплаты `docs/bodycamp/index.html`
(https://deepmindcons.github.io/lava-baker/bodycamp/). Таблица — «deep body camp регистрации».
Версия для Яна Бейкера (`lava-baker.gs`, `docs/index.html`) не изменилась.

Отличия от Бейкера:

- 3 тарифа, у каждого свой лист регистраций: «Без записей 2300», «С записями 3300», «С записями 4300».
- После оплаты бот получает разные команды: 2300 → `COMMAND_NO_REC`, 3300 и 4300 → `COMMAND_REC`.
- На листе «Lava.top» добавлен столбец «Тариф».
- В столбце E «Оплата» на листе тарифа: «Успешно» — оплачен этот тариф,
  «Оплачен другой тариф: 3300» — оплатил, но другой, «Нет оплаты» — оплат нет.

## Настройка

1. Таблица → Расширения → Apps Script → вставить `bodycamp.gs`.
2. Вверху скрипта вписать `LAVA_API_KEY`, `PUZZLEBOT_TOKEN` (те же, что у Бейкера)
   и названия команд бота `COMMAND_NO_REC` (2300) и `COMMAND_REC` (3300, 4300).
   Ключ, токен и названия команд вписываются только в Apps Script — в GitHub их не храним.
   ID цен уже вписаны (продукт Lava `ada2eaaa-a138-4b80-abaf-690d6449615f`).
3. Развернуть как веб-приложение (запуск от моего имени, доступ — все), адрес `/exec`
   вписать в `SCRIPT_URL` в `docs/bodycamp/index.html`.
4. Меню «Lava» → «1. Включить автопроверку».

## Ссылки для кнопок в боте

У каждого тарифа своя переменная с почтой в боте.

| Тариф | Ссылка |
|---|---|
| 2300 ₽ | `https://deepmindcons.github.io/lava-baker/bodycamp/?uid={{USERNAME_TEXT}}&tid={{USER_ID_TEXT}}&email={{email_camp2300}}&offer=1a49501b-ff80-40da-8841-de64f310d9b4` |
| 3300 ₽ | `https://deepmindcons.github.io/lava-baker/bodycamp/?uid={{USERNAME_TEXT}}&tid={{USER_ID_TEXT}}&email={{email_camp3300}}&offer=5ba3f4cf-ebd4-428f-b31e-c4ef11acda4a` |
| 4300 ₽ | `https://deepmindcons.github.io/lava-baker/bodycamp/?uid={{USERNAME_TEXT}}&tid={{USER_ID_TEXT}}&email={{email_camp4300}}&offer=111ca105-a35c-457a-a2d0-f2fa543f413e` |

Проверка оплаты из бота (ответ `paid` / `unpaid`), например для 2300:
`https://script.google.com/macros/s/AKfycby5bCIbi2CQ4u0z3oeZu0v41c6DdKlhLL_v5SAQE3gINap9evvCjxEX-icPbGEl61jZ/exec?api=check&email={{email_camp2300}}&offer=1a49501b-ff80-40da-8841-de64f310d9b4&format=text`
(без `&offer=…` — проверка оплаты любого тарифа).
