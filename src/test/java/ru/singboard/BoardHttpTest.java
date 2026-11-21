package ru.singboard;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.http.MediaType;

import static org.assertj.core.api.Assertions.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

@SpringBootTest(properties={"app.mode=demo","app.token=","spring.datasource.url=jdbc:h2:mem:http-contract;MODE=PostgreSQL;DB_CLOSE_DELAY=-1","spring.datasource.username=sa","spring.datasource.password="})
@AutoConfigureMockMvc
class BoardHttpTest {
    @Autowired MockMvc mvc;
    @Autowired BoardService service;
    @Autowired Store store;

    @Test void boardEndpointIsRussianDemoAndHasNoCredentialFields() throws Exception {
        service.sync();
        String response=mvc.perform(get("/api/board")).andExpect(status().isOk())
                .andExpect(header().string("Cache-Control","no-store"))
                .andExpect(jsonPath("$.mode").value("demo"))
                .andExpect(jsonPath("$.tasks.length()").value(org.hamcrest.Matchers.greaterThanOrEqualTo(14)))
                .andExpect(jsonPath("$.projects.length()").value(4)).andReturn().getResponse().getContentAsString(java.nio.charset.StandardCharsets.UTF_8);
        assertThat(response).doesNotContain("SINGULARITY_API_TOKEN","Authorization","app.token");
        mvc.perform(get("/api/health")).andExpect(status().isOk()).andExpect(jsonPath("$.status").value("UP"));
    }
    @Test void taskCreationIsDurableBeforeDispatch() throws Exception {
        String text=mvc.perform(post("/api/tasks").contentType(MediaType.APPLICATION_JSON).content("{\"title\":\"HTTP задача\"}"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.status").value("PENDING")).andReturn().getResponse().getContentAsString();
        String id=Json.text(Json.read(text),"operationId");
        assertThat(Json.text(store.operation(id),"status")).isEqualTo("PENDING");
        service.processNext();
        assertThat(Json.text(store.operation(id),"status")).isEqualTo("DONE");
        assertThat(store.cache("task").stream().anyMatch(t->Json.text(t,"title").equals("HTTP задача"))).isTrue();
    }

    @Test
    void taskDeletionIsQueuedAndRemovesOnlyTheTargetWhenDispatched() throws Exception {
        synchronized (service) {
            String creation = service.createTask(Json.object().put("title", "Удалить через HTTP"));
            service.processNext();
            String taskId = Json.text(store.operation(creation).path("detail"), "resultId");
            String path = "/api/tasks/" + taskId;

            mvc.perform(delete(path).header("Origin", "https://foreign.example").contentType(MediaType.APPLICATION_JSON))
                    .andExpect(status().isForbidden());
            String response = mvc.perform(delete(path).contentType(MediaType.APPLICATION_JSON))
                    .andExpect(status().isOk()).andExpect(jsonPath("$.status").value("PENDING"))
                    .andReturn().getResponse().getContentAsString();
            String operation = Json.text(Json.read(response), "operationId");
            assertThat(store.operation(operation).path("kind").asText()).isEqualTo("DELETE_TASK");
            assertThat(store.findEntity("remote_entity", "task", taskId)).isPresent();
            mvc.perform(delete(path).contentType(MediaType.APPLICATION_JSON))
                    .andExpect(status().isOk()).andExpect(jsonPath("$.operationId").value(operation));

            service.processNext();
            assertThat(store.operation(operation).path("status").asText()).isEqualTo("DONE");
            assertThat(store.findEntity("remote_entity", "task", taskId)).isEmpty();
            assertThat(store.findEntity("entity_cache", "task", taskId)).isEmpty();
            assertThat(store.findEntity("remote_entity", "task", "T-demo-0")).isPresent();
            assertThat(store.findEntity("remote_entity", "tag", "A-project-0")).isPresent();
        }
    }
    @Test void rejectsUntrustedBrowserAndInvalidChanges() throws Exception {
        mvc.perform(post("/api/tasks").header("Origin","https://foreign.example").contentType(MediaType.APPLICATION_JSON).content("{\"title\":\"wrong\"}"))
                .andExpect(status().isForbidden());
        mvc.perform(post("/api/tasks").contentType(MediaType.APPLICATION_JSON).content("{\"title\":\" \"}"))
                .andExpect(status().isBadRequest());
        mvc.perform(patch("/api/tasks/T-demo-0").contentType(MediaType.APPLICATION_JSON).content("{\"base\":{\"projectId\":\"P-demo\"},\"changes\":{\"projectId\":\"P-other\"}}"))
                .andExpect(status().isBadRequest());
    }
    @Test void layoutRoundTripsThroughHttpAndPreservesFieldsOnHide() throws Exception {
        mvc.perform(put("/api/layouts/T-demo-2").contentType(MediaType.APPLICATION_JSON).content("{\"x\":555,\"y\":444,\"width\":330,\"height\":120}"))
                .andExpect(status().isOk());
        mvc.perform(put("/api/layouts/T-demo-2").contentType(MediaType.APPLICATION_JSON).content("{\"hidden\":true}"))
                .andExpect(status().isOk());
        mvc.perform(get("/api/board")).andExpect(jsonPath("$.layouts['T-demo-2'].x").value(555))
                .andExpect(jsonPath("$.layouts['T-demo-2'].width").value(330))
                .andExpect(jsonPath("$.layouts['T-demo-2'].hidden").value(true));
    }
}
