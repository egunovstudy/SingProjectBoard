package ru.singboard;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import liquibase.integration.spring.SpringLiquibase;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DataSourceTransactionManager;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.transaction.support.TransactionTemplate;

import java.util.List;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicInteger;

import static org.assertj.core.api.Assertions.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

class BoardServiceTest {
    Store store;
    DemoSingularityGateway demo;
    BoardService service;
    JdbcTemplate jdbc;

    @BeforeEach
    void setup() throws Exception {
        var ds = new DriverManagerDataSource("jdbc:h2:mem:" + UUID.randomUUID() + ";MODE=PostgreSQL;DB_CLOSE_DELAY=-1", "sa", "");
        var migration = new SpringLiquibase();
        migration.setDataSource(ds);
        migration.setChangeLog("classpath:db/changelog/master.xml");
        migration.afterPropertiesSet();
        jdbc = new JdbcTemplate(ds);
        store = new Store(jdbc, new TransactionTemplate(new DataSourceTransactionManager(ds)), "demo", "Europe/Moscow");
        demo = new DemoSingularityGateway(store);
        demo.seed();
        service = new BoardService(store, demo);
        service.recover();
        service.sync();
    }
    ObjectNode request(JsonNode before, String key, JsonNode value) {
        ObjectNode request = Json.object();
        request.set("base", Json.object().set(key, before.has(key) ? before.path(key) : Json.MAPPER.nullNode()));
        request.set("changes", Json.object().set(key, value));
        return request;
    }
    void forceSync() throws InterruptedException { Thread.sleep(2050); service.sync(); }

    @Test void demoHasOneCardForMultiProjectTaskAndUnsortedNewTasks() {
        var b = service.board();
        assertThat(b.path("tasks").size()).isEqualTo(14);
        assertThat(b.path("projects").size()).isEqualTo(4);
        JsonNode task = demo.task("T-demo-0");
        assertThat(task.path("tags")).contains(Json.MAPPER.valueToTree("A-project-0"), Json.MAPPER.valueToTree("A-project-2"));
        assertThat(b.path("layouts").has("T-demo-12")).isFalse();
        assertThat(b.path("layouts").has("T-demo-13")).isFalse();
    }
    @Test void tagIntentReadsFreshSetAndPreservesOrdinaryTagsAndNativeProject() {
        String operation = service.tag("T-demo-0", "A-project-1", true);
        JsonNode fresh = demo.task("T-demo-0");
        ObjectNode update = Json.object();
        update.set("tags", fresh.path("tags").deepCopy());
        ((com.fasterxml.jackson.databind.node.ArrayNode) update.path("tags")).add("A-external");
        demo.patchTask("T-demo-0", update);
        service.processNext();
        assertThat(store.operation(operation).path("status").asText()).isEqualTo("DONE");
        assertThat(demo.task("T-demo-0").path("tags")).contains(Json.MAPPER.valueToTree("A-external"), Json.MAPPER.valueToTree("A-ordinary"), Json.MAPPER.valueToTree("A-phone"));
        service.tag("T-demo-0", "A-project-0", false);
        service.processNext();
        assertThat(demo.task("T-demo-0").path("tags")).doesNotContain(Json.MAPPER.valueToTree("A-project-0"));
        assertThat(demo.task("T-demo-0").path("tags")).contains(Json.MAPPER.valueToTree("A-project-2"), Json.MAPPER.valueToTree("A-external"));
        assertThat(Json.text(demo.task("T-demo-0"), "projectId")).isEqualTo("P-demo");
    }
    @Test void renameTagKeepsIdAndLayoutAndDeletedTagIsNotRecreated() throws Exception {
        service.layout("A-project-0", Json.object().put("x", 1400).put("y", 333));
        demo.patchTag("A-project-0", Json.object().put("title", "Новое имя"));
        forceSync();
        assertThat(service.board().path("projects").toString()).contains("Новое имя");
        assertThat(store.layouts().path("A-project-0").path("y").asInt()).isEqualTo(333);
        demo.patchTag("A-project-0", Json.object().put("removed", true));
        forceSync();
        assertThat(store.cache("tag").stream().filter(t -> Json.text(t,"id").equals("A-project-0")).findFirst().orElseThrow().path("missing").asBoolean()).isTrue();
        assertThat(store.layouts().has("A-project-0")).isTrue();
        assertThatThrownBy(() -> service.tag("T-demo-0", "A-project-0", true)).isInstanceOf(IllegalArgumentException.class);
    }
    @Test void externalChangesAndNewTaskAppearWithoutLayoutLoss() throws Exception {
        service.layout("T-demo-0", Json.object().put("x", 777).put("y", -90).put("width", 310).put("height", 160));
        JsonNode newTask = demo.createTask(Json.object().put("title", "С телефона"));
        demo.complete("T-demo-0", true);
        demo.patchTask("T-demo-0", Json.object().set("tags", Json.array().add("A-project-3")));
        forceSync();
        assertThat(service.board().path("tasks").toString()).contains(Json.text(newTask,"id"));
        assertThat(store.layouts().has(Json.text(newTask,"id"))).isFalse();
        assertThat(store.entity("entity_cache","task","T-demo-0").path("checked").asInt()).isEqualTo(1);
        assertThat(store.layouts().path("T-demo-0").path("width").asInt()).isEqualTo(310);
        assertThat(store.layouts().path("T-demo-0").path("y").asInt()).isEqualTo(-90);
        var restarted = new BoardService(store, new DemoSingularityGateway(store));
        restarted.recover();
        restarted.sync();
        assertThat(restarted.board().path("layouts")).isEqualTo(service.board().path("layouts"));
    }
    @Test void hidingCardDoesNotDeleteRemoteTaskAndCanBeRestored() {
        service.layout("T-demo-0", Json.object().put("hidden",true));
        assertThat(demo.tasks()).hasSize(14);
        assertThat(store.layouts().path("T-demo-0").path("hidden").asBoolean()).isTrue();
        service.layout("T-demo-0",Json.object().put("hidden",false));
        assertThat(store.layouts().path("T-demo-0").path("x").asInt()).isEqualTo(80);
    }

    @Test
    void deletionRetriesReconcileAResponseLostAfterRemoteSuccess() {
        String taskId = "T-demo-0";
        AtomicInteger calls = new AtomicInteger();
        var gateway = new DelegatingGateway(demo) {
            @Override public void deleteTask(String id) {
                calls.incrementAndGet();
                super.deleteTask(id);
                throw new ApiFailure(0, true, "Тайм-аут");
            }
        };
        var worker = new BoardService(store, gateway);
        String deletion = worker.deleteTask(taskId);
        worker.processNext();

        ObjectNode queued = store.operation(deletion);
        assertThat(Json.text(queued, "status")).isEqualTo("PENDING");
        assertThat(store.findEntity("entity_cache", "task", taskId)).isPresent();
        store.operationState(deletion, "PENDING", queued.path("detail"), queued.path("attempts").asInt(), 0);
        worker.processNext();

        assertThat(calls.get()).isEqualTo(1);
        assertThat(Json.text(store.operation(deletion), "status")).isEqualTo("DONE");
        assertThat(store.findEntity("entity_cache", "task", taskId)).isEmpty();
        worker.sync();
        assertThat(worker.board().path("tasks").valueStream().map(t -> Json.text(t, "id"))).doesNotContain(taskId);
    }

    @Test
    void deletionPreservesTheTaskWhenSingularityRejectsTheRequest() {
        String taskId = "T-demo-0";
        var gateway = new DelegatingGateway(demo) {
            @Override public void deleteTask(String id) {
                throw new ApiFailure(403, false, "Доступ запрещён");
            }
        };
        var worker = new BoardService(store, gateway);
        String deletion = worker.deleteTask(taskId);
        worker.processNext();

        ObjectNode failed = store.operation(deletion);
        assertThat(Json.text(failed, "status")).isEqualTo("ERROR");
        assertThat(Json.text(failed.path("detail"), "message")).isEqualTo("Доступ запрещён");
        assertThat(store.findEntity("entity_cache", "task", taskId)).isPresent();
        assertThat(demo.tasks().stream().map(t -> Json.text(t, "id"))).contains(taskId);
    }

    @Test void staleFieldConflictShowsThreeValuesAndExplicitResolutionUsesFreshBase() {
        JsonNode before = demo.task("T-demo-0");
        String id = service.updateTask("T-demo-0", request(before,"title",Json.MAPPER.valueToTree("Наш вариант")));
        demo.patchTask("T-demo-0",Json.object().put("title","Внешний вариант"));
        service.processNext();
        assertThat(Json.text(store.operation(id),"status")).isEqualTo("CONFLICT");
        assertThat(store.operation(id).path("detail").path("conflicts").path("title").path("external").asText()).isEqualTo("Внешний вариант");
        service.resolve(id,Json.object().put("action","ours"));
        service.processNext();
        assertThat(Json.text(demo.task("T-demo-0"),"title")).isEqualTo("Наш вариант");
        assertThat(demo.task("T-demo-0").path("note")).isEqualTo(before.path("note"));
    }
    @Test void untouchedDescriptionAndDatesRemainExactAndRichDeltaIsValidated() {
        String rich="[{\"insert\":\"Жирный\",\"attributes\":{\"bold\":true}},{\"insert\":\"\\n\"}]";
        demo.patchTask("T-demo-0",Json.object().put("note",rich).put("start","2026-11-11").put("deadline","2026-11-12T22:30:00-05:00"));
        JsonNode before=demo.task("T-demo-0");
        String id=service.updateTask("T-demo-0",request(before,"title",Json.MAPPER.valueToTree("Название")));
        service.processNext();
        assertThat(Json.text(store.operation(id),"status")).isEqualTo("DONE");
        assertThat(Json.text(demo.task("T-demo-0"),"note")).isEqualTo(rich);
        assertThat(Json.text(demo.task("T-demo-0"),"start")).isEqualTo("2026-11-11");
        assertThat(Json.text(demo.task("T-demo-0"),"deadline")).isEqualTo("2026-11-12T22:30:00-05:00");
        assertThatThrownBy(()->service.updateTask("T-demo-0",request(before,"note",Json.MAPPER.valueToTree("Произвольный текст")))).isInstanceOf(IllegalArgumentException.class);
        String delta=Json.delta("Новый текст");
        service.updateTask("T-demo-0",request(before,"note",Json.MAPPER.valueToTree(delta)));
        service.processNext();
        assertThat(Json.text(demo.task("T-demo-0"),"note")).isEqualTo(delta);
    }
    @Test void recurringTaskFieldsCannotBeModifiedButLayoutCanBeChanged() {
        ObjectNode task=Json.copy(demo.task("T-demo-0"));
        task.put("recurrenceGeneratorId","T-generator");
        store.putEntity("entity_cache","task",task);
        assertThatThrownBy(()->service.updateTask("T-demo-0",request(task,"checked",Json.MAPPER.valueToTree(1)))).isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> service.deleteTask("T-demo-0")).isInstanceOf(IllegalArgumentException.class);
        service.layout("T-demo-0",Json.object().put("x",123));
        assertThat(store.layouts().path("T-demo-0").path("x").asInt()).isEqualTo(123);
    }

    @Test
    void scenarioLinksFromOccurrencesUseTheTemplateAndPreserveItsOtherTags() {
        String templateId = "T-demo-0";
        String instanceId = "T-demo-1";
        var recurrence = Json.object().put("rule", "monthly");
        store.putEntity("entity_cache", "task", demo.patchTask(templateId, Json.object().set("recurrence", recurrence)));
        var instance = demo.patchTask(instanceId, Json.object().put("recurrenceGeneratorId", templateId));
        store.putEntity("entity_cache", "task", instance);

        String add = service.tag(instanceId, "A-project-3", true);
        String remove = service.tag(templateId, "A-project-3", false);
        assertThat(Json.text(store.operation(add), "entityId")).isEqualTo(templateId);
        assertThat(Json.text(store.operation(remove), "entityId")).isEqualTo(templateId);
        var freshTags = Json.copy(demo.task(templateId)).withArray("tags").add("A-external");
        demo.patchTask(templateId, Json.object().set("tags", freshTags));

        service.processNext();

        assertThat(Json.text(store.operation(add), "status")).isEqualTo("DONE");
        assertThat(demo.task(templateId).path("tags")).isEqualTo(freshTags.deepCopy().add("A-project-3"));
        assertThat(store.entity("entity_cache", "task", templateId)).isEqualTo(demo.task(templateId));

        service.processNext();

        assertThat(Json.text(store.operation(remove), "status")).isEqualTo("DONE");
        assertThat(demo.task(templateId).path("tags")).isEqualTo(freshTags);
        assertThat(demo.task(templateId).path("recurrence")).isEqualTo(recurrence);
        assertThat(Json.text(demo.task(templateId), "projectId")).isEqualTo("P-demo");
        assertThat(demo.task(instanceId)).isEqualTo(instance);
    }

    @Test
    void aSeriesLinkDoesNotEditAnOccurrenceWhenItsTemplateIsUnavailable() {
        String templateId = "T-demo-0";
        String instanceId = "T-demo-1";
        var instance = demo.patchTask(instanceId, Json.object().put("recurrenceGeneratorId", templateId));
        store.putEntity("entity_cache", "task", instance);
        assertThatThrownBy(() -> service.tag(instanceId, "A-project-3", true))
                .isInstanceOf(IllegalArgumentException.class);

        store.putEntity("entity_cache", "task", demo.patchTask(templateId,
                Json.object().set("recurrence", Json.object().put("rule", "monthly"))));
        String operation = service.tag(instanceId, "A-project-3", true);
        demo.deleteTask(templateId);

        service.processNext();

        assertThat(Json.text(store.operation(operation), "status")).isEqualTo("ERROR");
        assertThat(demo.task(instanceId)).isEqualTo(instance);
    }
    @Test void rootsAreNeverCreatedByReadingOrStartupAndSettingsHandleDescendants() {
        int count=demo.tags().size();
        service.board(); service.board(); demo.seed();
        assertThat(demo.tags()).hasSize(count);
        demo.createTag(Json.object().put("title","Вложенный").put("parent","A-project-0"));
        store.replaceCache("tag",demo.tags());
        assertThat(BoardService.descendants(store.cache("tag"),"A-root")).hasSize(7).doesNotContain("A-root","A-ordinary");
        assertThatThrownBy(()->service.settings(Json.object().put("syncSeconds",0))).isInstanceOf(IllegalArgumentException.class);
    }
    @Test void crashRecoveryMakesCreationUncertainAndKeepsQueuedIntent() {
        String create=service.createTask(Json.object().put("title","После сбоя"));
        String patch=service.tag("T-demo-0","A-project-1",true);
        store.operationState(create,"SENDING",Json.object(),1,0);
        store.operationState(patch,"SENDING",Json.object(),1,0);
        store.recover();
        assertThat(Json.text(store.operation(create),"status")).isEqualTo("UNCERTAIN");
        assertThat(Json.text(store.operation(patch),"status")).isEqualTo("PENDING");
        assertThatThrownBy(()->service.resolve(create,Json.object().put("action","retry"))).isInstanceOf(IllegalArgumentException.class);
    }
    @Test void ambiguousCreationIsNeverBlindlyRepeatedAndCanBeReconciled() {
        AtomicInteger posts=new AtomicInteger();
        SingularityGateway failing=new DelegatingGateway(demo){
            @Override public JsonNode createTask(JsonNode data){posts.incrementAndGet();demo.createTask(data);throw new ApiFailure(0,true,"Тайм-аут");}
        };
        var s=new BoardService(store,failing);
        String id=s.createTask(Json.object().put("title","Не дублировать"));
        s.processNext();s.processNext();s.processNext();
        assertThat(posts.get()).isEqualTo(1);
        assertThat(Json.text(store.operation(id),"status")).isEqualTo("UNCERTAIN");
        s.resolve(id,Json.object().put("action","reconcile"));
        assertThat(Json.text(store.operation(id),"status")).isEqualTo("DONE");
        assertThat(demo.tasks()).hasSize(15);
    }
    @Test void duplicateExternalIdsDoNotProveIdempotency() {
        String id=service.createTask(Json.object().put("title","Две внешние записи"));
        JsonNode data=store.operation(id).path("payload").path("data");
        demo.createTask(data);demo.createTask(data);
        store.operationState(id,"UNCERTAIN",Json.object(),1,0);
        service.resolve(id,Json.object().put("action","reconcile"));
        assertThat(Json.text(store.operation(id),"status")).isEqualTo("UNCERTAIN");
        assertThat(demo.tasks()).hasSize(16);
    }
    @Test void failedTaskBlocksItsNextOperationButOtherTasksContinue() {
        String first=service.tag("T-demo-0","A-project-1",true);
        String second=service.tag("T-demo-0","A-project-2",false);
        String independent=service.tag("T-demo-1","A-project-2",true);
        store.operationState(first,"ERROR",Json.object(),3,0);
        service.processNext();
        assertThat(Json.text(store.operation(second),"status")).isEqualTo("PENDING");
        assertThat(Json.text(store.operation(independent),"status")).isEqualTo("DONE");
        service.resolve(first,Json.object().put("action","discard"));
        service.processNext();
        assertThat(Json.text(store.operation(second),"status")).isEqualTo("DONE");
    }
    @Test void rateLimitUsesBoundedRetriesAndPreservesQueue() {
        AtomicInteger writes=new AtomicInteger();
        var gateway=new DelegatingGateway(demo){@Override public JsonNode patchTask(String id,JsonNode patch){writes.incrementAndGet();throw new ApiFailure(429,true,"Лимит",60_000);}};
        var s=new BoardService(store,gateway);
        String id=s.tag("T-demo-0","A-project-1",true);
        s.processNext();s.processNext();
        assertThat(writes.get()).isEqualTo(1);
        assertThat(store.operation(id).path("nextAttempt").asLong()).isGreaterThan(System.currentTimeMillis()+50_000);
        for(int i=0;i<2;i++){ObjectNode op=store.operation(id);store.operationState(id,"PENDING",Json.object(),op.path("attempts").asInt(),0);s.processNext();}
        assertThat(writes.get()).isEqualTo(3);
        assertThat(Json.text(store.operation(id),"status")).isEqualTo("ERROR");
    }
    @Test void syncFailureKeepsCacheAndLayoutWithoutDemoFallback() {
        var gateway=new DelegatingGateway(demo){@Override public List<JsonNode> tasks(){throw new ApiFailure(401,false,"Токен отклонён");}};
        var s=new BoardService(store,gateway);
        JsonNode before=service.board();
        s.sync();
        assertThat(s.board().path("tasks")).isEqualTo(before.path("tasks"));
        assertThat(s.board().path("layouts")).isEqualTo(before.path("layouts"));
        assertThat(s.syncStatus().path("error").asText()).contains("Токен");
    }
    @Test void repeatedBrowserAcknowledgementReusesTheDurableCreateOperation() {
        String requestId=UUID.randomUUID().toString();
        ObjectNode request=Json.object().put("title","Повтор HTTP запроса").put("requestId",requestId);
        String first=service.createTask(request);
        String second=service.createTask(request);
        assertThat(second).isEqualTo(first);
        assertThat(store.operations().stream().filter(o->Json.text(o,"kind").equals("CREATE_TASK")).count()).isEqualTo(1);
        service.processNext();
        assertThat(service.createTask(request)).isEqualTo(first);
        service.processNext();
        assertThat(demo.tasks()).hasSize(15);
        assertThatThrownBy(()->service.createTask(Json.object().put("title","Другой запрос").put("requestId",requestId))).isInstanceOf(IllegalArgumentException.class);
    }

    @Test void createsTaskWithSelectedScenarioAndKeepsTheRequestIdempotent() {
        ObjectNode request = Json.object().put("title", "Действие для цели")
                .put("requestId", UUID.randomUUID().toString()).put("scenarioId", "A-project-0");
        String operation = service.createTask(request);
        service.processNext();

        JsonNode finished = store.operation(operation);
        assertThat(Json.text(finished, "status")).isEqualTo("DONE");
        assertThat(demo.task(Json.text(finished.path("detail"), "resultId")).path("tags"))
                .isEqualTo(Json.array().add("A-project-0"));
        assertThatThrownBy(() -> service.createTask(request.deepCopy().put("scenarioId", "A-project-1")))
                .isInstanceOf(IllegalArgumentException.class);

        demo.patchTag("A-project-0", Json.object().put("removed", true));
        store.replaceCache("tag", demo.tags());
        assertThat(service.createTask(request)).isEqualTo(operation);
        assertThatThrownBy(() -> service.createTask(request.deepCopy().put("requestId", UUID.randomUUID().toString())))
                .isInstanceOf(IllegalArgumentException.class).hasMessageContaining("недоступны");
        assertThatThrownBy(() -> service.createTask(Json.object().put("title", "Обычный тег").put("scenarioId", "A-ordinary")))
                .isInstanceOf(IllegalArgumentException.class);
        assertThat(store.operations()).hasSize(1);
    }

    @Test void creationWithoutTheRequestedScenarioTagRequiresReconciliation() {
        var gateway = new DelegatingGateway(demo) {
            @Override public JsonNode createTask(JsonNode data) {
                ObjectNode withoutTags = Json.copy(data);
                withoutTags.remove("tags");
                return super.createTask(withoutTags);
            }
        };
        var boardService = new BoardService(store, gateway);
        ObjectNode request = Json.object().put("title", "Действие для опасения").put("scenarioId", "A-project-1");
        request.set("position", Json.object().put("x", 180).put("y", 240));
        String operation = boardService.createTask(request);
        boardService.processNext();

        JsonNode created = store.operation(operation);
        assertThat(Json.text(created, "status")).isEqualTo("UNCERTAIN");
        String taskId = Json.text(created.path("detail"), "resultId");
        assertThat(store.layouts().path(taskId).path("x").asDouble()).isEqualTo(180);
        boardService.resolve(operation, Json.object().put("action", "reconcile"));
        assertThat(Json.text(store.operation(operation), "status")).isEqualTo("ERROR");
        assertThat(demo.tasks()).hasSize(15);
    }

    @Test void explicitStartChangesSelectTimeModeWithoutShiftingTheDate() {
        JsonNode initial=demo.task("T-demo-0");
        String timed="2026-11-11T23:30:00-05:00";
        String operation=service.updateTask("T-demo-0",request(initial,"start",Json.MAPPER.valueToTree(timed)));
        service.processNext();
        assertThat(Json.text(store.operation(operation),"status")).isEqualTo("DONE");
        assertThat(Json.text(demo.task("T-demo-0"),"start")).isEqualTo(timed);
        assertThat(demo.task("T-demo-0").path("useTime").asBoolean()).isTrue();
        service.updateTask("T-demo-0",request(demo.task("T-demo-0"),"start",Json.MAPPER.valueToTree("2026-11-11")));
        service.processNext();
        assertThat(Json.text(demo.task("T-demo-0"),"start")).isEqualTo("2026-11-11");
        assertThat(demo.task("T-demo-0").path("useTime").asBoolean()).isFalse();
    }
    @Test void queueUsesDatabaseInsertionOrderEvenForSameMillisecond() {
        String first=service.tag("T-demo-0","A-project-1",true);
        String second=service.tag("T-demo-0","A-project-1",false);
        jdbc.update("UPDATE board_operation SET created_at=1");
        service.processNext();service.processNext();
        assertThat(Json.text(store.operation(first),"status")).isEqualTo("DONE");
        assertThat(Json.text(store.operation(second),"status")).isEqualTo("DONE");
        assertThat(demo.task("T-demo-0").path("tags")).doesNotContain(Json.MAPPER.valueToTree("A-project-1"));
    }
    @Test void axisDescriptionsPersistWithoutChangingLayoutOrViewport() {
        JsonNode before = service.board();
        ObjectNode labels = Json.object().put("left", "Слева").put("right", "Справа").put("top", "Сверху").put("bottom", "Снизу");
        ObjectNode patch = Json.object().put("xAxis", "Если сделать…").put("yAxis", "Если не сделать…");
        patch.set("axisLabels", labels);
        service.settings(patch);
        assertThat(store.settings().path("axisLabels")).isEqualTo(labels);
        assertThat(service.board().path("layouts")).isEqualTo(before.path("layouts"));
        assertThat(store.settings().path("viewport")).isEqualTo(before.path("settings").path("viewport"));
        assertThatThrownBy(() -> service.settings(Json.object().set("axisLabels", Json.object().put("left", "Неполные подписи"))))
                .isInstanceOf(IllegalArgumentException.class);
    }
    @Test void oldAxisPlaceholdersUpgradeOnReadAndCustomCaptionsArePreserved() {
        ObjectNode old = store.settings();
        old.remove("axisLabels");
        old.put("xAxis", "Ось X").put("yAxis", "Моя подпись");
        store.settings(old);
        ObjectNode upgraded = store.settings();
        assertThat(Json.text(upgraded, "xAxis")).isEqualTo("Если эту задачу сделать, то…");
        assertThat(Json.text(upgraded, "yAxis")).isEqualTo("Моя подпись");
        assertThat(upgraded.path("axisLabels").size()).isEqualTo(4);
        service.settings(Json.object().put("syncSeconds", 30));
        assertThat(Json.text(store.settings(), "yAxis")).isEqualTo("Моя подпись");
    }
    @Test void matrixDimensionsRoundTripWithoutMovingCardsOrChangingCamera() {
        JsonNode before=service.board();
        ObjectNode bounds=Json.object().put("left",-900).put("top",-600).put("right",2500).put("bottom",1900);
        service.settings(Json.object().set("matrixBounds",bounds));
        assertThat(store.settings().path("matrixBounds")).isEqualTo(bounds);
        var reopened=new BoardService(store,demo);
        assertThat(reopened.board().path("settings").path("matrixBounds")).isEqualTo(bounds);
        assertThat(reopened.board().path("layouts")).isEqualTo(before.path("layouts"));
        assertThat(reopened.board().path("settings").path("viewport")).isEqualTo(before.path("settings").path("viewport"));
        service.settings(Json.object().put("xAxis","Новая подпись"));
        assertThat(store.settings().path("matrixBounds")).isEqualTo(bounds);
    }
    @Test void invalidMatrixDimensionsCannotMoveAxesOrCorruptSavedSettings() {
        JsonNode original=store.settings().path("matrixBounds");
        for (JsonNode invalid:List.of(Json.object(),Json.object().put("left",1).put("top",0).put("right",1100).put("bottom",900),
                Json.object().put("left",-120000).put("top",0).put("right",1100).put("bottom",900),
                Json.object().put("left",0).put("top",0).put("right",100).put("bottom",900),
                Json.object().put("left","0").put("top",0).put("right",1100).put("bottom",900)))
            assertThatThrownBy(()->service.settings(Json.object().set("matrixBounds",invalid))).isInstanceOf(IllegalArgumentException.class);
        assertThat(store.settings().path("matrixBounds")).isEqualTo(original);
    }
    @Test void olderSettingsGetDefaultDimensionsWithoutChangingCustomLabels() {
        ObjectNode settings=store.settings();settings.remove("matrixBounds");settings.put("xAxis","Своё название");store.settings(settings);
        JsonNode restored=store.settings();
        assertThat(restored.path("matrixBounds").path("right").asInt()).isEqualTo(1100);
        assertThat(restored.path("matrixBounds").path("bottom").asInt()).isEqualTo(900);
        assertThat(Json.text(restored,"xAxis")).isEqualTo("Своё название");
    }
    @Test void modeNamespacesKeepRealAndDemoDataSeparate() {
        var ds=jdbc.getDataSource();
        Store real=new Store(jdbc,new TransactionTemplate(new DataSourceTransactionManager(ds)),"real","Europe/Moscow");
        assertThat(real.cache("task")).isEmpty();
        assertThat(real.layouts().isEmpty()).isTrue();
        assertThat(Json.text(real.settings(),"rootTagId")).isEmpty();
    }
    @Test void scenarioBranchesAreContainersAndDescendantsInheritTypeWithoutChangingTasks() {
        demo.createTag(Json.object().put("title", "Вложенная цель").put("parent", "A-project-0"));
        JsonNode legacy = demo.createTag(Json.object().put("title", "Старый тег").put("parent", "A-root"));
        store.replaceCache("tag", demo.tags());
        var tasksBefore = service.board().path("tasks").deepCopy();
        var layoutsBefore = store.layouts().deepCopy();
        var scenarios = service.board().path("projects");
        assertThat(scenarios).hasSize(6);
        assertThat(java.util.stream.StreamSupport.stream(scenarios.spliterator(), false).map(t -> Json.text(t, "id")))
                .doesNotContain("A-goals", "A-fears");
        assertThat(java.util.stream.StreamSupport.stream(scenarios.spliterator(), false)
                .filter(t -> Json.text(t, "scenarioType").equals("goal")).count()).isEqualTo(3);
        assertThat(java.util.stream.StreamSupport.stream(scenarios.spliterator(), false)
                .filter(t -> Json.text(t, "id").equals(Json.text(legacy, "id"))).findFirst().orElseThrow()
                .path("scenarioType").asText()).isEqualTo("unclassified");
        assertThat(service.board().path("tasks")).isEqualTo(tasksBefore);
        assertThat(store.layouts()).isEqualTo(layoutsBefore);
    }
    @Test void branchIdsSurviveRenameAndMissingBranchDoesNotBlockLayoutOrViewport() {
        assertThat(store.settings().path("goalTagId").asText()).isEqualTo("A-goals");
        demo.patchTag("A-goals", Json.object().put("title", "Другое имя"));
        store.replaceCache("tag", demo.tags());
        service.settings(Json.object().put("syncSeconds", 30));
        assertThat(service.board().path("projects").get(0).path("scenarioType").asText()).isEqualTo("goal");
        demo.patchTag("A-goals", Json.object().put("removed", true));
        store.replaceCache("tag", demo.tags());
        service.settings(Json.object().set("viewport", Json.object().put("x", 0).put("y", 0).put("zoom", 1)));
        assertThat(store.settings().path("goalTagId").asText()).isEqualTo("A-goals");
        assertThatThrownBy(() -> service.createTag(Json.object().put("title", "Новая цель").put("scenarioType", "goal")))
                .isInstanceOf(IllegalArgumentException.class);
    }
    @Test void typedScenarioCreationAndBothKindsOfLinksPreserveTaskPositionAndOrdinaryTags() {
        var before = store.layouts().path("T-demo-0").deepCopy();
        String create = service.createTag(Json.object().put("title", "Новая цель").put("scenarioType", "goal"));
        service.processNext();
        var created = store.entity("entity_cache", "tag", store.operation(create).path("detail").path("resultId").asText());
        assertThat(created.path("parent").asText()).isEqualTo("A-goals");
        String fear = service.tag("T-demo-0", "A-project-1", true);
        service.processNext();
        assertThat(store.operation(fear).path("status").asText()).isEqualTo("DONE");
        assertThat(demo.task("T-demo-0").path("tags")).contains(Json.MAPPER.valueToTree("A-project-0"),
                Json.MAPPER.valueToTree("A-project-1"), Json.MAPPER.valueToTree("A-ordinary"));
        assertThat(store.layouts().path("T-demo-0")).isEqualTo(before);
        assertThatThrownBy(() -> service.tag("T-demo-0", "A-goals", true)).isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> service.settings(Json.object().put("fearTagId", "A-goals"))).isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> service.settings(Json.object().put("goalTagId", "A-project-0"))).isInstanceOf(IllegalArgumentException.class);
    }
    @Test void selectingAnotherRootDoesNotReuseOldScenarioBranches() {
        JsonNode root = demo.createTag(Json.object().put("title", "Другой корень"));
        JsonNode goals = demo.createTag(Json.object().put("title", "Цели").put("parent", Json.text(root, "id")));
        store.replaceCache("tag", demo.tags());
        service.settings(Json.object().put("rootTagId", Json.text(root, "id")));
        assertThat(store.settings().path("goalTagId").asText()).isEqualTo(Json.text(goals, "id"));
        assertThat(store.settings().path("fearTagId").asText()).isEmpty();
    }

    @Test void legacyTagsStayUnclassifiedUntilExplicitBranchCreationAndCanBeMovedWithoutLosingIntent() {
        JsonNode root = demo.createTag(Json.object().put("title", "Старый корень"));
        String rootId = Json.text(root, "id");
        JsonNode legacy = demo.createTag(Json.object().put("title", "Старый сценарий").put("parent", rootId));
        String legacyId = Json.text(legacy, "id");
        store.replaceCache("tag", demo.tags());
        service.settings(Json.object().put("rootTagId", rootId));
        service.layout(legacyId, Json.object().put("x", 1400).put("y", 350));
        service.tag("T-demo-0", legacyId, true);
        service.processNext();
        assertThat(service.board().path("projects").get(0).path("scenarioType").asText()).isEqualTo("unclassified");
        int tagCount = demo.tags().size();
        service.board(); service.board();
        assertThat(demo.tags()).hasSize(tagCount);
        ObjectNode branchRequest = Json.object().put("title", "Опасения").put("branch", true).put("scenarioType", "fear")
                .put("requestId", UUID.randomUUID().toString());
        String op = service.createTag(branchRequest);
        service.processNext();
        String branchId = store.operation(op).path("detail").path("resultId").asText();
        assertThat(store.settings().path("fearTagId").asText()).isEqualTo(branchId);
        assertThat(service.createTag(branchRequest)).isEqualTo(op);
        assertThat(demo.tags()).hasSize(tagCount + 1);
        demo.patchTag(legacyId, Json.object().put("parent", branchId));
        store.replaceCache("tag", demo.tags());
        assertThat(service.board().path("projects").get(0).path("scenarioType").asText()).isEqualTo("fear");
        assertThat(store.layouts().path(legacyId).path("y").asInt()).isEqualTo(350);
        assertThat(demo.task("T-demo-0").path("tags")).contains(Json.MAPPER.valueToTree(legacyId), Json.MAPPER.valueToTree("A-ordinary"));
    }

    @Test
    void scenarioTreeEditsPreserveIdentityAndRejectCyclesAndCrossBranchMoves() {
        var move = Json.object().put("parentId", "A-project-0").put("base", "A-goals");
        assertThatThrownBy(() -> service.moveScenario("A-project-2", move)).hasMessageContaining("Включите дерево");
        service.settings(Json.object().put("scenarioHierarchy", true));
        var task = demo.task("T-demo-0");
        var layouts = store.layouts();
        String op = service.moveScenario("A-project-2", move);
        demo.patchTag("A-project-2", Json.object().put("title", "Новое название").put("color", "#888888"));
        service.processNext();
        assertThat(Json.text(store.operation(op), "status")).isEqualTo("DONE");
        var moved = demo.tag("A-project-2");
        assertThat(Json.text(moved, "parent")).isEqualTo("A-project-0");
        assertThat(Json.text(moved, "title")).isEqualTo("Новое название");
        assertThat(Json.text(moved, "color")).isEqualTo("#888888");
        assertThat(demo.task("T-demo-0")).isEqualTo(task);
        assertThat(store.layouts()).isEqualTo(layouts);
        assertThatThrownBy(() -> service.moveScenario("A-project-0", Json.object().put("base", "A-goals").put("parentId", "A-project-2")))
                .hasMessageContaining("потомков");
        assertThatThrownBy(() -> service.moveScenario("A-project-2", Json.object().put("base", "A-project-0").put("parentId", "A-project-1")))
                .hasMessageContaining("той же ветки");
        service.moveScenario("A-project-2", Json.object().put("base", "A-project-0").put("parentId", ""));
        service.processNext();
        assertThat(Json.text(demo.tag("A-project-2"), "parent")).isEqualTo("A-goals");
    }

    @Test
    void externalScenarioMoveConflictsWithAStaleParentAndCanBeResolved() {
        var grandparent = demo.createTag(Json.object().put("title", "Переезд").put("parent", "A-goals"));
        String newParent = Json.text(grandparent, "id");
        service.settings(Json.object().put("scenarioHierarchy", true));
        String op = service.moveScenario("A-project-2", Json.object().put("base", "A-goals").put("parentId", "A-project-0"));
        demo.patchTag("A-project-2", Json.object().put("parent", newParent));
        service.processNext();
        assertThat(Json.text(demo.tag("A-project-2"), "parent")).isEqualTo(newParent);
        assertThat(Json.text(store.operation(op), "status")).isEqualTo("CONFLICT");
        assertThat(store.operation(op).at("/detail/conflicts/parent/external").asText()).isEqualTo(newParent);
        service.resolve(op, Json.object().put("action", "ours"));
        service.processNext();
        assertThat(Json.text(demo.tag("A-project-2"), "parent")).isEqualTo("A-project-0");
        assertThat(Json.text(store.operation(op), "status")).isEqualTo("DONE");
    }

    @Test
    void chainInsertsNewAndExistingStepsWithoutDuplicatingTasksOrOverwritingFields() {
        String chain = runOperation(service.createChain(Json.object().put("title", "Гитара").put("projectId", "P-demo")));
        assertThat(demo.task(chain).path("tags")).containsExactly(Json.MAPPER.valueToTree("A-chain"));
        var taskBefore = Json.copy(demo.task("T-demo-0"));
        var layoutBefore = store.layouts().path("T-demo-0");
        String first = runOperation(service.moveChainStep(chain, "T-demo-0", position(taskBefore, "")));
        String last = runOperation(service.createChainStep(chain, Json.object().put("title", "Повесить гитару").put("afterId", first)));
        var insert = Json.object().put("title", "Просверлить").put("afterId", first).put("requestId", UUID.randomUUID().toString());
        String op = service.createChainStep(chain, insert);
        String middle = runOperation(op);
        assertThat(service.createChainStep(chain, insert)).isEqualTo(op);
        assertThat(stepIds(chain)).containsExactly(first, middle, last);
        assertThat(Json.text(demo.task(middle), "projectId")).isEqualTo("P-demo");
        var taskAfter = Json.copy(demo.task("T-demo-0"));
        for (var task : List.of(taskBefore, taskAfter)) task.remove(List.of("parent", "parentOrder", "modificatedDate"));
        assertThat(taskAfter).isEqualTo(taskBefore);
        assertThat(store.layouts().path(first)).isEqualTo(layoutBefore);

        String other = runOperation(service.createChain(Json.object().put("title", "Другая цепочка").put("projectId", "P-demo")));
        assertThatThrownBy(() -> service.moveChainStep(other, first, position(demo.task(first), "")))
                .hasMessageContaining("уже есть родитель");
    }

    @Test
    void usesFreshSiblingOrderAndSpreadsTiedRanksWithoutChangingTheirRelativeOrder() {
        String chain = runOperation(service.createChain(Json.object().put("title", "Гитара")));
        String first = runOperation(service.createChainStep(chain, Json.object().put("title", "Примерить").put("afterId", "")));
        String second = runOperation(service.createChainStep(chain, Json.object().put("title", "Попросить").put("afterId", first)));
        demo.patchTask(first, Json.object().put("parentOrder", 5));
        demo.patchTask(second, Json.object().put("parentOrder", 5));
        List<String> tied = stepIds(chain);
        String inserted = runOperation(service.createChainStep(chain, Json.object().put("title", "Отметить точки")
                .put("afterId", tied.getFirst())));
        assertThat(stepIds(chain)).containsExactly(tied.getFirst(), inserted, tied.getLast());
        JsonNode base = demo.task(inserted);
        var reorder = service.moveChainStep(chain, inserted, position(base, tied.getLast()));
        demo.patchTask(inserted, Json.object().put("parentOrder", -2));
        service.processNext();
        assertThat(Json.text(store.operation(reorder), "status")).isEqualTo("CONFLICT");
        service.resolve(reorder, Json.object().put("action", "ours"));
        runOperation(reorder);
        assertThat(stepIds(chain)).containsExactly(tied.getFirst(), tied.getLast(), inserted);
    }

    @Test
    void timedOutStepCreationIsReconciledInItsChainWithoutAnotherPost() {
        String chain = runOperation(service.createChain(Json.object().put("title", "Гитара")));
        AtomicInteger writes = new AtomicInteger();
        service = new BoardService(store, new DelegatingGateway(demo) {
            @Override
            public JsonNode createTask(JsonNode data) {
                writes.incrementAndGet();
                super.createTask(data);
                throw new ApiFailure(0, true, "Тайм-аут");
            }
        });
        String op = service.createChainStep(chain, Json.object().put("title", "Примерить").put("afterId", ""));
        service.processNext();
        assertThat(Json.text(store.operation(op), "status")).isEqualTo("UNCERTAIN");
        service.processNext();
        service.resolve(op, Json.object().put("action", "reconcile"));
        assertThat(Json.text(store.operation(op), "status")).isEqualTo("DONE");
        assertThat(stepIds(chain)).containsExactly(store.operation(op).at("/detail/resultId").asText());
        assertThat(writes.get()).isEqualTo(1);
    }

    @Test
    void interruptedRankSpacingPreservesOrderAndCanResumeWithoutCreatingDuplicateSteps() {
        String chain = runOperation(service.createChain(Json.object().put("title", "Гитара")));
        for (String title : List.of("Первый", "Второй", "Третий")) {
            demo.createTask(Json.object().put("title", title).put("parent", chain).put("parentOrder", 0));
        }
        List<String> original = stepIds(chain);
        AtomicInteger spacingWrites = new AtomicInteger();
        service = new BoardService(store, new DelegatingGateway(demo) {
            @Override
            public JsonNode patchTask(String id, JsonNode patch) {
                if (spacingWrites.incrementAndGet() == 2) throw new ApiFailure(0, true, "Тайм-аут");
                return super.patchTask(id, patch);
            }
        });
        String op = service.createChainStep(chain, Json.object().put("title", "Новый").put("afterId", original.getFirst()));
        service.processNext();
        assertThat(Json.text(store.operation(op), "status")).isEqualTo("PENDING");
        assertThat(stepIds(chain)).isEqualTo(original);
        store.operationState(op, "PENDING", Json.object(), 1, 0);
        String inserted = runOperation(op);
        assertThat(stepIds(chain)).containsExactly(original.get(0), inserted, original.get(1), original.get(2));
    }

    @Test
    void relationRequestsReachTheQueueThroughTheBoardController() throws Exception {
        var mvc = MockMvcBuilders.standaloneSetup(new BoardController(service, jdbc))
                .setControllerAdvice(new ApiErrors())
                .addFilters(new LocalAccessFilter())
                .build();
        service.settings(Json.object().put("scenarioHierarchy", true));
        var parentResponse = mvc.perform(patch("/api/tags/A-project-2/parent").contentType("application/json")
                        .content("{\"parentId\":\"A-project-0\",\"base\":\"A-goals\"}"))
                .andExpect(status().isOk()).andReturn().getResponse();
        runOperation(Json.text(Json.read(parentResponse.getContentAsString()), "operationId"));
        assertThat(Json.text(demo.tag("A-project-2"), "parent")).isEqualTo("A-project-0");

        var chainResponse = mvc.perform(post("/api/chains").contentType("application/json").content("{\"title\":\"Гитара\"}"))
                .andExpect(status().isOk()).andReturn().getResponse();
        String chain = runOperation(Json.text(Json.read(chainResponse.getContentAsString()), "operationId"));
        var stepResponse = mvc.perform(post("/api/chains/{id}/steps", chain).contentType("application/json")
                        .content("{\"title\":\"Первый шаг\",\"afterId\":\"\"}"))
                .andExpect(status().isOk()).andReturn().getResponse();
        String step = runOperation(Json.text(Json.read(stepResponse.getContentAsString()), "operationId"));
        assertThat(stepIds(chain)).containsExactly(step);
    }

    private String runOperation(String id) {
        service.processNext();
        JsonNode result = store.operation(id);
        assertThat(Json.text(result, "status")).describedAs(result.path("detail").toString()).isEqualTo("DONE");
        return result.at("/detail/resultId").asText();
    }

    private List<String> stepIds(String chain) {
        return ChainOrder.steps(demo.childTasks(chain), chain).stream().map(step -> Json.text(step, "id")).toList();
    }

    private static ObjectNode position(JsonNode step, String afterId) {
        ObjectNode base = Json.object();
        base.set("parent", step.get("parent"));
        base.set("parentOrder", step.get("parentOrder"));
        return Json.object().put("afterId", afterId).set("base", base);
    }

}
