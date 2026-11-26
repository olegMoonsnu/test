import groovy.json.JsonSlurper

class TestList extends ArrayList {
    boolean truncated
    boolean limitExceeded() { truncated }
}
class TestResult {
    List messages = []
    List scripts = []
    void showMessage(String title, String text) { messages << [title, text] }
    void executeJavaScript(String script) { scripts << script }
}

def checkFile = new File('groovy/examples/CheckTableButton.groovy')
def testList = new TestList()
testList.addAll([[id:1, visible:true,  status:'В работе', duration:15],
                 [id:2, visible:false, status:'Скрыто',   duration:90],
                 [id:3, visible:true,  status:'Закрыта',  duration:45]])
def checkCount = { rows ->
    def result = new TestResult()
    new GroovyShell(new Binding([list:rows, subjects:[], result:result])).evaluate(checkFile)
    result.messages[0][1]
}
assert checkCount(testList).endsWith(': 3')
assert checkCount(new TestList()).endsWith(': 0')
assert checkCount(null).contains('панели списка')
def boundary = new TestList()
1000.times { boundary.add([:]) }
assert checkCount(boundary).endsWith(': 1000')

def runStudio = { rows ->
    def result = new TestResult()
    TableStudioAction.open(rows, result, ['status', 'duration'],
        { row -> row.visible }, { row, field -> field == 'status' || row.id == 1 },
        { row, field -> row[field] })
    result
}
def output = runStudio(testList)
assert output.messages.empty && output.scripts.size() == 1
def match = output.scripts.first() =~ /atob\('([A-Za-z0-9+\/=]+)'\)/
assert match.find()
def json = new String(match.group(1).decodeBase64(), 'UTF-8')
assert new JsonSlurper().parseText(json) == [[status:'В работе', duration:15], [status:'Закрыта']]
assert runStudio(new TestList()).scripts.size() == 1
testList.truncated = true
assert checkCount(testList).contains('Сузьте фильтр')
def tooLarge = runStudio(testList)
assert tooLarge.scripts.empty && tooLarge.messages[0][1].contains('Сузьте фильтр')
assert runStudio(null).scripts.empty
if (args.length) new File(args[0]).setText(output.scripts.first(), 'UTF-8')
println 'Table action: native count, 0/1000/truncated, ACL projection and JS payload passed.'

def body = new File('groovy/examples/TableAnalyticsButton.groovy').getText('UTF-8')
def metaReads = [], titleReads = []
def metadata = [
    getMetaClass: { String type ->
        metaReads << type
        [title: type == 't' ? 'Заявка' : 'Оборудование', hasWorkflow:type == 't',
         hasAttribute:{ field -> type == 't' && field == 'minutes' }]
    },
    getStateTitle:{ String type, String code ->
        titleReads << [type, code]
        code == 'open' ? '<В работе & ещё>' : code
    }
]
def reportList = new TestList()
def row = { type, code, value -> [getMetainfo:{ -> type }, state:code, minutes:value] }
reportList.addAll([row('t','open',-10), row('t','open',0), row('t',null,20), row('asset',null,null)])
def nativeReport = { rows, selection, String script = body, String origin = 'OBJECT_LIST' ->
    def result = new TestResult()
    def ctx = [source:origin, list:rows, subjects:selection, result:result, api:[metainfo:metadata]]
    new GroovyShell(new Binding(ctx)).evaluate(script)
    assert result.scripts.empty && result.messages.size() == 1
    result.messages.first()[1]
}
def nativeHtml = nativeReport(reportList, [reportList.first()])
assert nativeHtml.contains('Объектов в таблице: 4')
assert nativeHtml.contains('&lt;В работе &amp; ещё&gt; — 2 (50,0 %)') && !nativeHtml.contains('<В работе')
assert nativeHtml.contains('Без жизненного цикла — 1') && nativeHtml.contains('Статус не задан — 1')
assert metaReads == ['t','asset'] && titleReads == [['t','open']]
assert nativeReport(reportList, []).contains('Объектов в таблице: 4')
assert nativeReport(reportList, null).contains('Нет права')
assert nativeReport(null, [], body, 'OBJECT_CARD').contains('с панели таблицы')
assert nativeReport(new TestList(), []).contains('объектов нет')
def numericBody = body.replace("def metric = ''", "def metric = 'minutes'")
reportList.addAll([row('t','open',null), row('t','open','текст'), row('t','open',Double.NaN)])
assert nativeReport(reportList, [], numericBody).contains('3,3 · значений: 3 из 7')
def many = new TestList()
1000.times { many << row('t','s' + it % 12,null) }
assert nativeReport(many, []).contains('Остальные — 166')
many.truncated = true
metaReads.clear()
assert nativeReport(many, []).contains('Сузьте фильтр') && metaReads.empty
println 'Standalone synchronous event: whole list, counts, HTML text, metadata caching, metric, guards and category cap passed.'
