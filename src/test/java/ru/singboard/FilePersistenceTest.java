package ru.singboard;

import liquibase.integration.spring.SpringLiquibase;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DataSourceTransactionManager;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.springframework.transaction.support.TransactionTemplate;
import java.nio.file.Path;
import static org.assertj.core.api.Assertions.*;

class FilePersistenceTest {
    @TempDir Path directory;
    Store open(String url) throws Exception {
        var ds=new DriverManagerDataSource(url,"sa","");
        var migration=new SpringLiquibase();migration.setDataSource(ds);migration.setChangeLog("classpath:db/changelog/master.xml");migration.afterPropertiesSet();
        return new Store(new JdbcTemplate(ds),new TransactionTemplate(new DataSourceTransactionManager(ds)),"demo","Europe/Moscow");
    }
    @Test void independentStoreAndAdapterReopenFileWithLayoutSettingsAndPendingOperationsIntact() throws Exception {
        String url="jdbc:h2:file:"+directory.resolve("board")+";MODE=PostgreSQL";
        Store first=open(url);var demo=new DemoSingularityGateway(first);demo.seed();
        new BoardService(first,demo).sync();
        first.layout("T-demo-0",Json.object().put("x",333).put("y",444).put("width",350).put("height",160));
        var settings=first.settings();settings.put("xAxis","Моя ось");settings.set("matrixBounds",Json.object().put("left",-500).put("top",-300).put("right",2200).put("bottom",1800));first.settings(settings);
        String operation=first.enqueue("TAG","T-demo-0",Json.object().put("tagId","A-project-1").put("add",true));
        Store second=open(url);var reopened=new DemoSingularityGateway(second);reopened.seed();
        assertThat(reopened.tasks()).hasSize(14);
        assertThat(second.layouts().path("T-demo-0").path("width").asInt()).isEqualTo(350);
        assertThat(second.layouts().path("T-demo-0").path("y").asInt()).isEqualTo(444);
        assertThat(Json.text(second.settings(),"xAxis")).isEqualTo("Моя ось");
        assertThat(second.settings().path("matrixBounds").path("right").asInt()).isEqualTo(2200);
        assertThat(Json.text(second.operation(operation),"status")).isEqualTo("PENDING");
        var service=new BoardService(second,reopened);service.processNext();
        assertThat(Json.text(second.operation(operation),"status")).isEqualTo("DONE");
        assertThat(reopened.task("T-demo-0").path("tags")).contains(Json.MAPPER.valueToTree("A-project-1"),Json.MAPPER.valueToTree("A-ordinary"));
    }
}
