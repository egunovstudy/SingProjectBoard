package ru.singboard;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.support.TransactionTemplate;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

@Repository
public class Store {
    private final JdbcTemplate jdbc;
    private final TransactionTemplate tx;
    private final String mode;
    private final String timezone;

    public Store(JdbcTemplate jdbc, TransactionTemplate tx, @Value("${app.mode}") String mode,
                 @Value("${app.timezone}") String timezone) {
        if (!List.of("demo", "real").contains(mode)) throw new IllegalArgumentException("APP_MODE: demo или real");
        this.jdbc = jdbc;
        this.tx = tx;
        this.mode = mode;
        this.timezone = timezone;
    }

    public String mode() { return mode; }

    public void transaction(Runnable action) { tx.executeWithoutResult(s -> action.run()); }

    public synchronized ObjectNode settings() {
        var rows = jdbc.queryForList("SELECT payload FROM board_setting WHERE mode=?", String.class, mode);
        if (!rows.isEmpty()) return axisDefaults(Json.copy(Json.read(rows.getFirst())));
        ObjectNode s = Json.object().put("rootTagId", "").put("timezone", timezone).put("syncSeconds", 60)
                .put("xAxis", "Если эту задачу сделать, то…").put("yAxis", "Если эту задачу не сделать, то…");
        s.set("quadrants", Json.array().add("Квадрант I").add("Квадрант II").add("Квадрант III").add("Квадрант IV"));
        s.set("projectIds", Json.array());
        s.set("viewport", Json.object().put("x", 150).put("y", 140).put("zoom", 0.65));
        axisDefaults(s);
        settings(s);
        return s;
    }

    private static ObjectNode axisDefaults(ObjectNode settings) {
        if (!settings.has("goalTagId")) settings.put("goalTagId", "");
        if (!settings.has("fearTagId")) settings.put("fearTagId", "");
        if (!settings.has("scenarioHierarchy")) settings.put("scenarioHierarchy", false);
        if (!settings.has("chainTagId")) settings.put("chainTagId", "");
        if (Json.text(settings, "xAxis").equals("Ось X")) settings.put("xAxis", "Если эту задачу сделать, то…");
        if (Json.text(settings, "yAxis").equals("Ось Y")) settings.put("yAxis", "Если эту задачу не сделать, то…");
        if (!settings.has("axisLabels")) settings.set("axisLabels", Json.object()
                .put("left", "Левая часть матрицы").put("right", "Правая часть матрицы")
                .put("top", "Верхняя часть матрицы").put("bottom", "Нижняя часть матрицы"));
        if (!settings.has("matrixBounds")) settings.set("matrixBounds", Json.object()
                .put("left", 0).put("top", 0).put("right", 1100).put("bottom", 900));
        return settings;
    }

    public void settings(JsonNode value) {
        tx.executeWithoutResult(s -> {
            if (jdbc.update("UPDATE board_setting SET payload=? WHERE mode=?", value.toString(), mode) == 0)
                jdbc.update("INSERT INTO board_setting(mode,payload) VALUES (?,?)", mode, value.toString());
        });
    }

    // Table names are fixed by callers, never provided through the HTTP API.
    public List<JsonNode> entities(String table, String kind) {
        return jdbc.query("SELECT payload FROM " + table + " WHERE mode=? AND kind=? ORDER BY id",
                (rs, i) -> Json.read(rs.getString(1)), mode, kind);
    }
    public JsonNode entity(String table, String kind, String id) {
        return findEntity(table, kind, id).orElseThrow(() -> new IllegalArgumentException("Объект не найден: " + id));
    }
    Optional<JsonNode> findEntity(String table, String kind, String id) {
        return jdbc.query("SELECT payload FROM " + table + " WHERE mode=? AND kind=? AND id=?",
                (rs, i) -> Json.read(rs.getString(1)), mode, kind, id).stream().findFirst();
    }
    void deleteEntity(String table, String kind, String id) {
        jdbc.update("DELETE FROM " + table + " WHERE mode=? AND kind=? AND id=?", mode, kind, id);
    }
    public void putEntity(String table, String kind, JsonNode value) {
        String id = Json.text(value, "id");
        if (id.isBlank()) throw new IllegalArgumentException("Ответ не содержит ID");
        tx.executeWithoutResult(s -> {
            String clear = table.equals("entity_cache") ? ", missing=FALSE" : "";
            if (jdbc.update("UPDATE " + table + " SET payload=?" + clear + " WHERE mode=? AND kind=? AND id=?",
                    value.toString(), mode, kind, id) == 0)
                jdbc.update("INSERT INTO " + table + "(mode,kind,id,payload) VALUES (?,?,?,?)", mode, kind, id, value.toString());
        });
    }
    public void replaceCache(String kind, List<JsonNode> values) {
        tx.executeWithoutResult(s -> {
            jdbc.update("UPDATE entity_cache SET missing=TRUE WHERE mode=? AND kind=?", mode, kind);
            values.forEach(v -> putEntity("entity_cache", kind, v));
        });
    }
    public void replaceSnapshot(List<JsonNode> tasks, List<JsonNode> tags, List<JsonNode> projects) {
        tx.executeWithoutResult(s -> {
            replaceCache("task", tasks);
            replaceCache("tag", tags);
            replaceCache("project", projects);
        });
    }
    public List<JsonNode> cache(String kind) {
        return jdbc.query("SELECT payload,missing FROM entity_cache WHERE mode=? AND kind=? ORDER BY id", (rs, i) -> {
            ObjectNode v = Json.copy(Json.read(rs.getString(1)));
            v.put("missing", rs.getBoolean(2) || v.path("removed").asBoolean());
            return v;
        }, mode, kind);
    }
    public ObjectNode layouts() {
        ObjectNode result = Json.object();
        jdbc.query("SELECT id,payload FROM board_layout WHERE mode=?", rs -> {
            result.set(rs.getString(1), Json.read(rs.getString(2)));
        }, mode);
        return result;
    }
    public void layout(String id, JsonNode value) {
        tx.executeWithoutResult(s -> {
            if (jdbc.update("UPDATE board_layout SET payload=? WHERE mode=? AND id=?", value.toString(), mode, id) == 0)
                jdbc.update("INSERT INTO board_layout(mode,id,payload) VALUES (?,?,?)", mode, id, value.toString());
        });
    }
    public String enqueue(String kind, String entityId, JsonNode payload) {
        return enqueue(UUID.randomUUID().toString(), kind, entityId, payload);
    }
    public String enqueue(String id, String kind, String entityId, JsonNode payload) {
        try {
            jdbc.update("INSERT INTO board_operation(id,mode,entity_id,kind,status,payload,detail,created_at) VALUES (?,?,?,?,?,?,?,?)",
                    id, mode, entityId, kind, "PENDING", payload.toString(), "{}", System.currentTimeMillis());
        } catch (org.springframework.dao.DuplicateKeyException e) {
            ObjectNode existing = operation(id);
            if (!Json.text(existing, "kind").equals(kind) || !Json.text(existing, "entityId").equals(entityId)
                    || !existing.path("payload").equals(payload))
                throw new IllegalArgumentException("Этот идентификатор запроса уже использован для другого изменения");
        }
        return id;
    }
    public List<ObjectNode> operations() {
        return jdbc.query("SELECT * FROM board_operation WHERE mode=? ORDER BY queue_order", (rs, i) -> {
            ObjectNode v = Json.object().put("id", rs.getString("id")).put("entityId", rs.getString("entity_id"))
                    .put("kind", rs.getString("kind")).put("status", rs.getString("status"))
                    .put("attempts", rs.getInt("attempts")).put("createdAt", rs.getLong("created_at"))
                    .put("nextAttempt", rs.getLong("next_attempt"));
            v.set("payload", Json.read(rs.getString("payload")));
            v.set("detail", Json.read(rs.getString("detail")));
            return v;
        }, mode);
    }
    public ObjectNode operation(String id) {
        return operations().stream().filter(o -> Json.text(o, "id").equals(id)).findFirst()
                .orElseThrow(() -> new IllegalArgumentException("Операция не найдена"));
    }
    public void operationState(String id, String status, JsonNode detail, int attempts, long next) {
        jdbc.update("UPDATE board_operation SET status=?,detail=?,attempts=?,next_attempt=? WHERE mode=? AND id=?",
                status, detail.toString(), attempts, next, mode, id);
    }
    public void operationPayload(String id, JsonNode payload) {
        jdbc.update("UPDATE board_operation SET payload=? WHERE mode=? AND id=?", payload.toString(), mode, id);
    }
    public void recover() {
        jdbc.update("UPDATE board_operation SET status=CASE WHEN kind IN ('CREATE_TASK','CREATE_TAG') THEN 'UNCERTAIN' ELSE 'PENDING' END, detail=? WHERE mode=? AND status='SENDING'",
                Json.object().put("message", "Приложение остановилось во время отправки; требуется сверка результата").toString(), mode);
    }
}
