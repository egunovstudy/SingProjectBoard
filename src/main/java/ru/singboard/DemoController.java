package ru.singboard;

import com.fasterxml.jackson.databind.JsonNode;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/demo/external")
@ConditionalOnProperty(name = "app.mode", havingValue = "demo", matchIfMissing = true)
public class DemoController {
    private final DemoSingularityGateway demo;
    public DemoController(DemoSingularityGateway demo) { this.demo = demo; }
    @PostMapping("/tasks") public JsonNode create(@RequestBody JsonNode data) { return demo.createTask(data); }
    @PatchMapping("/tasks/{id}") public JsonNode task(@PathVariable String id, @RequestBody JsonNode data) { return demo.patchTask(id, data); }
    @PatchMapping("/tags/{id}") public JsonNode tag(@PathVariable String id, @RequestBody JsonNode data) { return demo.patchTag(id, data); }
}
