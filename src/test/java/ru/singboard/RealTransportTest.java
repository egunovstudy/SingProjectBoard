package ru.singboard;

import org.junit.jupiter.api.Test;
import java.net.URI;
import java.time.Duration;
import java.util.*;
import static org.assertj.core.api.Assertions.*;

class RealTransportTest {
    RealSingularityGateway gateway(HttpClientStub transport){return new RealSingularityGateway(URI.create("https://api.singularity-app.com"),"test-only-token",transport,Duration.ofSeconds(2));}
    @Test void walksAllPagesAndRequestsAllRecurrenceInstances() {
        List<String> queries=new ArrayList<>();
        var client=new HttpClientStub(req->{
            String q=req.uri().getQuery();queries.add(q);
            assertThat(req.headers().firstValue("Authorization")).contains("Bearer test-only-token");
            return HttpClientStub.response(req,200,q.contains("offset=0")?"{\"tasks\":[{\"id\":\"T-a\"},{\"id\":\"T-b\"}],\"pagination\":{\"count\":2,\"offset\":0,\"total\":3}}":"{\"tasks\":[{\"id\":\"T-c\"}],\"pagination\":{\"count\":1,\"offset\":2,\"total\":3}}",Map.of());
        });
        assertThat(gateway(client).tasks()).hasSize(3);
        assertThat(queries).hasSize(2).allSatisfy(q->assertThat(q).contains("includeAllRecurrenceInstances=true","paginationData=true"));
        assertThat(queries.get(1)).contains("offset=2");
    }
    @Test void rejectsIncompletePagesAndUnknownResponseShape() {
        var client=new HttpClientStub(req->HttpClientStub.response(req,200,"{\"tags\":[],\"pagination\":{\"count\":0,\"offset\":0,\"total\":3}}",Map.of()));
        assertThatThrownBy(()->gateway(client).tags()).isInstanceOf(ApiFailure.class).hasMessageContaining("неполная");
        client.handler=req->HttpClientStub.response(req,200,"{\"items\":[]}",Map.of());
        assertThatThrownBy(()->gateway(client).tags()).isInstanceOf(ApiFailure.class).hasMessageContaining("формат");
    }
    @Test void preservesTransportStatusAndRetryAfterWithoutLeakingPayload() {
        var client=new HttpClientStub(req->HttpClientStub.response(req,429,"test-only-token secret text",Map.of("Retry-After",List.of("30"))));
        assertThatThrownBy(()->gateway(client).task("T-a")).isInstanceOfSatisfying(ApiFailure.class,e->{
            assertThat(e.status).isEqualTo(429);assertThat(e.retryable).isTrue();assertThat(e.retryAfterMillis).isEqualTo(30000);assertThat(e.getMessage()).doesNotContain("test-only-token","secret");
        });
    }
    @Test void doesNotFollowUnauthorizedOrUnexpectedCreationIntoDemoData() {
        var client=new HttpClientStub(req->HttpClientStub.response(req,403,"secret",Map.of()));
        assertThatThrownBy(()->gateway(client).tasks()).isInstanceOfSatisfying(ApiFailure.class,e->{assertThat(e.status).isEqualTo(403);assertThat(e.retryable).isFalse();});
        client.handler=req->HttpClientStub.response(req,302,"",Map.of("Location",List.of("https://other.example")));
        assertThatThrownBy(()->gateway(client).tags()).isInstanceOf(ApiFailure.class);
    }
    @Test void usesDocumentedCompletionEndpoints() {
        List<String> paths=new ArrayList<>();
        var client=new HttpClientStub(req->{paths.add(req.method()+" "+req.uri().getPath());return HttpClientStub.response(req,200,"{\"id\":\"T-a\"}",Map.of());});
        var gateway=gateway(client);gateway.complete("T-a",true);gateway.complete("T-a",false);gateway.patchTask("T-a",Json.object().put("title","Название"));
        assertThat(paths).containsExactly("POST /v2/task/T-a/complete","POST /v2/task/T-a/uncomplete","PATCH /v2/task/T-a");
    }

    @Test
    void deletesThroughDocumentedEndpointWithNoBodyAndAcceptsNoContent() {
        var client = new HttpClientStub(req -> {
            assertThat(req.method()).isEqualTo("DELETE");
            assertThat(req.uri().getPath()).isEqualTo("/v2/task/T-a");
            assertThat(req.headers().firstValue("Authorization")).contains("Bearer test-only-token");
            assertThat(req.bodyPublisher().orElseThrow().contentLength()).isZero();
            return HttpClientStub.response(req, 204, "", Map.of());
        });
        gateway(client).deleteTask("T-a");
    }

    @Test
    void identifiesTheFailedRequestWithoutDisplayingTheRemoteErrorBody() {
        var client = new HttpClientStub(req -> HttpClientStub.response(req, 404,
                "{\"message\":\"Project not found: private title\"}", Map.of()));
        assertThatThrownBy(() -> gateway(client).patchTask("T-step", Json.object().put("parent", "T-chain")))
                .isInstanceOfSatisfying(ApiFailure.class, error -> {
                    assertThat(error.status).isEqualTo(404);
                    assertThat(error.retryable).isFalse();
                    assertThat(error.getMessage()).contains("PATCH /v2/task/T-step", "Проект не найден")
                            .doesNotContain("private title", "test-only-token");
                });
    }

    @Test void boundsPaginationAndRejectsRepeatedIds() {
        var client=new HttpClientStub(req->HttpClientStub.response(req,200,"{\"tags\":[{\"id\":\"A-a\"},{\"id\":\"A-a\"}],\"pagination\":{\"count\":2,\"offset\":0,\"total\":2}}",Map.of()));
        assertThatThrownBy(()->gateway(client).tags()).isInstanceOf(ApiFailure.class).hasMessageContaining("Список изменился");
    }
    @Test void malformedTokenCannotBeEchoedToBrowserErrors() {
        var client=new HttpClientStub(req->{throw new AssertionError("Must not send invalid token");});
        var gateway=new RealSingularityGateway(URI.create("https://api.singularity-app.com"),"SECRET\nVALUE",client,Duration.ofSeconds(2));
        assertThatThrownBy(()->gateway.tasks()).isInstanceOf(ApiFailure.class).hasMessageNotContaining("SECRET").hasMessageNotContaining("VALUE");
    }

    @Test
    void readsDirectSubtasksAndWritesScenarioParentThroughRestV2() {
        List<String> paths = new ArrayList<>();
        var client = new HttpClientStub(req -> {
            String path = req.uri().getPath();
            paths.add(req.method() + " " + path);
            if (path.equals("/v2/task")) {
                assertThat(req.uri().getQuery()).contains("parent=T-chain", "includeAllRecurrenceInstances=true", "isNote=false");
                return HttpClientStub.response(req, 200, """
                        {"tasks":[{"id":"T-step","parent":"T-chain","parentOrder":12.5}],
                         "pagination":{"count":1,"offset":0,"total":1}}
                        """, Map.of());
            }
            return HttpClientStub.response(req, 200, """
                    {"id":"A-child","title":"Подцель","parent":"A-goal"}
                    """, Map.of());
        });
        var gateway = gateway(client);
        assertThat(gateway.childTasks("T-chain").getFirst().path("parentOrder").asDouble()).isEqualTo(12.5);
        gateway.tag("A-child");
        assertThat(Json.text(gateway.patchTag("A-child", Json.object().put("title", "Подцель").put("parent", "A-goal")), "parent"))
                .isEqualTo("A-goal");
        assertThat(paths).containsExactly("GET /v2/task", "GET /v2/tag/A-child", "PATCH /v2/tag/A-child");
    }

}
