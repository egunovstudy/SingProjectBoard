package ru.singboard;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import static org.assertj.core.api.Assertions.*;

@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.NONE, properties = {
    "app.mode=demo", "app.token=", "spring.datasource.url=jdbc:h2:mem:context;MODE=PostgreSQL;DB_CLOSE_DELAY=-1",
    "spring.datasource.username=sa", "spring.datasource.password="
})
class ApplicationContextTest {
    @Autowired BoardService service;
    @Test void applicationWiresMigratesAndLoadsDemoWithoutCredentials() {
        service.sync();
        assertThat(service.board().path("mode").asText()).isEqualTo("demo");
        assertThat(service.board().path("tasks").size()).isEqualTo(14);
    }
}
