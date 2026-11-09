FROM node:20-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
ARG VITE_API_BASE=
ARG VITE_USE_MOCK=auto
ARG VITE_ENVIRONMENT=production
ARG VITE_FRONTEND_VERSION=1.0.0
ENV VITE_API_BASE=$VITE_API_BASE VITE_USE_MOCK=$VITE_USE_MOCK VITE_ENVIRONMENT=$VITE_ENVIRONMENT VITE_FRONTEND_VERSION=$VITE_FRONTEND_VERSION
RUN npm run build

FROM nginx:alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 CMD wget -q -O /dev/null http://127.0.0.1/ || exit 1
CMD ["nginx", "-g", "daemon off;"]
