package ru.singboard;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;

import java.util.List;
import java.util.OptionalDouble;

final class ChainTasks {
    private final Store store;
    private final SingularityGateway gateway;

    ChainTasks(Store store, SingularityGateway gateway) {
        this.store = store;
        this.gateway = gateway;
    }

    static boolean markerCandidate(ObjectNode settings, List<JsonNode> tags, String id) {
        String root = Json.text(settings, "rootTagId");
        return !id.isBlank() && !id.equals(root) && !BoardService.descendants(tags, root).contains(id)
                && tags.stream().anyMatch(t -> id.equals(Json.text(t, "id")) && Json.available(t));
    }

    String marker() {
        ObjectNode settings = store.settings();
        String id = Json.text(settings, "chainTagId");
        if (!markerCandidate(settings, store.cache("tag"), id))
            throw new IllegalArgumentException("Выберите действующий тег цепочек вне дерева сценариев в настройках");
        return id;
    }

    String freshMarker() {
        String id = marker();
        if (!Json.available(gateway.tag(id)))
            throw new IllegalArgumentException("Тег цепочек недоступен в Singularity");
        return id;
    }

    JsonNode cachedTask(String id) {
        return store.cache("task").stream().filter(t -> id.equals(Json.text(t, "id"))).findFirst()
                .orElseThrow(() -> new IllegalArgumentException("Задача не найдена"));
    }

    JsonNode cachedChain(String id) {
        return requireChain(cachedTask(id), marker());
    }

    JsonNode freshChain(String id) {
        return requireChain(gateway.task(id), freshMarker());
    }

    private static JsonNode requireChain(JsonNode task, String marker) {
        if (!ChainOrder.ordinaryTask(task) || Json.hasText(task, "crypted") || Json.hasText(task, "parent")
                || task.path("tags").valueStream().noneMatch(tag -> marker.equals(tag.asText())))
            throw new IllegalArgumentException("Родительская задача больше не является доступной цепочкой");
        return task;
    }

    static void validateMove(JsonNode chain, JsonNode step, String marker) {
        String chainId = Json.text(chain, "id");
        String parent = Json.text(step, "parent");
        if (!ChainOrder.ordinaryTask(step) || Json.hasText(step, "crypted"))
            throw new IllegalArgumentException("В Орбите можно переставлять доступные разовые задачи");
        if (chainId.equals(Json.text(step, "id")) || (parent.isBlank()
                && step.path("tags").valueStream().anyMatch(tag -> marker.equals(tag.asText()))))
            throw new IllegalArgumentException("Цепочку нельзя добавить в качестве шага");
        if (!parent.isBlank() && !parent.equals(chainId))
            throw new IllegalArgumentException("У задачи уже есть родитель. Измените её вложенность в Singularity");
        if (parent.isBlank() && !sameLocation(chain, step))
            throw new IllegalArgumentException("Задача и цепочка должны быть в одном проекте и разделе Singularity");
        if (parent.isBlank() && !Json.hasText(chain, "projectId"))
            throw new IllegalArgumentException("Готовую задачу без проекта можно связать стрелкой на доске. В цепочке можно создать новый шаг");
    }

    List<JsonNode> steps(String chainId) {
        return ChainOrder.steps(gateway.childTasks(chainId), chainId);
    }

    static boolean immediatelyAfter(List<JsonNode> steps, String stepId, String afterId) {
        int index = ChainOrder.insertionIndex(steps, afterId);
        return index < steps.size() && stepId.equals(Json.text(steps.get(index), "id"));
    }

    double placementOrder(String chainId, List<JsonNode> steps, String movingId, String afterId) {
        OptionalDouble rank = position(steps, movingId, afterId);
        if (rank.isPresent()) return rank.getAsDouble();
        spread(steps);
        return position(steps(chainId), movingId, afterId).orElseThrow(() ->
                new IllegalArgumentException("Порядок подзадач изменился в Singularity. Обновите цепочку и повторите"));
    }

    private static OptionalDouble position(List<JsonNode> steps, String movingId, String afterId) {
        List<JsonNode> neighbors = steps.stream().filter(task -> !movingId.equals(Json.text(task, "id"))).toList();
        return ChainOrder.rank(neighbors, ChainOrder.insertionIndex(neighbors, afterId));
    }

    private void spread(List<JsonNode> steps) {
        List<ChainOrder.RankChange> changes = ChainOrder.spread(steps);
        if (changes.stream().anyMatch(c -> Json.hasText(c.task(), "crypted")))
            throw new IllegalArgumentException("В цепочке совпадают позиции зашифрованных шагов. Расставьте шаги в Singularity");
        for (var change : changes) {
            String id = Json.text(change.task(), "id");
            JsonNode current = gateway.task(id);
            if (!ChainOrder.ordinaryTask(current) || Json.hasText(current, "crypted")
                    || !BoardService.equivalent(current.path("parent"), change.task().path("parent"))
                    || ChainOrder.order(current) != ChainOrder.order(change.task()))
                throw new IllegalArgumentException("Шаг изменился в Singularity. Обновите цепочку и повторите");
            gateway.patchTask(id, Json.object().put("parentOrder", change.order()));
            verifyStep(gateway.task(id), current, Json.text(current, "parent"), change.order());
        }
    }

    void verifyStep(JsonNode result, JsonNode original, String chainId, double order) {
        store.putEntity("entity_cache", "task", result);
        if (!chainId.equals(Json.text(result, "parent")) || !result.path("parentOrder").isNumber()
                || order != ChainOrder.order(result) || !sameLocation(original, result))
            throw new ApiFailure(0, false, "Singularity вернул другой порядок или расположение шага. Сверьте цепочку");
    }

    static void copyLocation(JsonNode from, ObjectNode to) {
        for (String key : List.of("projectId", "group")) {
            if (Json.hasText(from, key)) to.set(key, from.path(key));
        }
    }

    static boolean sameLocation(JsonNode a, JsonNode b) {
        return BoardService.equivalent(a.path("projectId"), b.path("projectId"))
                && BoardService.equivalent(a.path("group"), b.path("group"));
    }
}
