package ru.singboard;

import javax.net.ssl.SSLContext;
import javax.net.ssl.SSLParameters;
import javax.net.ssl.SSLSession;
import java.io.IOException;
import java.net.Authenticator;
import java.net.CookieHandler;
import java.net.ProxySelector;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpHeaders;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.Executor;
import java.util.function.Function;

// A deterministic transport for offline unit tests; real TCP tests live alongside it.
class HttpClientStub extends HttpClient {
    Function<HttpRequest, HttpResponse<String>> handler;
    HttpClientStub(Function<HttpRequest,HttpResponse<String>> handler){this.handler=handler;}
    static HttpResponse<String> response(HttpRequest request,int status,String body,Map<String,List<String>> headers){
        return new HttpResponse<>() {
            public int statusCode(){return status;}
            public HttpRequest request(){return request;}
            public Optional<HttpResponse<String>> previousResponse(){return Optional.empty();}
            public HttpHeaders headers(){return HttpHeaders.of(headers,(a,b)->true);}
            public String body(){return body;}
            public Optional<SSLSession> sslSession(){return Optional.empty();}
            public URI uri(){return request.uri();}
            public HttpClient.Version version(){return HttpClient.Version.HTTP_1_1;}
        };
    }
    @SuppressWarnings("unchecked")
    public <T> HttpResponse<T> send(HttpRequest request,HttpResponse.BodyHandler<T> handler)throws IOException,InterruptedException{return (HttpResponse<T>)this.handler.apply(request);}
    public Optional<CookieHandler> cookieHandler(){return Optional.empty();}
    public Optional<Duration> connectTimeout(){return Optional.of(Duration.ofSeconds(1));}
    public Redirect followRedirects(){return Redirect.NEVER;}
    public Optional<ProxySelector> proxy(){return Optional.empty();}
    public SSLContext sslContext(){try{return SSLContext.getDefault();}catch(Exception e){throw new IllegalStateException(e);}}
    public SSLParameters sslParameters(){return new SSLParameters();}
    public Optional<Authenticator> authenticator(){return Optional.empty();}
    public Version version(){return Version.HTTP_1_1;}
    public Optional<Executor> executor(){return Optional.empty();}
    public <T> CompletableFuture<HttpResponse<T>> sendAsync(HttpRequest req,HttpResponse.BodyHandler<T> handler){throw new UnsupportedOperationException();}
    public <T> CompletableFuture<HttpResponse<T>> sendAsync(HttpRequest req,HttpResponse.BodyHandler<T> handler,HttpResponse.PushPromiseHandler<T> promise){throw new UnsupportedOperationException();}
}
