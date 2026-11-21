package ru.singboard;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import static org.assertj.core.api.Assertions.*;

@SpringBootTest(webEnvironment=SpringBootTest.WebEnvironment.NONE, properties={
    "app.mode=real","app.token=","spring.datasource.url=jdbc:h2:mem:real-context;MODE=PostgreSQL;DB_CLOSE_DELAY=-1",
    "spring.datasource.username=sa","spring.datasource.password="
})
class RealModeContextTest {
    @Autowired BoardService service;
    @Autowired SingularityGateway gateway;
    @Test void realModeWiresRealAdapterAndMissingCredentialDoesNotSeedOrSwitchToDemo() {
        assertThat(gateway).isInstanceOf(RealSingularityGateway.class);
        service.sync();
        var board=service.board();
        assertThat(board.path("mode").asText()).isEqualTo("real");
        assertThat(board.path("tasks").size()).isZero();
        assertThat(board.path("tags").size()).isZero();
        assertThat(board.path("sync").path("error").asText()).contains("SINGULARITY_API_TOKEN");
        assertThat(board.path("settings").path("rootTagId").asText()).isEmpty();
    }
}
