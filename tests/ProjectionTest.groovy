import groovy.json.JsonSlurper

int reads = 0
def secret = new Object()
def source = [[id:'A', n:2, forbidden:secret], [id:'B', n:3, forbidden:secret]]
def json = AnalyticsPayload.encode(source, ['id','n','forbidden'],
    { o -> o.id == 'A' }, { o, code -> code != 'forbidden' },
    { o, code -> reads++; o[code] })
assert reads == 2
assert new JsonSlurper().parseText(json) == [[id:'A',n:2]]
def encode = { value ->
    AnalyticsPayload.encode([[v:value]], ['v'], { true }, { r, c -> true }, { r,c -> r[c] })
}
assert new JsonSlurper().parseText(encode([label:'<пример>', values:[false,null,-3], date:new Date(0)]))[0].v.date == 0
assert new JsonSlurper().parseText(encode(Double.NaN))[0].v == null
for (v in [secret, ['constructor':'reserved'], 'x'*16385, new HashSet([1])]) {
    boolean refused = false
    try { encode(v) } catch (IllegalArgumentException expected) { refused = true }
    assert refused
}
assert AnalyticsPayload.encode([], ['n'], {true}, {r,c->true}, {r,c->r[c]}) == '[]'
println 'Groovy DTO projection, row/field authorization, JSON types and rejection limits passed.'
