package ru.singboard;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;

import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/** Scenario types belong to tag branches; titles are only used for initial discovery. */
final class ScenarioCatalog {
    private ScenarioCatalog() { }

    static void discover(ObjectNode settings, List<JsonNode> tags) {
        String root = Json.text(settings, "rootTagId");
        if (root.isBlank()) return;
        for (String type : List.of("goal", "fear")) {
            String key = type + "TagId";
            if (!Json.text(settings, key).isBlank()) continue;
            String title = type.equals("goal") ? "Цели" : "Опасения";
            var matches = tags.stream().filter(t -> Json.available(t)
                    && Json.text(t, "parent").equals(root) && Json.text(t, "title").equals(title)).toList();
            if (matches.size() == 1) settings.put(key, Json.text(matches.getFirst(), "id"));
        }
    }

    static ArrayNode scenarios(ObjectNode settings, List<JsonNode> tags) {
        Set<String> all = BoardService.descendants(tags, Json.text(settings, "rootTagId"));
        String goal = Json.text(settings, "goalTagId"), fear = Json.text(settings, "fearTagId");
        Set<String> goals = all.contains(goal) ? BoardService.descendants(tags, goal) : Set.of();
        Set<String> fears = all.contains(fear) ? BoardService.descendants(tags, fear) : Set.of();
        ArrayNode result = Json.array();
        for (JsonNode tag : tags) {
            String id = Json.text(tag, "id");
            if (!all.contains(id) || id.equals(goal) || id.equals(fear)) continue;
            result.add(Json.copy(tag).put("scenarioType", goals.contains(id) ? "goal" : fears.contains(id) ? "fear" : "unclassified"));
        }
        return result;
    }

    static String moveTarget(ObjectNode settings, List<JsonNode> tags, String id, String target) {
        if (!settings.path("scenarioHierarchy").asBoolean())
            throw new IllegalArgumentException("Включите дерево сценариев в настройках");
        String root = Json.text(settings, "rootTagId");
        Map<String, JsonNode> active = new HashMap<>();
        for (JsonNode tag : tags) {
            if (Json.available(tag)) active.put(Json.text(tag, "id"), tag);
        }
        String branch = branchOf(active, root, id, Set.of());
        if (branch.isBlank() || branch.equals(id) || !active.containsKey(root)
                || (!branch.equals(Json.text(settings, "goalTagId")) && !branch.equals(Json.text(settings, "fearTagId"))))
            throw new IllegalArgumentException("Доступны сценарии из действующих веток целей и опасений");
        String parent = target.isBlank() ? branch : target;
        if (!branchOf(active, root, parent, Set.of(id)).equals(branch))
            throw new IllegalArgumentException("Выберите сценарий из той же ветки вне собственных потомков");
        return parent;
    }

    private static String branchOf(Map<String, JsonNode> active, String root, String id, Set<String> excluded) {
        Set<String> seen = new HashSet<>(excluded);
        while (!id.isBlank() && !id.equals(root) && active.containsKey(id) && seen.add(id)) {
            String parent = Json.text(active.get(id), "parent");
            if (parent.equals(root)) return id;
            id = parent;
        }
        return "";
    }
}
