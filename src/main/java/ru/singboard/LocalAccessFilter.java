package ru.singboard;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;
import java.net.URI;
import java.util.Set;

@Component
public class LocalAccessFilter extends OncePerRequestFilter {
    private static final Set<String> LOCAL = Set.of("localhost", "127.0.0.1", "[::1]", "::1");
    @Override protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain)
            throws ServletException, IOException {
        response.setHeader("X-Content-Type-Options", "nosniff");
        response.setHeader("X-Frame-Options", "DENY");
        if (request.getRequestURI().startsWith("/api/")) {
            response.setHeader("Cache-Control", "no-store");
            boolean allowed = LOCAL.contains(request.getServerName());
            String origin = request.getHeader("Origin");
            if (origin != null) {
                try {
                    URI uri = URI.create(origin);
                    allowed &= "http".equals(uri.getScheme()) && LOCAL.contains(uri.getHost())
                            && (uri.getPort() == request.getServerPort() || uri.getPort() == 5173);
                } catch (Exception e) { allowed = false; }
            }
            if (!Set.of("GET", "HEAD").contains(request.getMethod()))
                allowed &= request.getContentType() != null && request.getContentType().startsWith("application/json");
            if (!allowed) { response.sendError(403); return; }
        }
        chain.doFilter(request, response);
    }
}
