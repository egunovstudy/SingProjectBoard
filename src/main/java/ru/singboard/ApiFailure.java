package ru.singboard;

public class ApiFailure extends RuntimeException {
    final int status;
    final boolean retryable;
    final long retryAfterMillis;

    public ApiFailure(int status, boolean retryable, String message) { this(status, retryable, message, 0); }
    public ApiFailure(int status, boolean retryable, String message, long retryAfterMillis) {
        super(message);
        this.status = status;
        this.retryable = retryable;
        this.retryAfterMillis = retryAfterMillis;
    }
}
