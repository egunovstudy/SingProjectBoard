package ru.singboard;

import com.fasterxml.jackson.databind.JsonNode;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Component;

import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;

@Component
@ConditionalOnProperty(name = "app.mode", havingValue = "real")
public class RealSingularityGateway implements SingularityGateway {
    private final String token;
    private final URI base;
    private final HttpClient client;
    private final Duration timeout;
    private volatile long blockedUntil;

    @org.springframework.beans.factory.annotation.Autowired
    public RealSingularityGateway(@Value("${app.token}") String token) {
        this(URI.create("https://api.singularity-app.com"), token,
                HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(10)).followRedirects(HttpClient.Redirect.NEVER).build(),
                Duration.ofSeconds(25));
    }
    // Explicit constructor is used only by local fake-server tests.
    RealSingularityGateway(URI base, String token, HttpClient client, Duration timeout) {
        this.base = base;
        this.token = token;
        this.client = client;
        this.timeout = timeout;
    }
    JsonNode request(String method, String path, JsonNode body) {
        if (token.isBlank()) throw new ApiFailure(401, false, "Задайте SINGULARITY_API_TOKEN на сервере");
        if (!token.matches("[!-~]+")) throw new ApiFailure(401, false, "Некорректный формат серверного токена");
        long remaining = blockedUntil - System.currentTimeMillis();
        if (remaining > 0) throw new ApiFailure(429, true, "Singularity: ожидаем окончания ограничения частоты", remaining);
        HttpRequest.Builder builder = HttpRequest.newBuilder(base.resolve(path)).timeout(timeout)
                .header("Authorization", "Bearer " + token).header("Accept", "application/json");
        builder.method(method, body == null ? HttpRequest.BodyPublishers.noBody()
                : HttpRequest.BodyPublishers.ofString(body.toString()));
        if (body != null) builder.header("Content-Type", "application/json");
        try {
            HttpResponse<String> response = client.send(builder.build(), HttpResponse.BodyHandlers.ofString());
            int code = response.statusCode();
            if (code < 200 || code >= 300) {
                long delay = response.headers().firstValue("Retry-After").map(v -> {
                    try { return Math.min(3_600_000L, Math.max(0, Long.parseLong(v) * 1000)); }
                    catch (NumberFormatException e) {
                        try { return Math.max(0, java.time.ZonedDateTime.parse(v, java.time.format.DateTimeFormatter.RFC_1123_DATE_TIME).toInstant().toEpochMilli() - System.currentTimeMillis()); }
                        catch (Exception ignored) { return 60_000L; }
                    }
                }).orElse(code == 429 ? 60_000L : 0L);
                if (code == 429) blockedUntil = System.currentTimeMillis() + delay;
                throw new ApiFailure(code, code == 429 || code >= 500, switch (code) {
                    case 401, 403 -> "Singularity: доступ запрещён (" + code + "). Проверьте токен и тариф";
                    case 429 -> "Singularity: ограничение частоты запросов";
                    default -> "Singularity: HTTP " + code;
                }, delay);
            }
            return response.body().isBlank() ? Json.object() : Json.read(response.body());
        } catch (java.io.IOException e) {
            throw new ApiFailure(0, true, "Singularity недоступен: ошибка сети или тайм-аут");
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new ApiFailure(0, true, "Запрос прерван; результат требует проверки");
        }
    }
    List<JsonNode> list(String resource, String key, String query) {
        List<JsonNode> result = new ArrayList<>();
        HashSet<String> ids = new HashSet<>();
        int offset = 0;
        for (int page = 0; page < 10000; page++) {
            JsonNode response = request("GET", "/v2/" + resource + "?maxCount=100&paginationData=true&offset=" + offset + query, null);
            JsonNode values = response.path(key);
            if (!values.isArray()) throw new ApiFailure(0, false, "Singularity: неожиданный формат списка " + key);
            for (JsonNode value : values) {
                if (!Json.hasText(value, "id") || !ids.add(Json.text(value, "id")))
                    throw new ApiFailure(0, true, "Список изменился во время загрузки; повторите синхронизацию");
                result.add(value);
            }
            JsonNode pagination = response.path("pagination");
            if (!pagination.has("total") || pagination.path("offset").asInt(-1) != offset
                    || pagination.path("count").asInt(-1) != values.size())
                throw new ApiFailure(0, false, "Singularity: некорректная пагинация");
            offset += values.size();
            if (offset >= pagination.path("total").asInt()) return result;
            if (values.isEmpty()) throw new ApiFailure(0, true, "Singularity: неполная страница; кэш сохранён");
        }
        throw new ApiFailure(0, false, "Превышен предел страниц; кэш сохранён");
    }
    @Override public List<JsonNode> tasks() { return list("task", "tasks", "&includeAllRecurrenceInstances=true&includeRemoved=false&includeArchived=false&isNote=false"); }
    @Override
    public List<JsonNode> childTasks(String parent) {
        return list("task", "tasks",
                "&includeAllRecurrenceInstances=true&includeRemoved=false&includeArchived=false&isNote=false&parent=" + id(parent));
    }
    @Override public List<JsonNode> tags() { return list("tag", "tags", "&includeRemoved=false"); }
    @Override public List<JsonNode> projects() { return list("project", "projects", "&includeRemoved=false&includeArchived=false"); }
    private String id(String value) { return URLEncoder.encode(value, StandardCharsets.UTF_8); }
    @Override public JsonNode task(String id) { return request("GET", "/v2/task/" + id(id), null); }
    @Override public void deleteTask(String id) { request("DELETE", "/v2/task/" + id(id), null); }
    @Override public JsonNode patchTask(String id, JsonNode patch) { return request("PATCH", "/v2/task/" + id(id), patch); }
    @Override public JsonNode complete(String id, boolean complete) { return request("POST", "/v2/task/" + id(id) + (complete ? "/complete" : "/uncomplete"), null); }
    @Override public JsonNode createTask(JsonNode payload) { return request("POST", "/v2/task", payload); }
    @Override public JsonNode createTag(JsonNode payload) { return request("POST", "/v2/tag", payload); }
    @Override public JsonNode tag(String id) { return request("GET", "/v2/tag/" + id(id), null); }
    @Override public JsonNode patchTag(String id, JsonNode patch) { return request("PATCH", "/v2/tag/" + id(id), patch); }
}
