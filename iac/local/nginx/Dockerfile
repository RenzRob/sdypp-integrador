# Stage 1: build del frontend React
FROM node:20-alpine AS frontend-builder
WORKDIR /app
COPY frontend/package*.json ./
RUN npm install
COPY frontend/ ./
RUN npm run build

# Stage 2: nginx que sirve el frontend estático + proxea las APIs
# El nginx.conf rutea /api/* a los servicios backend; el resto sirve estáticos.
FROM nginx:1.25-alpine
COPY iac/local/nginx/nginx.conf /etc/nginx/nginx.conf
COPY --from=frontend-builder /app/dist /usr/share/nginx/html
