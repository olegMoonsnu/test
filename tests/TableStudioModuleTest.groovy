def loader = new GroovyShell()
def module = loader.parse(new File('groovy/table-studio/nsdAnalyticsStudio.groovy'))
def action = new File('groovy/table-studio/TableButton.groovy').getText('UTF-8')
def standalone = new File('groovy/table-studio/TableAnalyticsAction.groovy').getText('UTF-8')
class StudioList extends ArrayList {
    boolean truncated
    boolean limitExceeded() { truncated }
}
def row = { type, state, value ->
    [getMetainfo:{ -> type },state:state,minutes:value,secret:'secret_value_not_in_report']
}
def rows = new StudioList()
rows.addAll([row('t','open',10),row('t','open',20),row('u','done',30)])
def metaCalls = []
def metadata = [getMetaClass:{ type ->
    metaCalls << type
    [title:type == 't' ? 'Заявка' : 'Запрос', hasWorkflow:true, hasAttribute:{ field -> field == 'minutes' }]
}, getStateTitle:{ type, code ->
    code == 'open' ? 'В работе' : 'Закрыта </script> & $1'
}]
def execute = { items, selection, text, boolean withModule = true, String origin = 'OBJECT_LIST' ->
    def messages = [], scripts = []
    def ctx = [source:origin,subjects:selection,list:items,api:[metainfo:metadata],
        result:[showMessage:{t,m ->messages << m},executeJavaScript:{js->scripts << js}]]
    if (withModule) ctx.modules = [nsdAnalyticsStudio:module]
    new GroovyShell(new Binding(ctx)).evaluate(text)
    [messages:messages,scripts:scripts]
}
def success = execute(rows, [rows.first()], action.replace("def metric = ''", "def metric = 'minutes'"))
assert success.messages.empty && success.scripts.size() == 1 && metaCalls == ['t','u']
assert !success.scripts[0].contains('secret_value_not_in_report')
// The browser suite exercises the emitted one-block action in a context without a module registry.
def oneBlock = execute(rows, [rows.first()], standalone.replace("def metric = ''", "def metric = 'minutes'"), false)
assert oneBlock == success
if (args.length) new File(args[0]).setText(oneBlock.scripts[0],'UTF-8')
assert execute(new StudioList(),[],standalone,false) == execute(new StudioList(),[],action)
assert execute(rows,null,standalone,false).scripts.empty
assert execute(null,[],standalone,false,'OBJECT_CARD').scripts.empty
assert execute(new StudioList(),[],action).scripts.size() == 1
assert execute(rows,null,action).scripts.empty
rows.truncated = true
assert execute(rows,[],action).messages.first().contains('1000')
assert execute(rows,[],standalone,false) == execute(rows,[],action)
for (def invalid in [[[v:new Object()]],[[v:[1,2]]], [['__proto__':'x']], [[v:'x'*16385]]]) {
    boolean rejected = false
    try {module.open(invalid,[:])} catch (IllegalArgumentException expected) {rejected=true}
    assert rejected
}
def invalidConfig = false
try {module.open([], [custom:new Object()])}
catch (IllegalArgumentException expected) {invalidConfig=true}
assert invalidConfig
def tooMany = false
try { module.open(Collections.nCopies(1001,[:]),[:]) }
catch (IllegalArgumentException expected) {tooMany=true}
assert tooMany
def tooLarge = false
try {module.open(Collections.nCopies(145,[v:'x'*16384]),[:])}
catch (IllegalArgumentException expected) {tooLarge=true}
assert tooLarge
println 'Both catalog-module and independent one-block actions passed: same output, table scope, projection and limits.'
