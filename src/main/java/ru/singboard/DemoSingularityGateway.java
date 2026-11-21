package ru.singboard;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Component;

import jakarta.annotation.PostConstruct;
import java.util.List;
import java.util.UUID;

@Component
@ConditionalOnProperty(name = "app.mode", havingValue = "demo", matchIfMissing = true)
public class DemoSingularityGateway implements SingularityGateway {
    private final Store store;
    public DemoSingularityGateway(Store store) { this.store = store; }

    @PostConstruct
    void seed() { store.transaction(this::seedData); }

    private void seedData() {
        if (!store.entities("remote_entity", "meta").isEmpty()) return;
        // Respect demo data created by older builds as well.
        if (!tags().isEmpty()) {
            save("meta", Json.object().put("id", "seeded"));
            return;
        }
        save("tag", Json.object().put("id", "A-root").put("title", "Проекты доски"));
        save("tag", Json.object().put("id", "A-goals").put("title", "Цели").put("parent", "A-root"));
        save("tag", Json.object().put("id", "A-fears").put("title", "Опасения").put("parent", "A-root"));
        String[] names = {"Продукт приносит пользу", "Теряю важные файлы", "Осваиваю новые навыки", "Дом требует срочного ремонта"};
        for (int i = 0; i < names.length; i++)
            save("tag", Json.object().put("id", "A-project-" + i).put("title", names[i]).put("parent", i % 2 == 0 ? "A-goals" : "A-fears"));
        save("tag", Json.object().put("id", "A-ordinary").put("title", "Обсудить"));
        save("tag", Json.object().put("id", "A-phone").put("title", "С телефона"));
        save("tag", Json.object().put("id", "A-chain").put("title", "Цепочка"));
        save("project", Json.object().put("id", "P-demo").put("title", "Входящие Singularity"));
        String[] titles = {"Набросать идею нового сервиса", "Подготовить демо для команды", "Разобрать заметки со встречи", "Запланировать выходные", "Записаться на тренировку", "Прочитать главу о системном дизайне", "Попробовать React Flow", "Обновить домашнюю библиотеку", "Заказать лампу для рабочего стола", "Собрать обратную связь", "Проверить резервную копию", "Изучить новый маршрут", "Задача с телефона", "Небольшая идея на потом"};
        for (int i = 0; i < titles.length; i++) {
            ObjectNode t = Json.object().put("id", "T-demo-" + i).put("title", titles[i])
                    .put("note", Json.delta(i == 0 ? "Одна задача может быть связана с несколькими сценариями обоих типов." : ""))
                    .put("checked", i == 10 ? 1 : 0).put("projectId", "P-demo").put("useTime", false);
            var tags = Json.array().add("A-project-" + (i % 4));
            if (i == 0) tags.add("A-project-2").add("A-ordinary").add("A-phone");
            t.set("tags", tags);
            save("task", t);
            if (i < 12) {
                int q = i / 3;
                store.layout(Json.text(t, "id"), Json.object().put("x", 80 + (q % 2) * 550 + (i % 3) * 32)
                        .put("y", 120 + (q / 2) * 450 + (i % 3) * 125).put("width", 250).put("height", 100).put("hidden", false));
            }
        }
        ObjectNode s = store.settings();
        s.put("rootTagId", "A-root").put("chainTagId", "A-chain");
        store.settings(s);
        save("meta", Json.object().put("id", "seeded"));
    }
    private JsonNode save(String kind, ObjectNode value) {
        value.put("modificatedDate", Long.toString(System.currentTimeMillis()));
        store.putEntity("remote_entity", kind, value);
        return value;
    }
    @Override public List<JsonNode> tasks() { return store.entities("remote_entity", "task").stream().filter(t -> !t.path("removed").asBoolean()).toList(); }
    @Override
    public List<JsonNode> childTasks(String parent) {
        return tasks().stream().filter(t -> Json.text(t, "parent").equals(parent)).toList();
    }
    @Override public List<JsonNode> tags() { return store.entities("remote_entity", "tag").stream().filter(t -> !t.path("removed").asBoolean()).toList(); }
    @Override public List<JsonNode> projects() { return store.entities("remote_entity", "project"); }
    @Override
    public JsonNode task(String id) {
        return store.findEntity("remote_entity", "task", id)
                .orElseThrow(() -> new ApiFailure(404, false, "Задача не найдена"));
    }
    @Override public void deleteTask(String id) { store.deleteEntity("remote_entity", "task", id); }
    @Override public JsonNode patchTask(String id, JsonNode patch) {
        ObjectNode task = Json.copy(task(id));
        patch.fields().forEachRemaining(e -> task.set(e.getKey(), e.getValue()));
        return save("task", task);
    }
    @Override public JsonNode complete(String id, boolean complete) { return patchTask(id, Json.object().put("checked", complete ? 1 : 0)); }
    @Override public JsonNode createTask(JsonNode payload) {
        ObjectNode t = Json.copy(payload);
        t.put("id", "T-" + UUID.randomUUID()).put("checked", 0).put("useTime", false);
        if (!t.has("tags")) t.set("tags", Json.array());
        return save("task", t);
    }
    @Override public JsonNode createTag(JsonNode payload) {
        return save("tag", Json.copy(payload).put("id", "A-" + UUID.randomUUID()));
    }
    @Override public JsonNode tag(String id) { return store.entity("remote_entity", "tag", id); }
    @Override
    public JsonNode patchTag(String id, JsonNode patch) {
        ObjectNode tag = Json.copy(tag(id));
        patch.fields().forEachRemaining(e -> tag.set(e.getKey(), e.getValue()));
        return save("tag", tag);
    }
}
