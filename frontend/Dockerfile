FROM node:20-alpine AS base
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .

# Dev: Vite dev server (para HMR en desarrollo fuera de Docker)
FROM base AS dev
EXPOSE 5173
CMD ["npm", "run", "dev"]

# Preview: build de producción servido con nginx (para docker-compose local)
# Sin problemas de seguridad de Vite 5.4 detrás de reverse proxy.
FROM base AS builder
RUN npm run build

FROM nginx:alpine AS preview
COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx-preview.conf /etc/nginx/conf.d/default.conf
EXPOSE 5173
CMD ["nginx", "-g", "daemon off;"]
