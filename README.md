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
| 1750 ₽ | `https://deepmindcons.github.io/lava-baker/?uid={{USERNAME_TEXT}}&email={{email_baker}}&offer=7a7b5e0b-f5d3-404b-9692-c15b1eaa244b` |
| 2750 ₽ | `https://deepmindcons.github.io/lava-baker/?uid={{USERNAME_TEXT}}&email={{email_baker}}&offer=d8a6b75e-2c4d-4cbf-b013-c69dcd4de923` |
| 3750 ₽ | `https://deepmindcons.github.io/lava-baker/?uid={{USERNAME_TEXT}}&email={{email_baker}}&offer=b39309a1-7ddc-4a6d-a06d-fe398a2d18d5` |

Проверка оплаты из бота (ответ `paid` / `unpaid`):

```
https://script.google.com/macros/s/AKfycbwQQkjdvZejB8kAPMtp6ealfiYciTFmaAYALwJ3fENSw2Fwpk9JJbdfvq8UAqjMIIZKgg/exec?api=check&email={{email_baker}}&format=text
```

## Важно

- API-ключ Lava хранится **только** в Apps Script, в этом репозитории его нет и быть не должно.
- После правок `lava-baker.gs` вставьте код в Apps Script и выпустите новую версию развёртывания
  (Развертывание → Управление развертываниями → карандаш → Новая версия), чтобы адрес `/exec` не поменялся.
