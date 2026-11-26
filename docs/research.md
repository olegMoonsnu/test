# Исследование и решения

| Источник | Что учтено в проекте |
|---|---|
| [Описание SMP 4.17](https://www.naumen.ru/products/smp/knowledge_base/release/4_17/) | Вендор прекратил поддержку Internet Explorer начиная с 4.17.0. Целевое окружение Studio — современный браузер с Shadow DOM. |
| [Документация NSD](https://www.naumen.ru/products/service_desk/knowledge_base/docs/aktualnye_relizy/) и [скриптовый API](https://www.naumen.ru/products/service_desk/functions/api-dlya-razrabotchikov/) | Технолог сверяет вызов операции, объектную модель и права с комплектом документации своего релиза. Публичного подтверждения конкретной сигнатуры запуска JS в требуемой установке мы не нашли. |
| [Пример обёртки SMP JS API](https://github.com/mdemyanov/naumen-smp-jsapi) | Сторонний пример привязан к окружению приложения и REST. В Studio хост передаёт данные аргументом. |
| [Groovy JSON](https://docs.groovy-lang.org/latest/html/documentation/json-userguide.html) | Явная проекция разрешённых значений и JsonOutput. Сериализатор получает обычные Map и List. |
| [PivotTable.js](https://github.com/nicolaskruchten/pivottable) | Для каждой комбинации координат создаётся отдельный агрегатор. Итоги строятся по исходным наблюдениям. |
| [Crossfilter](https://crossfilter.github.io/crossfilter/) | Связанные представления используют выборку индексов. Studio кеширует последние выборки и ограничивает их число. |
| [Metabase](https://www.metabase.com/docs/latest/dashboards/interactive) и [Superset](https://superset.apache.org/developer-docs/api/update-native-filters-configuration-for-a-dashboard/) | Конфигурация глобального фильтра отделена от локального фильтра виджета. Каждая интерактивная метка ведёт к объектам, с которыми она связана. |
| [MDN, structured clone](https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Structured_clone_algorithm) | Постоянный Worker получает строки пакетами один раз при загрузке. Последующие команды содержат только параметры запроса. |
| [OWASP, DOM XSS](https://cheatsheetseries.owasp.org/cheatsheets/DOM_based_XSS_Prevention_Cheat_Sheet.html) и [CSV Injection](https://owasp.org/www-community/attacks/CSV_Injection) | Текстовые DOM-узлы, разрешённые HTTP(S)-ссылки того же origin, отдельное экранирование таблиц при экспорте. |

Проект использует собственный код аналитики и отрисовки. Числа производительности относятся исключительно к нашим измерениям.
