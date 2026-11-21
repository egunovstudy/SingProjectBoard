package ru.singboard;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;

public final class Json {
    public static final ObjectMapper MAPPER = new ObjectMapper();
    private Json() {}

    public static ObjectNode object() { return MAPPER.createObjectNode(); }
    public static ArrayNode array() { return MAPPER.createArrayNode(); }
    public static JsonNode read(String value) {
        try { return MAPPER.readTree(value); }
        catch (Exception e) { throw new IllegalArgumentException("Некорректный JSON"); }
    }
    public static String text(JsonNode node, String key) { return node.path(key).asText(""); }
    public static boolean hasText(JsonNode node, String key) { return !text(node, key).isBlank(); }
    static boolean available(JsonNode node) {
        return !node.path("missing").asBoolean() && !node.path("removed").asBoolean() && !hasText(node, "deleteDate");
    }
    public static ObjectNode copy(JsonNode node) { return (ObjectNode) node.deepCopy(); }
    public static String delta(String text) {
        return array().add(object().put("insert", text.endsWith("\n") ? text : text + "\n")).toString();
    }
    public static boolean recurring(JsonNode task) {
        return (task.hasNonNull("recurrence") && !task.path("recurrence").isEmpty())
                || hasText(task, "recurrenceGeneratorId");
    }
}
