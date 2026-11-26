# Публичный API версии 0.1.0

| Вызов | Результат |
|---|---|
| `await NSDAnalytics.open(data, config?)` | Открывает модальное окно или встраивание. После первого рендера возвращает `{count, mode}`, где mode равен main или worker. Возвращает null, если сессию закрыли при загрузке. |
| `await NSDAnalytics.update(data)` | Заменяет снимок целиком, сохраняет конфигурацию и доверенные параметры хоста, сбрасывает временную детализацию и вкладку. |
| `NSDAnalytics.close()` | Закрывает текущее окно, отменяет запросы, освобождает DOM и Worker, по возможности возвращает фокус. Повторный вызов безопасен. |
| `NSDAnalytics.destroy()` | Полное освобождение текущей сессии с тем же контрактом, что close. Доступность фабрики для нового open сохраняется. |
| `NSDAnalytics.exportConfig()` | Возвращает отдельную JSON-совместимую копию версии 1. Содержит сохранённые фильтры; временная выборка по нажатию в неё не входит. |
| `await NSDAnalytics.importConfig(configOrJson)` | Проверяет размер, сложность, значения, имена полей. Применяет шаблон к текущему снимку. Схема доступа и функции хоста принадлежат открытой сессии. |

Дождитесь Promise open перед update или importConfig. Ошибки структуры входа или сериализации сообщаются через исключение / rejected Promise. Ошибка отдельного графика отображается внутри карточки, оставляя другие виджеты доступными. Все методы находятся в `window.NSDAnalytics`.

```js
const rows = [
  {uuid:'demo$1', team:'Поддержка', minutes:42, createdAt:'2026-01-01'},
  {uuid:'demo$2', team:'Инфраструктура', minutes:17, createdAt:'2026-01-02'}
];
await NSDAnalytics.open(rows);
const settings = NSDAnalytics.exportConfig();
await NSDAnalytics.update(rows.slice(0, 1));
await NSDAnalytics.importConfig(settings);
NSDAnalytics.close();
```

Передача `mount`, callback, nonce, locale и других параметров описана в [конфигурации](configuration.md).
