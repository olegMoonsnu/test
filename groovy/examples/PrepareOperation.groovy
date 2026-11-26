// Самостоятельный пример. Ни одно из замыканий ниже не является методом NSD.
import groovy.json.JsonSlurper
def projection = [[uuid:'demo$1', status:'В работе', duration:12, internal:'Скрыто'],
                  [uuid:'demo$2', status:'Закрыта', duration:20]]
def fields = ['uuid', 'status', 'duration']
String payload = AnalyticsPayload.encode(projection, fields,
    { row -> row.uuid == 'demo$1' },                    // заменить проверкой доступа к записи
    { row, code -> fields.contains(code) },             // заменить правами на атрибут для row
    { row, code -> row[code] })                         // уже подготовленная пакетная проекция
assert new JsonSlurper().parseText(payload) == [[uuid:'demo$1', status:'В работе', duration:12]]
return payload  // Передать строкой как отдельный аргумент локальному JS-мосту.
