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
