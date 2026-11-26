import groovy.json.JsonOutput
import java.nio.charset.StandardCharsets

/** Receives a bounded projection supplied by the host under the current user's ACL. */
class AnalyticsPayload {
    static final int MAX_ROWS = 100000
    static final int MAX_BYTES = 16 * 1024 * 1024

    static String encode(Iterable records, Collection<String> requestedFields,
                         Closure<Boolean> mayReadRow, Closure<Boolean> mayReadField,
                         Closure readProjectedField) {
        if (!records || requestedFields == null) {
            if (records == null || requestedFields == null) throw new IllegalArgumentException('Missing input')
        }
        List<String> names = requestedFields.toList().unique()
        if (names.size() > 96 || !names.every { validKey(it) }) throw new IllegalArgumentException('Invalid field list')
        StringBuilder out = new StringBuilder('[')
        int count = 0, visited = 0, bytes = 2
        for (record in records) {
            if (++visited > MAX_ROWS) throw new IllegalArgumentException('Source row limit exceeded')
            if (mayReadRow.call(record) != true) continue
            Map dto = [:]
            for (String field in names) {
                if (mayReadField.call(record, field) == true) {
                    dto[field] = clean(readProjectedField.call(record, field), 0, [nodes: 0])
                }
            }
            String entry = JsonOutput.toJson(dto)
            bytes += entry.getBytes(StandardCharsets.UTF_8).length + (count ? 1 : 0)
            if (bytes > MAX_BYTES) throw new IllegalArgumentException('Payload byte limit exceeded')
            if (count++) out.append(',')
            out.append(entry)
        }
        out.append(']').toString()
    }

    private static boolean validKey(Object k) {
        k instanceof String && k.size() > 0 && k.size() <= 128 &&
            k.split('\\.', -1).every { it && !(it in ['__proto__','constructor','prototype']) } &&
            !(k =~ /[\x00-\x1f]/).find()
    }

    private static Object clean(Object v, int depth, Map budget) {
        if (++budget.nodes > 1024 || depth > 8) throw new IllegalArgumentException('Attribute too complex')
        if (v == null || v instanceof Boolean) return v
        if (v instanceof String && v.size() <= 16384) return v
        if (v instanceof Number) return Double.isFinite(v.doubleValue()) ? v : null
        if (v instanceof Date) return v.time
        if (v instanceof UUID) return v.toString()
        if ((v instanceof ArrayList || v instanceof LinkedList) && v.size() <= 128) {
            return v.collect { clean(it, depth + 1, budget) }
        }
        if ((v.getClass() == LinkedHashMap || v.getClass() == HashMap) && v.size() <= 96) {
            Map result = [:]
            v.each { key, value ->
                if (!validKey(key)) throw new IllegalArgumentException('Invalid nested key')
                result[key] = clean(value, depth + 1, budget)
            }
            return result
        }
        throw new IllegalArgumentException('Supply a projected scalar, Map or List')
    }
}
