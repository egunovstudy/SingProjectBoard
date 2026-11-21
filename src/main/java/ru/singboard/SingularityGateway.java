package ru.singboard;

import com.fasterxml.jackson.databind.JsonNode;
import java.util.List;

public interface SingularityGateway {
    List<JsonNode> tasks();
    List<JsonNode> childTasks(String parent);
    List<JsonNode> tags();
    List<JsonNode> projects();
    JsonNode task(String id);
    void deleteTask(String id);
    JsonNode patchTask(String id, JsonNode patch);
    JsonNode complete(String id, boolean complete);
    JsonNode createTask(JsonNode payload);
    JsonNode createTag(JsonNode payload);
    JsonNode tag(String id);
    JsonNode patchTag(String id, JsonNode patch);
}
