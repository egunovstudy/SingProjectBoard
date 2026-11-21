package ru.singboard;

import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockFilterChain;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;

import static org.assertj.core.api.Assertions.*;

class LocalAccessFilterTest {
    MockHttpServletRequest request(String method,String origin,String contentType){
        var req=new MockHttpServletRequest(method,"/api/tasks");req.setServerName("127.0.0.1");req.setServerPort(8080);
        if(origin!=null)req.addHeader("Origin",origin);if(contentType!=null)req.setContentType(contentType);return req;
    }
    @Test void rejectsForeignOriginAndFormPosts() throws Exception {
        var filter=new LocalAccessFilter();var response=new MockHttpServletResponse();
        filter.doFilter(request("POST","https://evil.example","application/json"),response,new MockFilterChain());
        assertThat(response.getStatus()).isEqualTo(403);
        response=new MockHttpServletResponse();filter.doFilter(request("POST",null,"application/x-www-form-urlencoded"),response,new MockFilterChain());
        assertThat(response.getStatus()).isEqualTo(403);
    }
    @Test void allowsLocalUiAndRejectsReboundHost() throws Exception {
        var filter=new LocalAccessFilter();var response=new MockHttpServletResponse();
        filter.doFilter(request("POST","http://127.0.0.1:5173","application/json"),response,new MockFilterChain());
        assertThat(response.getStatus()).isEqualTo(200);
        var req=request("GET",null,null);req.setServerName("evil.example");response=new MockHttpServletResponse();
        filter.doFilter(req,response,new MockFilterChain());assertThat(response.getStatus()).isEqualTo(403);
    }
}
