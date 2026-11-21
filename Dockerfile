FROM node:22-bookworm-slim AS frontend
WORKDIR /web
COPY frontend/package.json frontend/yarn.lock ./
RUN corepack enable && yarn install --frozen-lockfile --non-interactive
COPY frontend/ ./
RUN yarn build

FROM eclipse-temurin:21-jdk-jammy AS backend
WORKDIR /build
COPY .mvn .mvn
COPY mvnw pom.xml ./
COPY src ./src
COPY --from=frontend /web/dist ./frontend/dist
RUN ./mvnw -B -DskipTests package

FROM eclipse-temurin:21-jre-alpine
WORKDIR /app
RUN addgroup -S board && adduser -S -G board board
COPY --from=backend /build/target/singboard-0.1.0.jar app.jar
USER board
ENV SERVER_ADDRESS=0.0.0.0
EXPOSE 8080
HEALTHCHECK --interval=20s --timeout=5s --start-period=60s --retries=3 CMD wget -q -O - http://127.0.0.1:8080/api/health || exit 1
ENTRYPOINT ["java", "-jar", "/app/app.jar"]
