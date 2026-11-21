package ru.singboard;
import com.fasterxml.jackson.databind.JsonNode;
import java.util.List;

class DelegatingGateway implements SingularityGateway {
    final SingularityGateway delegate;
    DelegatingGateway(SingularityGateway delegate){this.delegate=delegate;}
    public List<JsonNode> tasks(){return delegate.tasks();}
    public List<JsonNode> childTasks(String parent){return delegate.childTasks(parent);}
    public List<JsonNode> tags(){return delegate.tags();}
    public List<JsonNode> projects(){return delegate.projects();}
    public JsonNode task(String id){return delegate.task(id);}
    public void deleteTask(String id){delegate.deleteTask(id);}
    public JsonNode patchTask(String id,JsonNode patch){return delegate.patchTask(id,patch);}
    public JsonNode complete(String id,boolean complete){return delegate.complete(id,complete);}
    public JsonNode createTask(JsonNode payload){return delegate.createTask(payload);}
    public JsonNode createTag(JsonNode payload){return delegate.createTag(payload);}
    public JsonNode tag(String id){return delegate.tag(id);}
    public JsonNode patchTag(String id, JsonNode patch){return delegate.patchTag(id, patch);}
}
