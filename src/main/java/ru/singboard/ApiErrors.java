package ru.singboard;

import com.fasterxml.jackson.databind.node.ObjectNode;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

@RestControllerAdvice
public class ApiErrors {
    @ExceptionHandler(IllegalArgumentException.class)
    ResponseEntity<ObjectNode> invalid(IllegalArgumentException e) { return ResponseEntity.badRequest().body(Json.object().put("error", e.getMessage())); }
    @ExceptionHandler(ApiFailure.class)
    ResponseEntity<ObjectNode> api(ApiFailure e) { return ResponseEntity.status(502).body(Json.object().put("error", e.getMessage())); }
    @ExceptionHandler(org.springframework.web.HttpRequestMethodNotSupportedException.class)
    ResponseEntity<ObjectNode> methodNotAllowed(Exception e) { return ResponseEntity.status(405).body(Json.object().put("error", "Метод не поддерживается")); }
    @ExceptionHandler(org.springframework.http.converter.HttpMessageNotReadableException.class)
    ResponseEntity<ObjectNode> badJson(Exception e) { return ResponseEntity.badRequest().body(Json.object().put("error", "Некорректный JSON запроса")); }
    @ExceptionHandler(Exception.class)
    ResponseEntity<ObjectNode> unexpected(Exception e) {
        return ResponseEntity.internalServerError().body(Json.object().put("error", "Внутренняя ошибка. Последние сохранённые данные остаются в базе"));
    }
}
