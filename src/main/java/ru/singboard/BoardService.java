package ru.singboard;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import jakarta.annotation.PostConstruct;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;

import java.time.ZoneId;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.util.*;

@Service
public class BoardService {
    private final Store store;
    private final SingularityGateway gateway;
    private final ChainTasks chains;
    private volatile long lastSuccess;
    private volatile long lastAttempt;
    private volatile String syncError = "";
    private volatile boolean syncing;
    private volatile boolean initialized;
    private int syncFailures;

    public BoardService(Store store, SingularityGateway gateway) {
        this.store = store;
        this.gateway = gateway;
        this.chains = new ChainTasks(store, gateway);
    }
    @PostConstruct
    void recover() { store.recover(); initialized = true; }

    @Scheduled(fixedDelay = 1000, initialDelay = 1000)
    public synchronized void tick() {
        if (!initialized) return;
        try {
            processNext();
            long interval = store.settings().path("syncSeconds").asLong(60) * 1000;
            long backoff = Math.min(900_000, interval * (1L << Math.min(syncFailures, 4)));
            if (System.currentTimeMillis() - lastAttempt >= backoff) sync();
        } catch (Exception e) {
            // Keep the scheduler alive without logging credentials or task contents.
            syncError = "Не удалось обработать очередь: " + safeMessage(e);
        }
    }
    public synchronized ObjectNode sync() {
        if (System.currentTimeMillis() - lastAttempt < 2000) return syncStatus();
        lastAttempt = System.currentTimeMillis();
        syncing = true;
        try {
            List<JsonNode> tasks = gateway.tasks();
            List<JsonNode> tags = gateway.tags();
            List<JsonNode> projects = gateway.projects();
            store.replaceSnapshot(tasks, tags, projects);
            rememberScenarioBranches();
            lastSuccess = System.currentTimeMillis();
            syncFailures = 0;
            syncError = "";
        } catch (Exception e) {
            syncFailures++;
            syncError = safeMessage(e);
        } finally { syncing = false; }
        return syncStatus();
    }
    private static String safeMessage(Exception e) {
        return e instanceof ApiFailure || e instanceof IllegalArgumentException ? e.getMessage() : "Внутренняя ошибка; данные сохранены";
    }
    public ObjectNode syncStatus() {
        return Json.object().put("running", syncing).put("lastSuccess", lastSuccess).put("error", syncError);
    }
    public ObjectNode board() {
        ObjectNode settings = store.settings();
        List<JsonNode> tags = store.cache("tag");
        ArrayNode projects = ScenarioCatalog.scenarios(settings, tags);
        ObjectNode board = Json.object().put("mode", store.mode());
        board.set("settings", settings);
        board.set("tasks", Json.MAPPER.valueToTree(store.cache("task")));
        board.set("tags", Json.MAPPER.valueToTree(tags));
        board.set("projects", projects);
        board.set("nativeProjects", Json.MAPPER.valueToTree(store.cache("project")));
        board.set("layouts", store.layouts());
        board.set("operations", Json.MAPPER.valueToTree(store.operations()));
        board.set("sync", syncStatus());
        return board;
    }
    static Set<String> descendants(List<JsonNode> tags, String root) {
        Set<String> found = new HashSet<>();
        if (root.isBlank()) return found;
        found.add(root);
        boolean changed;
        do {
            changed = false;
            for (JsonNode tag : tags) {
                if (found.contains(Json.text(tag, "parent"))) changed |= found.add(Json.text(tag, "id"));
            }
        } while (changed);
        found.remove(root);
        return found;
    }
    public synchronized ObjectNode settings(JsonNode patch) {
        Set<String> allowed = Set.of("rootTagId", "goalTagId", "fearTagId", "scenarioHierarchy", "chainTagId",
                "timezone", "syncSeconds", "xAxis", "yAxis", "axisLabels", "matrixBounds", "quadrants", "projectIds", "viewport");
        patch.fieldNames().forEachRemaining(k -> { if (!allowed.contains(k)) throw new IllegalArgumentException("Неизвестная настройка: " + k); });
        ObjectNode s = store.settings();
        String previousMarker = Json.text(s, "chainTagId");
        if (patch.has("rootTagId") && !Json.text(patch, "rootTagId").equals(Json.text(s, "rootTagId")))
            s.put("goalTagId", "").put("fearTagId", "").put("scenarioHierarchy", false);
        if (patch.has("rootTagId") && !Json.text(patch, "rootTagId").isBlank())
            requireActiveTag(Json.text(patch, "rootTagId"));
        patch.fields().forEachRemaining(e -> s.set(e.getKey(), e.getValue()));
        ScenarioCatalog.discover(s, store.cache("tag"));
        for (String key : List.of("goalTagId", "fearTagId")) {
            if (!patch.has("rootTagId") && !patch.has(key)) continue;
            if (!s.path(key).isTextual()) throw new IllegalArgumentException("Ветка сценариев должна задаваться ID тега");
            String id = Json.text(s, key);
            if (id.isBlank()) continue;
            JsonNode tag = store.cache("tag").stream().filter(t -> Json.text(t, "id").equals(id)).findFirst()
                    .orElseThrow(() -> new IllegalArgumentException("Ветка сценариев не найдена"));
            if (!Json.text(tag, "parent").equals(Json.text(s, "rootTagId")))
                throw new IllegalArgumentException("Ветки целей и опасений должны находиться непосредственно под корневым тегом");
        }
        if (!Json.text(s, "goalTagId").isBlank() && Json.text(s, "goalTagId").equals(Json.text(s, "fearTagId")))
            throw new IllegalArgumentException("Для целей и опасений нужны разные ветки");
        if (!s.path("scenarioHierarchy").isBoolean())
            throw new IllegalArgumentException("Режим дерева сценариев задаётся переключателем");
        String marker = Json.text(s, "chainTagId");
        if (!s.path("chainTagId").isTextual() || (!marker.isBlank() && !marker.equals(previousMarker)
                && !ChainTasks.markerCandidate(s, store.cache("tag"), marker)))
            throw new IllegalArgumentException("Выберите действующий тег цепочек вне дерева сценариев");
        try { ZoneId.of(Json.text(s, "timezone")); }
        catch (java.time.DateTimeException e) { throw new IllegalArgumentException("Неизвестный часовой пояс"); }
        if (s.path("syncSeconds").asInt() < 15 || s.path("syncSeconds").asInt() > 3600)
            throw new IllegalArgumentException("Интервал синхронизации: 15–3600 секунд");
        if (!s.path("quadrants").isArray() || s.path("quadrants").size() != 4)
            throw new IllegalArgumentException("Нужны четыре названия квадрантов");
        for (JsonNode q : s.path("quadrants")) if (!q.isTextual() || q.asText().isBlank() || q.asText().length() > 100)
            throw new IllegalArgumentException("Название квадранта: 1–100 символов");
        for (String key : List.of("xAxis", "yAxis")) if (!s.path(key).isTextual() || Json.text(s, key).length() > 100)
            throw new IllegalArgumentException("Подпись оси: до 100 символов");
        JsonNode labels = s.path("axisLabels");
        if (!labels.isObject() || labels.size() != 4) throw new IllegalArgumentException("Нужны четыре подписи направлений матрицы");
        for (String key : List.of("left", "right", "top", "bottom"))
            if (!labels.path(key).isTextual() || labels.path(key).asText().length() > 200)
                throw new IllegalArgumentException("Подпись направления: до 200 символов");
        JsonNode bounds = s.path("matrixBounds");
        if (!bounds.isObject() || bounds.size() != 4) throw new IllegalArgumentException("Нужны четыре внешние границы матрицы");
        for (String key : List.of("left", "top", "right", "bottom"))
            if (!bounds.path(key).isNumber() || !Double.isFinite(bounds.path(key).asDouble()) || Math.abs(bounds.path(key).asDouble()) > 110_000)
                throw new IllegalArgumentException("Некорректная граница матрицы");
        if (bounds.path("left").asDouble() > 0 || bounds.path("top").asDouble() > 0
                || bounds.path("right").asDouble() < 1100 || bounds.path("bottom").asDouble() < 900)
            throw new IllegalArgumentException("Границы должны сохранять минимальный размер квадрантов и положение осей");
        if (!s.path("projectIds").isArray()) throw new IllegalArgumentException("Область синхронизации должна быть списком ID");
        if (s.has("viewport")) {
            JsonNode v = s.path("viewport");
            for (String key : List.of("x", "y", "zoom"))
                if (!v.path(key).isNumber() || !Double.isFinite(v.path(key).asDouble()))
                    throw new IllegalArgumentException("Некорректное положение просмотра");
            if (v.path("zoom").asDouble() < 0.1 || v.path("zoom").asDouble() > 2)
                throw new IllegalArgumentException("Масштаб: 0.1–2");
        }
        store.settings(s);
        return s;
    }
    public synchronized void layout(String id, JsonNode patch) {
        ObjectNode current = store.layouts().has(id) ? Json.copy(store.layouts().path(id)) : Json.object();
        patch.fieldNames().forEachRemaining(k -> {
            if (!Set.of("x", "y", "width", "height", "hidden").contains(k)) throw new IllegalArgumentException("Неизвестное поле раскладки");
        });
        patch.fields().forEachRemaining(e -> current.set(e.getKey(), e.getValue()));
        for (String key : List.of("x", "y", "width", "height")) {
            if (current.has(key) && (!current.path(key).isNumber() || !Double.isFinite(current.path(key).asDouble()) || Math.abs(current.path(key).asDouble()) > 100_000))
                throw new IllegalArgumentException("Некорректный размер или координаты");
        }
        if (current.has("width") && (current.path("width").asDouble() < 170 || current.path("width").asDouble() > 1000)
                || current.has("height") && (current.path("height").asDouble() < 80 || current.path("height").asDouble() > 1000))
            throw new IllegalArgumentException("Размер карточки: ширина 170–1000, высота 80–1000");
        if (current.has("hidden") && !current.path("hidden").isBoolean()) throw new IllegalArgumentException("Некорректная видимость");
        store.layout(id, current);
    }
    public String createTask(JsonNode request) {
        String requestId = requestId(request);
        ObjectNode data = newTask(request, requestId);
        if (request.has("scenarioId")) {
            String scenarioId = Json.text(request, "scenarioId");
            if (!request.path("scenarioId").isTextual() || scenarioId.isBlank())
                throw new IllegalArgumentException("Укажите ID цели или опасения");
            if (!isActiveTaskScenario(scenarioId)
                    && store.operations().stream().noneMatch(op -> requestId.equals(Json.text(op, "id"))))
                throw new IllegalArgumentException("Выбранная цель или опасение больше недоступны");
            data.putArray("tags").add(scenarioId);
        }
        ObjectNode payload = Json.object().set("data", data);
        if (request.has("position")) {
            JsonNode p = request.path("position");
            if (!p.isObject()) throw new IllegalArgumentException("Некорректное положение карточки");
            for (String key : List.of("x", "y")) if (!p.path(key).isNumber() || !Double.isFinite(p.path(key).asDouble()) || Math.abs(p.path(key).asDouble()) > 100_000)
                throw new IllegalArgumentException("Некорректные координаты карточки");
            ObjectNode position = Json.object().put("x", p.path("x").asDouble()).put("y", p.path("y").asDouble())
                    .put("width", 250).put("height", 100);
            payload.set("layout", position);
        }
        return store.enqueue(requestId, "CREATE_TASK", "", payload);
    }

    private boolean isActiveTaskScenario(String id) {
        for (JsonNode scenario : ScenarioCatalog.scenarios(store.settings(), store.cache("tag"))) {
            if (id.equals(Json.text(scenario, "id")) && Json.available(scenario))
                return Set.of("goal", "fear").contains(Json.text(scenario, "scenarioType"));
        }
        return false;
    }

    private static ObjectNode newTask(JsonNode request, String requestId) {
        String title = Json.text(request, "title").strip();
        requireTitle(title);
        return Json.object().put("title", title).put("externalId", "singboard:" + requestId);
    }

    public String createChain(JsonNode request) {
        String requestId = requestId(request);
        String marker = chains.marker();
        ObjectNode data = newTask(request, requestId);
        data.set("tags", Json.array().add(marker));
        String project = Json.text(request, "projectId");
        if (!project.isBlank()) {
            if (store.cache("project").stream().noneMatch(p -> project.equals(Json.text(p, "id")) && Json.available(p)))
                throw new IllegalArgumentException("Проект Singularity недоступен");
            data.put("projectId", project);
        }
        return store.enqueue(requestId, "CREATE_TASK", "", Json.object().put("chainMarker", marker).set("data", data));
    }

    public String createChainStep(String id, JsonNode request) {
        chains.cachedChain(id);
        String requestId = requestId(request);
        ObjectNode payload = Json.object().put("chainId", id).put("afterId", afterStep(request));
        payload.set("data", newTask(request, requestId));
        return store.enqueue(requestId, "CREATE_TASK", "", payload);
    }

    public String moveChainStep(String id, String taskId, JsonNode request) {
        JsonNode chain = chains.cachedChain(id);
        ChainTasks.validateMove(chain, chains.cachedTask(taskId), chains.marker());
        String after = afterStep(request);
        if (taskId.equals(after)) throw new IllegalArgumentException("Выберите другой предыдущий шаг");
        JsonNode base = request.path("base");
        if (!(base.path("parent").isTextual() || base.path("parent").isNull())
                || !(base.path("parentOrder").isNumber() || base.path("parentOrder").isNull()))
            throw new IllegalArgumentException("Нужны исходные родитель и позиция шага");
        return store.enqueue("MOVE_STEP", taskId, Json.object().put("chainId", id).put("afterId", after).set("base", base));
    }

    private static String afterStep(JsonNode request) {
        if (!request.path("afterId").isTextual())
            throw new IllegalArgumentException("Выберите предыдущий шаг или начало цепочки");
        return Json.text(request, "afterId");
    }

    public String moveScenario(String id, JsonNode request) {
        if (!request.path("parentId").isTextual() || !request.path("base").isTextual())
            throw new IllegalArgumentException("Нужны текущий и новый родительские теги");
        String parent = ScenarioCatalog.moveTarget(store.settings(), store.cache("tag"), id, Json.text(request, "parentId"));
        ObjectNode payload = Json.object().set("changes", Json.object().put("parent", parent));
        payload.set("base", Json.object().put("parent", Json.text(request, "base")));
        return store.enqueue("MOVE_SCENARIO", id, payload);
    }
    public String createTag(JsonNode request) {
        String title = Json.text(request, "title").strip();
        requireTitle(title);
        String requestId = requestId(request);
        boolean root = request.path("root").asBoolean();
        ObjectNode data = Json.object().put("title", title);
        if (!root) {
            ObjectNode settings = store.settings();
            String type = Json.text(request, "scenarioType");
            if (!type.isBlank() && !Set.of("goal", "fear").contains(type))
                throw new IllegalArgumentException("Неизвестный тип сценария");
            String parent = Json.text(settings, "rootTagId");
            if (parent.isBlank()) throw new IllegalArgumentException("Сначала выберите корневой тег в настройках");
            if (!type.isBlank() && !request.path("branch").asBoolean()) {
                parent = Json.text(settings, type + "TagId");
                if (parent.isBlank()) throw new IllegalArgumentException("Сначала выберите ветку сценариев в настройках");
                String branchId = parent;
                if (store.cache("tag").stream().noneMatch(t -> Json.text(t, "id").equals(branchId)
                        && Json.text(t, "parent").equals(Json.text(settings, "rootTagId"))))
                    throw new IllegalArgumentException("Ветка сценариев перемещена из корня; проверьте настройки");
            }
            requireActiveTag(parent);
            data.put("parent", parent);
            if (request.path("branch").asBoolean()) {
                if (type.isBlank()) throw new IllegalArgumentException("Укажите тип ветки сценариев");
                if (!Json.text(settings, type + "TagId").isBlank()
                        && store.operations().stream().noneMatch(o -> Json.text(o, "id").equals(requestId)))
                    throw new IllegalArgumentException("Ветка уже выбрана");
                data.put("title", type.equals("goal") ? "Цели" : "Опасения");
            }
        }
        return store.enqueue(requestId, "CREATE_TAG", "", Json.object().set("data", data));
    }

    public synchronized String deleteTask(String id) {
        for (ObjectNode op : store.operations()) {
            if (id.equals(Json.text(op, "entityId")) && "DELETE_TASK".equals(Json.text(op, "kind"))
                    && !Set.of("DONE", "CANCELLED").contains(Json.text(op, "status")))
                return Json.text(op, "id");
        }
        JsonNode task = store.entity("entity_cache", "task", id);
        requireEditable(task);
        return store.enqueue("DELETE_TASK", id, Json.object().put("title", Json.text(task, "title")));
    }

    public String updateTask(String id, JsonNode request) {
        requireEditable(store.entity("entity_cache", "task", id));
        JsonNode changes = request.path("changes");
        JsonNode base = request.path("base");
        if (!changes.isObject() || changes.isEmpty() || !base.isObject()) throw new IllegalArgumentException("Нужны изменения и исходные значения");
        Set<String> allowed = Set.of("title", "note", "start", "deadline", "checked");
        changes.fields().forEachRemaining(e -> {
            String key = e.getKey();
            if (!allowed.contains(key) || !base.has(key)) throw new IllegalArgumentException("Недопустимое поле или отсутствует исходное значение: " + key);
            if (key.equals("title")) requireTitle(e.getValue().asText());
            else if (key.equals("note")) validateNote(e.getValue());
            else if (key.equals("checked")) {
                if (!e.getValue().isIntegralNumber() || !Set.of(0, 1).contains(e.getValue().asInt()))
                    throw new IllegalArgumentException("Допустимо завершить или возобновить задачу");
            } else validateDate(e.getValue());
        });
        return store.enqueue("PATCH_TASK", id, request);
    }
    public String tag(String id, String tagId, boolean add) {
        JsonNode task = store.entity("entity_cache", "task", id);
        String templateId = Json.text(task, "recurrenceGeneratorId");
        String targetId = templateId.isBlank() ? id : templateId;
        boolean series = Json.recurring(task);
        if (!templateId.isBlank()) {
            requireWritableTask(task);
            task = store.findEntity("entity_cache", "task", targetId)
                    .orElseThrow(() -> new IllegalArgumentException("Шаблон повторения недоступен. Обновите доску"));
        }
        requireScenarioTagTarget(task, series);
        if (add && !java.util.stream.StreamSupport.stream(ScenarioCatalog.scenarios(store.settings(), store.cache("tag")).spliterator(), false)
                .anyMatch(t -> Json.text(t, "id").equals(tagId)))
            throw new IllegalArgumentException("Тег не является сценарием доски");
        if (!add && !descendants(store.cache("tag"), Json.text(store.settings(), "rootTagId")).contains(tagId))
            throw new IllegalArgumentException("Тег не принадлежит ветке сценариев доски");
        requireActiveTag(tagId);
        ObjectNode intent = Json.object().put("tagId", tagId).put("add", add);
        if (series) intent.put("series", true);
        return store.enqueue("TAG", targetId, intent);
    }
    private void requireActiveTag(String id) {
        JsonNode tag = store.cache("tag").stream().filter(t -> Json.text(t, "id").equals(id)).findFirst()
                .orElseThrow(() -> new IllegalArgumentException("Тег не найден"));
        if (!Json.available(tag)) throw new IllegalArgumentException("Тег удалён во внешней системе");
    }
    private static String requestId(JsonNode request) {
        if (!request.has("requestId")) return UUID.randomUUID().toString();
        String id = Json.text(request, "requestId");
        try { if (!UUID.fromString(id).toString().equals(id)) throw new IllegalArgumentException(); }
        catch (IllegalArgumentException e) { throw new IllegalArgumentException("requestId должен быть UUID"); }
        return id;
    }
    private static void requireTitle(String title) {
        if (title.isBlank() || title.length() > 1000) throw new IllegalArgumentException("Название: 1–1000 символов");
    }
    private static void requireEditable(JsonNode task) {
        if (Json.recurring(task)) throw new IllegalArgumentException("Свойства повторяющейся задачи редактируются в Singularity");
        requireWritableTask(task);
    }
    private static void requireWritableTask(JsonNode task) {
        if (Json.hasText(task, "crypted")) throw new IllegalArgumentException("Зашифрованная задача доступна только для чтения");
        if (!Json.available(task)) throw new IllegalArgumentException("Задача удалена или недоступна");
    }
    private static void requireScenarioTagTarget(JsonNode task, boolean series) {
        requireWritableTask(task);
        if (Json.hasText(task, "recurrenceGeneratorId") || Json.recurring(task) != series
                || (series && (task.path("isNote").asBoolean() || Json.hasText(task, "journalDate")))) {
            throw new IllegalArgumentException("Тип задачи изменился или шаблон повторения недоступен. Обновите доску");
        }
    }
    private static void validateNote(JsonNode value) {
        if (!value.isTextual() || value.asText().length() > 200_000) throw new IllegalArgumentException("Некорректное описание");
        if (value.asText().isEmpty()) return;
        JsonNode delta = Json.read(value.asText());
        if (!delta.isArray()) throw new IllegalArgumentException("Описание должно быть JSON-массивом Quill Delta");
        for (JsonNode op : delta) if (!op.isObject() || !op.has("insert") || op.has("delete") || op.has("retain"))
            throw new IllegalArgumentException("Описание должно содержать только операции insert");
    }
    private static void validateDate(JsonNode value) {
        if (!value.isTextual()) throw new IllegalArgumentException("Дата должна быть строкой ISO 8601");
        String date = value.asText();
        if (date.isEmpty()) return;
        try { if (date.length() == 10) LocalDate.parse(date); else OffsetDateTime.parse(date); }
        catch (Exception e) { throw new IllegalArgumentException("Дата: ГГГГ-ММ-ДД или ISO 8601 со смещением"); }
    }
    private void state(ObjectNode op, String status, JsonNode detail, int attempts, long next) {
        store.operationState(Json.text(op, "id"), status, detail, attempts, next);
    }
    public synchronized void processNext() {
        List<ObjectNode> operations = store.operations();
        Set<String> blocked = new HashSet<>();
        for (ObjectNode op : operations) {
            String status = Json.text(op, "status");
            if (Set.of("DONE", "CANCELLED").contains(status)) continue;
            String entity = Json.text(op, "entityId");
            String lock = entity.isBlank() ? Json.text(op, "id") : entity;
            String chain = Json.text(op.path("payload"), "chainId");
            boolean available = blocked.add(lock);
            if (!chain.isBlank()) available = blocked.add(chain) && available;
            if (!available) continue;
            if (!status.equals("PENDING") || op.path("nextAttempt").asLong() > System.currentTimeMillis()) continue;
            execute(op);
            return;
        }
    }
    private void execute(ObjectNode op) {
        String kind = Json.text(op, "kind");
        String id = Json.text(op, "entityId");
        JsonNode payload = op.path("payload");
        int attempts = op.path("attempts").asInt() + 1;
        state(op, "SENDING", Json.object().put("message", "Отправляется"), attempts, 0);
        boolean creating = false;
        String createdId = "";
        try {
            if (kind.equals("DELETE_TASK")) {
                sendTaskDeletion(id);
                store.transaction(() -> {
                    store.deleteEntity("entity_cache", "task", id);
                    state(op, "DONE", Json.object().put("message", "Задача удалена").put("resultId", id), attempts, 0);
                });
                return;
            }
            JsonNode result;
            if (kind.equals("CREATE_TASK") || kind.equals("CREATE_TAG")) {
                ObjectNode data = Json.copy(payload.path("data"));
                String chainId = Json.text(payload, "chainId");
                if (!chainId.isBlank()) prepareChainStep(data, chainId, Json.text(payload, "afterId"));
                if (payload.has("chainMarker") && !chains.freshMarker().equals(Json.text(payload, "chainMarker")))
                    throw new IllegalArgumentException("Тег цепочек изменился. Создайте цепочку с выбранным тегом");
                if (kind.equals("CREATE_TASK") && !payload.has("chainMarker")) {
                    for (String tagId : tagSet(data.path("tags"))) requireActiveTag(tagId);
                }
                creating = true;
                result = kind.equals("CREATE_TASK") ? gateway.createTask(data) : gateway.createTag(data);
                if (!Json.hasText(result, "id")) throw new ApiFailure(0, false, "Ответ создания не содержит ID; требуется сверка");
                createdId = Json.text(result, "id");
                if (!chainId.isBlank()) {
                    store.putEntity("entity_cache", "task", result);
                    result = gateway.task(createdId);
                    chains.verifyStep(result, data, chainId, ChainOrder.order(data));
                } else {
                    store.putEntity("entity_cache", kind.equals("CREATE_TASK") ? "task" : "tag", result);
                }
                if (kind.equals("CREATE_TAG")) rememberScenarioBranches();
                if (payload.has("layout")) layout(createdId, payload.path("layout"));
                if (kind.equals("CREATE_TASK") && !creationTagsMatch(result, data))
                    throw new ApiFailure(0, false, "Задача создана. Проверьте её теги в Singularity");
            } else {
                result = switch (kind) {
                    case "MOVE_SCENARIO" -> sendScenarioMove(op, id, payload, attempts);
                    case "MOVE_STEP" -> sendStepMove(op, id, payload, attempts);
                    case "TAG" -> sendScenarioTag(id, payload);
                    default -> sendTaskEdit(op, id, payload, attempts);
                };
                if (result == null) return; // Conflict recorded by the operation handler.
            }
            state(op, "DONE", Json.object().put("message", "Сохранено").put("resultId", Json.text(result, "id")), attempts, 0);
        } catch (Exception e) {
            boolean ambiguous = creating && (!createdId.isBlank() || !(e instanceof ApiFailure f) || f.status == 0 || f.status >= 500);
            boolean retry = !creating && e instanceof ApiFailure f && f.retryable && attempts < 3;
            long delay = retry ? Math.max(1000L << attempts, ((ApiFailure) e).retryAfterMillis) : 0;
            ObjectNode detail = Json.object().put("message", safeMessage(e));
            if (!createdId.isBlank()) detail.put("resultId", createdId);
            state(op, ambiguous ? "UNCERTAIN" : retry ? "PENDING" : "ERROR", detail, attempts, System.currentTimeMillis() + delay);
        }
    }

    private void sendTaskDeletion(String id) {
        try {
            JsonNode fresh = gateway.task(id);
            if (!id.equals(Json.text(fresh, "id")))
                throw new ApiFailure(0, false, "Singularity вернул другую задачу. Обновите доску перед удалением");
            if (fresh.path("removed").asBoolean()) return;
            requireEditable(fresh);
            gateway.deleteTask(id);
        } catch (ApiFailure e) {
            // A previous attempt may have completed before its response was received.
            if (e.status != 404) throw e;
        }
    }

    private void prepareChainStep(ObjectNode data, String chainId, String afterId) {
        JsonNode parent = chains.freshChain(chainId);
        double order = chains.placementOrder(chainId, chains.steps(chainId), "", afterId);
        data.put("parent", chainId).put("parentOrder", order);
        for (String key : List.of("projectId", "group")) {
            if (Json.hasText(parent, key)) data.set(key, parent.path(key));
        }
    }

    private JsonNode sendScenarioMove(ObjectNode op, String id, JsonNode payload, int attempts) {
        List<JsonNode> tags = gateway.tags();
        JsonNode fresh = gateway.tag(id);
        String parent = ScenarioCatalog.moveTarget(store.settings(),
                tags.stream().map(t -> id.equals(Json.text(t, "id")) ? fresh : t).toList(),
                id, Json.text(payload.path("changes"), "parent"));
        store.putEntity("entity_cache", "tag", fresh);
        if (parent.equals(Json.text(fresh, "parent"))) return fresh;
        if (!equivalent(fresh.path("parent"), payload.path("base").path("parent"))) {
            ObjectNode values = values(payload.path("base").path("parent"), fresh.path("parent"), payload.path("changes").path("parent"));
            state(op, "CONFLICT", Json.object().set("conflicts", Json.object().set("parent", values)), attempts, 0);
            return null;
        }
        // TagUpdateDto declares title required. Use the latest title from Singularity.
        gateway.patchTag(id, Json.object().put("title", Json.text(fresh, "title")).put("parent", parent));
        JsonNode result = gateway.tag(id);
        store.putEntity("entity_cache", "tag", result);
        if (!parent.equals(Json.text(result, "parent")))
            throw new ApiFailure(0, false, "Родительский тег после записи отличается. Проверьте дерево в Singularity");
        return result;
    }

    private JsonNode sendStepMove(ObjectNode op, String id, JsonNode payload, int attempts) {
        String chainId = Json.text(payload, "chainId");
        String afterId = Json.text(payload, "afterId");
        JsonNode chain = chains.freshChain(chainId);
        JsonNode fresh = gateway.task(id);
        store.putEntity("entity_cache", "task", fresh);
        ChainTasks.validateMove(chain, fresh, chains.marker());
        List<JsonNode> steps = chains.steps(chainId);
        if (ChainTasks.immediatelyAfter(steps, id, afterId)) return fresh;
        JsonNode base = payload.path("base");
        double order = ChainOrder.order(fresh);
        ObjectNode conflicts = Json.object();
        if (!equivalent(fresh.path("parent"), base.path("parent")))
            conflicts.set("parent", values(base.path("parent"), fresh.path("parent"), chain.path("id")));
        if (order != ChainOrder.order(base))
            conflicts.set("parentOrder", values(base.path("parentOrder"), fresh.path("parentOrder"),
                    Json.MAPPER.getNodeFactory().textNode(afterId.isEmpty() ? "Начало цепочки" : "После шага " + afterId)));
        if (!conflicts.isEmpty()) {
            state(op, "CONFLICT", Json.object().set("conflicts", conflicts), attempts, 0);
            return null;
        }
        double rank = chains.placementOrder(chainId, steps, id, afterId);
        ObjectNode patch = Json.object().put("parentOrder", rank);
        if (!chainId.equals(Json.text(fresh, "parent"))) patch.put("parent", chainId);
        gateway.patchTask(id, patch);
        JsonNode result = gateway.task(id);
        chains.verifyStep(result, fresh, chainId, rank);
        return result;
    }

    private JsonNode sendScenarioTag(String id, JsonNode payload) {
        JsonNode fresh = gateway.task(id);
        if (!id.equals(Json.text(fresh, "id")))
            throw new ApiFailure(0, false, "Singularity вернул другую задачу. Обновите доску");
        requireScenarioTagTarget(fresh, payload.path("series").asBoolean());
        String tagId = Json.text(payload, "tagId");
        requireActiveTag(tagId);
        Set<String> tags = tagSet(fresh.path("tags"));
        boolean changed = payload.path("add").asBoolean() ? tags.add(tagId) : tags.remove(tagId);
        if (changed) {
            gateway.patchTask(id, Json.object().set("tags", Json.MAPPER.valueToTree(tags)));
            fresh = gateway.task(id);
            if (!id.equals(Json.text(fresh, "id")) || !tagSet(fresh.path("tags")).equals(tags))
                throw new ApiFailure(0, false, "Набор тегов после записи отличается; проверьте конфликт в Singularity");
        }
        store.putEntity("entity_cache", "task", fresh);
        return fresh;
    }

    private JsonNode sendTaskEdit(ObjectNode op, String id, JsonNode payload, int attempts) {
        JsonNode fresh = gateway.task(id);
        requireEditable(fresh);
        ObjectNode patch = Json.object();
        ObjectNode conflicts = Json.object();
        payload.path("changes").fields().forEachRemaining(e -> {
            String key = e.getKey();
            JsonNode current = fresh.path(key);
            JsonNode base = payload.path("base").path(key);
            if (!equivalent(current, base) && !equivalent(current, e.getValue()))
                conflicts.set(key, values(base, current, e.getValue()));
            if (!equivalent(current, e.getValue())) patch.set(key, e.getValue());
        });
        if (!conflicts.isEmpty()) {
            store.putEntity("entity_cache", "task", fresh);
            state(op, "CONFLICT", Json.object().set("conflicts", conflicts), attempts, 0);
            return null;
        }
        if (patch.has("start") && !patch.path("start").asText().isEmpty())
            patch.put("useTime", patch.path("start").asText().length() > 10);
        if (store.mode().equals("real") && ((patch.has("start") && patch.path("start").asText().isEmpty())
                || (patch.has("deadline") && patch.path("deadline").asText().isEmpty())))
            throw new IllegalArgumentException("Снятие даты в real пока не подтверждено API; снимите её в Singularity");
        boolean completion = patch.has("checked");
        int checked = patch.path("checked").asInt();
        patch.remove("checked");
        JsonNode result = patch.isEmpty() ? fresh : gateway.patchTask(id, patch);
        if (completion) result = gateway.complete(id, checked == 1);
        store.putEntity("entity_cache", "task", result);
        return result;
    }

    private static ObjectNode values(JsonNode before, JsonNode external, JsonNode ours) {
        ObjectNode values = Json.object();
        values.set("before", before);
        values.set("external", external);
        values.set("ours", ours);
        return values;
    }
    private void rememberScenarioBranches() {
        ObjectNode settings = store.settings();
        ObjectNode before = settings.deepCopy();
        ScenarioCatalog.discover(settings, store.cache("tag"));
        if (!before.equals(settings)) store.settings(settings);
    }
    static boolean equivalent(JsonNode a, JsonNode b) {
        if (a.equals(b)) return true;
        return (a.isMissingNode() || a.isNull() || a.isTextual() && a.asText().isEmpty())
                && (b.isMissingNode() || b.isNull() || b.isTextual() && b.asText().isEmpty());
    }
    private static Set<String> tagSet(JsonNode node) {
        Set<String> set = new LinkedHashSet<>();
        node.forEach(v -> set.add(v.asText()));
        return set;
    }
    public synchronized void resolve(String operationId, JsonNode request) {
        ObjectNode op = store.operation(operationId);
        String action = Json.text(request, "action");
        String status = Json.text(op, "status");
        if (Set.of("DONE", "CANCELLED", "SENDING").contains(status)) throw new IllegalArgumentException("Операция уже завершена или отправляется");
        if (action.equals("discard")) {
            state(op, "CANCELLED", Json.object().put("message", "Отменено пользователем; внешний результат не удалён"), op.path("attempts").asInt(), 0);
        } else if (Json.text(op, "kind").equals("CREATE_TASK") && action.equals("reconcile")) {
            String external = Json.text(op.path("payload").path("data"), "externalId");
            List<JsonNode> found = gateway.tasks().stream().filter(t -> Json.text(t, "externalId").equals(external)).toList();
            if (found.size() != 1) {
                state(op, "UNCERTAIN", Json.object().put("message", "Найдено совпадений externalId: " + found.size() + ". POST не повторён. Проверьте Singularity вручную"), op.path("attempts").asInt(), 0);
                return;
            }
            JsonNode task = found.getFirst();
            store.putEntity("entity_cache", "task", task);
            if (op.path("payload").has("layout")) layout(Json.text(task, "id"), op.path("payload").path("layout"));
            JsonNode payload = op.path("payload");
            if (!creationMatches(task, payload)) {
                state(op, "ERROR", Json.object().put("resultId", Json.text(task, "id"))
                        .put("message", "Задача найдена, но её место или тег отличаются. Проверьте найденную задачу в Singularity"),
                        op.path("attempts").asInt(), 0);
                return;
            }
            state(op, "DONE", Json.object().put("resultId", Json.text(task, "id")).put("message", "Найдена созданная задача"), op.path("attempts").asInt(), 0);
        } else if (Json.text(op, "kind").startsWith("CREATE_")) {
            throw new IllegalArgumentException("Повторное создание отключено. Сверьте результат или отмените операцию после ручной проверки");
        } else if (action.equals("ours") && status.equals("CONFLICT")) {
            String id = Json.text(op, "entityId");
            String kind = Json.text(op, "kind");
            JsonNode fresh = kind.equals("MOVE_SCENARIO") ? gateway.tag(id) : gateway.task(id);
            ObjectNode payload = Json.copy(op.path("payload"));
            ObjectNode base = Json.object();
            Iterator<String> fields = kind.equals("MOVE_STEP")
                    ? List.of("parent", "parentOrder").iterator() : payload.path("changes").fieldNames();
            fields.forEachRemaining(k -> base.set(k, fresh.get(k)));
            payload.set("base", base);
            store.operationPayload(operationId, payload);
            state(op, "PENDING", Json.object(), 0, 0);
        } else if (action.equals("retry") && status.equals("ERROR")) {
            state(op, "PENDING", Json.object(), 0, 0);
        } else throw new IllegalArgumentException("Недопустимое действие для этого состояния");
    }

    private static boolean creationTagsMatch(JsonNode task, JsonNode data) {
        return tagSet(task.path("tags")).containsAll(tagSet(data.path("tags")));
    }

    private boolean creationMatches(JsonNode task, JsonNode payload) {
        if (!creationTagsMatch(task, payload.path("data"))) return false;
        String chainId = Json.text(payload, "chainId");
        if (chainId.isEmpty()) return true;
        if (!chainId.equals(Json.text(task, "parent"))) return false;
        String afterId = Json.text(payload, "afterId");
        List<JsonNode> steps = chains.steps(chainId);
        if (!afterId.isEmpty() && steps.stream().noneMatch(step -> afterId.equals(Json.text(step, "id")))) return false;
        return ChainTasks.immediatelyAfter(steps, Json.text(task, "id"), afterId);
    }
}
