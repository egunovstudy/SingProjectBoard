package ru.singboard;

import com.fasterxml.jackson.databind.JsonNode;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.OptionalDouble;

final class ChainOrder {
    private static final int GAP = 1024;

    private ChainOrder() { }

    static boolean ordinaryTask(JsonNode task) {
        return Json.available(task) && !task.path("isNote").asBoolean()
                && !Json.hasText(task, "journalDate") && !Json.recurring(task);
    }

    static List<JsonNode> steps(List<JsonNode> tasks, String parent) {
        return tasks.stream()
                .filter(t -> ordinaryTask(t) && Json.text(t, "parent").equals(parent))
                .sorted(Comparator.comparingDouble(ChainOrder::order).thenComparing(t -> Json.text(t, "id")))
                .toList();
    }

    static int insertionIndex(List<JsonNode> steps, String afterId) {
        if (afterId.isBlank()) return 0;
        for (int i = 0; i < steps.size(); i++) {
            if (Json.text(steps.get(i), "id").equals(afterId)) return i + 1;
        }
        throw new IllegalArgumentException("Предыдущий шаг больше не входит в цепочку. Выберите новое место");
    }

    static OptionalDouble rank(List<JsonNode> steps, int index) {
        if (steps.isEmpty()) return OptionalDouble.of(GAP);
        double lower = index == 0 ? Double.NEGATIVE_INFINITY : order(steps.get(index - 1));
        double upper = index == steps.size() ? Double.POSITIVE_INFINITY : order(steps.get(index));
        double rank = index == 0 ? Math.min(upper - GAP, Math.nextDown(upper))
                : index == steps.size() ? Math.max(lower + GAP, Math.nextUp(lower))
                : lower / 2 + upper / 2;
        return Double.isFinite(rank) && lower < rank && rank < upper
                ? OptionalDouble.of(rank) : OptionalDouble.empty();
    }

    // Lower existing ranks from the front, then raise ranks from the end.
    // The visible step order survives interruption between any two writes.
    static List<RankChange> spread(List<JsonNode> steps) {
        List<RankChange> changes = new ArrayList<>();
        for (int i = 0; i < steps.size(); i++) {
            double rank = (i + 1.0) * GAP;
            if (rank < order(steps.get(i))) changes.add(new RankChange(steps.get(i), rank));
        }
        for (int i = steps.size() - 1; i >= 0; i--) {
            double rank = (i + 1.0) * GAP;
            if (rank > order(steps.get(i))) changes.add(new RankChange(steps.get(i), rank));
        }
        return changes;
    }

    static double order(JsonNode task) {
        JsonNode value = task.path("parentOrder");
        double order = value.isNumber() ? value.asDouble() : 0;
        return Double.isFinite(order) ? order + 0.0 : 0;
    }

    record RankChange(JsonNode task, double order) { }
}
