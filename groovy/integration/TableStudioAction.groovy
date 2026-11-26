/** Adapter for a synchronous list action. The caller supplies the NSD list,
 * the action result and the installation's server-side projection and ACL rules.
 */
class TableStudioAction {
    static void open(def rows, def result, Collection<String> fields,
                     Closure<Boolean> mayReadRow, Closure<Boolean> mayReadField,
                     Closure readProjectedField) {
        if (rows == null) {
            result.showMessage('Аналитика', 'Откройте действие на панели списка объектов.')
            return
        }
        if (rows.limitExceeded()) {
            result.showMessage('Аналитика', 'В таблице больше 1000 объектов. Сузьте фильтр и нажмите кнопку ещё раз.')
            return
        }
        String json = AnalyticsPayload.encode(rows, fields, mayReadRow, mayReadField, readProjectedField)
        // Encode data only. The program is fixed and calls the already installed client.
        String data = json.getBytes('UTF-8').encodeBase64().toString()
        result.executeJavaScript("""
            (function () {
                var studio = window.NSDAnalytics;
                if (!studio || typeof studio.open !== 'function') {
                    window.alert('Панель NSD Analytics Studio ещё не подключена к этому окну.');
                    return;
                }
                var bytes = Uint8Array.from(atob('${data}'), function (c) { return c.charCodeAt(0); });
                var rows = JSON.parse(new TextDecoder('utf-8').decode(bytes));
                studio.open(rows, {title: 'Аналитика по текущей таблице'})
                    .catch(function () { window.alert('Не удалось открыть аналитику таблицы.'); });
            })();
        """.toString())
    }
}
