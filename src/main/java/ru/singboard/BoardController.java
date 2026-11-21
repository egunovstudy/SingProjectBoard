package ru.singboard;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api")
public class BoardController {
    private final BoardService service;
    private final JdbcTemplate jdbc;
    public BoardController(BoardService service, JdbcTemplate jdbc) { this.service = service; this.jdbc = jdbc; }
    @GetMapping("/health") public ObjectNode health() { jdbc.queryForObject("SELECT 1", Integer.class); return Json.object().put("status", "UP"); }
    @GetMapping("/board") public ObjectNode board() { return service.board(); }
    @PostMapping("/sync") public ObjectNode sync() { return service.sync(); }
    @PatchMapping("/settings") public ObjectNode settings(@RequestBody JsonNode data) { return service.settings(data); }
    @PutMapping("/layouts/{id}") public void layout(@PathVariable String id, @RequestBody JsonNode data) { service.layout(id, data); }
    @PostMapping("/tasks") public ObjectNode create(@RequestBody JsonNode data) { return queued(service.createTask(data)); }
    @PatchMapping("/tasks/{id}") public ObjectNode patch(@PathVariable String id, @RequestBody JsonNode data) { return queued(service.updateTask(id, data)); }
    @DeleteMapping("/tasks/{id}")
    public ObjectNode delete(@PathVariable String id) { return queued(service.deleteTask(id)); }
    @PostMapping("/tasks/{id}/tags") public ObjectNode tag(@PathVariable String id, @RequestBody JsonNode data) {
        return queued(service.tag(id, Json.text(data, "tagId"), data.path("add").asBoolean()));
    }
    @PostMapping("/tags") public ObjectNode tag(@RequestBody JsonNode data) { return queued(service.createTag(data)); }
    @PatchMapping("/tags/{id}/parent")
    public ObjectNode scenarioParent(@PathVariable String id, @RequestBody JsonNode data) {
        return queued(service.moveScenario(id, data));
    }
    @PostMapping("/chains")
    public ObjectNode chain(@RequestBody JsonNode data) { return queued(service.createChain(data)); }
    @PostMapping("/chains/{id}/steps")
    public ObjectNode step(@PathVariable String id, @RequestBody JsonNode data) {
        return queued(service.createChainStep(id, data));
    }
    @PatchMapping("/chains/{id}/steps/{taskId}")
    public ObjectNode moveStep(@PathVariable String id, @PathVariable String taskId, @RequestBody JsonNode data) {
        return queued(service.moveChainStep(id, taskId, data));
    }
    @PostMapping("/operations/{id}") public void resolve(@PathVariable String id, @RequestBody JsonNode data) { service.resolve(id, data); }
    private ObjectNode queued(String id) { return Json.object().put("operationId", id).put("status", "PENDING"); }
}
