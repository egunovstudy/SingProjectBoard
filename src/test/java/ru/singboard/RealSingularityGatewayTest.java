package ru.singboard;

import com.fasterxml.jackson.databind.JsonNode;
import com.sun.net.httpserver.HttpServer;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.net.InetSocketAddress;
import java.net.URI;
import java.net.http.HttpClient;
import java.time.Duration;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;

import static org.assertj.core.api.Assertions.*;

@org.junit.jupiter.api.Tag("network")
class RealSingularityGatewayTest {
    HttpServer server;
    RealSingularityGateway gateway;
    AtomicReference<String> method=new AtomicReference<>();
    AtomicReference<String> requestPath=new AtomicReference<>();
    AtomicReference<JsonNode> body=new AtomicReference<>();
    AtomicReference<String> authorization=new AtomicReference<>();
    AtomicInteger calls=new AtomicInteger();

    @BeforeEach void setup() throws Exception {
        server=HttpServer.create(new InetSocketAddress("127.0.0.1",0),0);
        gateway=new RealSingularityGateway(URI.create("http://127.0.0.1:"+server.getAddress().getPort()),"fake-test-token",HttpClient.newHttpClient(),Duration.ofSeconds(2));
    }
    @AfterEach void stop(){if(server!=null)server.stop(0);}
    void respond(int code,String content){
        server.createContext("/",exchange->{
            method.set(exchange.getRequestMethod());requestPath.set(exchange.getRequestURI().toString());
            authorization.set(exchange.getRequestHeaders().getFirst("Authorization"));calls.incrementAndGet();
            String input=new String(exchange.getRequestBody().readAllBytes(),java.nio.charset.StandardCharsets.UTF_8);
            if(!input.isBlank())body.set(Json.read(input));
            byte[] output=content.getBytes(java.nio.charset.StandardCharsets.UTF_8);
            exchange.getResponseHeaders().add("Content-Type","application/json");
            exchange.getResponseHeaders().add("Retry-After","65");
            exchange.sendResponseHeaders(code,output.length);exchange.getResponseBody().write(output);exchange.close();
        });server.start();
    }
    @Test void paginatesWithAllRecurrencesAndOffsetNotPageSize() {
        server.createContext("/v2/task",exchange->{
            String query=exchange.getRequestURI().getQuery();requestPath.set(query);calls.incrementAndGet();
            String output=query.contains("offset=0")?"{\"tasks\":[{\"id\":\"T-one\"},{\"id\":\"T-two\"}],\"pagination\":{\"total\":3,\"offset\":0,\"count\":2}}":"{\"tasks\":[{\"id\":\"T-three\"}],\"pagination\":{\"total\":3,\"offset\":2,\"count\":1}}";
            byte[] bytes=output.getBytes();exchange.sendResponseHeaders(200,bytes.length);exchange.getResponseBody().write(bytes);exchange.close();
        });server.start();
        assertThat(gateway.tasks()).hasSize(3);
        assertThat(calls.get()).isEqualTo(2);
        assertThat(requestPath.get()).contains("offset=2","includeAllRecurrenceInstances=true","paginationData=true");
    }
    @Test void inconsistentOrEmptyPaginationFailsWithoutPretendingComplete() {
        respond(200,"{\"tags\":[],\"pagination\":{\"total\":2,\"offset\":0,\"count\":0}}");
        assertThatThrownBy(()->gateway.tags()).isInstanceOf(ApiFailure.class).hasMessageContaining("неполная");
    }
    @Test void duplicatePagesFailRatherThanLoopForever() {
        respond(200,"{\"tasks\":[{\"id\":\"T-one\"}],\"pagination\":{\"total\":2,\"offset\":0,\"count\":1}}");
        assertThatThrownBy(()->gateway.tasks()).isInstanceOf(ApiFailure.class);
        assertThat(calls.get()).isEqualTo(2);
    }
    @Test void usesBearerAndPatchWithOnlyRequestedFieldsAndExactDelta() {
        respond(200,"{\"id\":\"T-one\",\"title\":\"Updated\"}");
        String delta=Json.delta("Описание");
        gateway.patchTask("T-one",Json.object().put("note",delta).put("start","2026-11-11"));
        assertThat(method.get()).isEqualTo("PATCH");
        assertThat(requestPath.get()).isEqualTo("/v2/task/T-one");
        assertThat(authorization.get()).isEqualTo("Bearer fake-test-token");
        assertThat(body.get().size()).isEqualTo(2);
        assertThat(Json.text(body.get(),"note")).isEqualTo(delta);
        assertThat(Json.text(body.get(),"start")).isEqualTo("2026-11-11");
    }
    @Test void completionUsesDedicatedPostAndNeverDelete() {
        respond(200,"{\"id\":\"T-one\",\"checked\":1}");
        gateway.complete("T-one",true);
        assertThat(method.get()).isEqualTo("POST");
        assertThat(requestPath.get()).isEqualTo("/v2/task/T-one/complete");
        gateway.complete("T-one",false);
        assertThat(requestPath.get()).isEqualTo("/v2/task/T-one/uncomplete");
    }
    @Test void rateLimitIsExplicitAndDoesNotLeakResponseOrToken() {
        respond(429,"fake-test-token private task contents");
        assertThatThrownBy(()->gateway.task("T-one")).isInstanceOfSatisfying(ApiFailure.class,e->{
            assertThat(e.retryable).isTrue();assertThat(e.retryAfterMillis).isEqualTo(65000);
            assertThat(e.getMessage()).doesNotContain("fake-test-token","private");
        });
    }
    @Test void unauthorizedHasNoFallbackAndNoRetriesInTransport() {
        respond(401,"secret");
        assertThatThrownBy(()->gateway.tasks()).isInstanceOfSatisfying(ApiFailure.class,e->assertThat(e.retryable).isFalse());
        assertThat(calls.get()).isEqualTo(1);
    }
    @Test void missingTokenFailsBeforeSendingRequest() {
        respond(200,"{}");
        gateway=new RealSingularityGateway(URI.create("http://127.0.0.1:"+server.getAddress().getPort()),"",HttpClient.newHttpClient(),Duration.ofSeconds(2));
        assertThatThrownBy(()->gateway.tasks()).isInstanceOf(ApiFailure.class);
        assertThat(calls.get()).isZero();
    }
}
