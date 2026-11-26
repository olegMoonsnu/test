// Код числовой колонки для расчёта среднего. Пустая строка отключает расчёт.
def metric = ''

if (source != 'OBJECT_LIST' || list == null) {
    result.showMessage('Аналитика', 'Откройте действие с панели таблицы.')
    return
}
if (subjects == null) {
    result.showMessage('Аналитика', 'Нет права на выполнение действия.')
    return
}
if (list.limitExceeded()) {
    result.showMessage('Аналитика', 'В списке больше 1000 объектов. Сузьте фильтр.')
    return
}

def types = [:].withDefault { 0 }
def states = [:].withDefault { 0 }
def metadata = [:], names = [:]
int total = 0, filled = 0
BigDecimal sum = 0
list.each { row ->
    total++
    def type = row.getMetainfo().toString()
    if (!metadata.containsKey(type)) metadata[type] = api.metainfo.getMetaClass(type)
    def meta = metadata[type]
    types[meta.title ?: type]++

    def label = 'Без жизненного цикла'
    if (meta.hasWorkflow) {
        def code = row.state
        if (code) {
            def key = [type, code]
            if (!names.containsKey(key)) names[key] = api.metainfo.getStateTitle(type, code) ?: code
            label = names[key]
        } else {
            label = 'Статус не задан'
        }
    }
    states[label]++
    if (metric && meta.hasAttribute(metric)) {
        def value = row[metric]
        if (value instanceof Number && value.toString().isBigDecimal()) {
            sum += new BigDecimal(value.toString())
            filled++
        }
    }
}

if (!total) {
    result.showMessage('Аналитика по таблице', 'По текущему фильтру объектов нет.')
    return
}
def escape = { s -> s.toString().replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;') }
def format = { n -> String.format(java.util.Locale.forLanguageTag('ru-RU'), '%.1f', n) }
def lines = ["<b>Объектов в таблице: ${total}</b>"]
def section = { title, counts ->
    lines << "<br><b>${title}</b>"
    def sorted = counts.entrySet().toList().sort { a, b -> (b.value <=> a.value) ?: (a.key <=> b.key) }
    def shown = sorted.take(10)
    shown.each { e -> lines << "${escape(e.key)} — ${e.value} (${format(100.0 * e.value / total)} %)" }
    if (sorted.size() > shown.size()) lines << "Остальные — ${total - shown.sum { it.value }}"
}
section('По типам объектов', types)
section('По статусам', states)
if (metric) {
    lines << "<br><b>Среднее по ${escape(metric)}</b>"
    lines << (filled ? "${format(sum / filled)} · значений: ${filled} из ${total}" : 'Числовых значений нет.')
}
result.showMessage('Аналитика по таблице', lines.join('<br>'))
