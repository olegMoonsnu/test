// Тело синхронного пользовательского действия на панели конкретного списка.
// Включайте в проекцию только поля, разрешённые роли кнопки для всей выборки.
def metric = ''       // Необязательно: код доступного числового атрибута.
def metricTitle = ''  // Например, «Время решения, мин».
if (source != 'OBJECT_LIST' || list == null || subjects == null) {
    result.showMessage('Аналитика', 'Откройте действие в доступном списке объектов.')
    return
}
if (list.limitExceeded()) {
    result.showMessage('Аналитика', 'В таблице больше 1000 объектов. Сузьте фильтр.')
    return
}

def rows = [], types = [:], states = [:]
list.each { obj ->
    def type = obj.getMetainfo().toString()
    if (!types.containsKey(type)) types[type] = api.metainfo.getMetaClass(type)
    def meta = types[type]
    def label = 'Без жизненного цикла'
    if (meta.hasWorkflow) {
        def code = obj.state
        label = 'Статус не задан'
        if (code) {
            def key = [type, code]
            if (!states.containsKey(key)) states[key] = api.metainfo.getStateTitle(type, code) ?: code
            label = states[key].toString()
        }
    }
    def row = [objectType:(meta.title ?: type).toString(), status:label]
    if (metric && meta.hasAttribute(metric)) {
        def value = obj[metric]
        row.metric = value instanceof Number && Double.isFinite(value.doubleValue()) ? value : null
    }
    rows << row
}

def columns = [[code:'objectType', title:'Тип объекта', type:'string'],
               [code:'status', title:'Статус', type:'string']]
if (metric) columns << [code:'metric', title:(metricTitle ?: metric), type:'number']
def settings = [title:'Аналитика по текущей таблице', columns:columns]
try {
    result.executeJavaScript(modules.nsdAnalyticsStudio.open(rows, settings))
} catch (IllegalArgumentException e) {
    result.showMessage('Аналитика', 'Проверьте типы полей и размер выборки (до 2 МиБ).')
}
