FROM node:22-alpine AS build

WORKDIR /app

COPY package*.json /app/
RUN npm ci

COPY . /app

# Vite reads FrontEnd/.env during this disposable build stage. Only VITE_*
# values belong there because those values are compiled into browser assets.
ARG VITE_API_BASE_URL=
ENV VITE_API_BASE_URL=${VITE_API_BASE_URL}

RUN npm run build && node scripts/precompress.mjs

FROM nginx:1.27-alpine

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html

# Build provenance, so anyone can tell which commit a running container serves:
# `docker inspect` shows the labels and /build-info.json is readable in the
# browser. tools/dev-compose.* fills these in; plain builds say "unknown".
# The checkout path stays in the compose-level image label only, never in the
# served file.
ARG FFI_BUILD_COMMIT=unknown
ARG FFI_BUILD_DIRTY=unknown
ARG FFI_BUILD_TIME=unknown
LABEL com.ffi.build.commit=$FFI_BUILD_COMMIT \
      com.ffi.build.dirty=$FFI_BUILD_DIRTY \
      com.ffi.build.time=$FFI_BUILD_TIME
RUN printf '{"commit":"%s","dirty":"%s","built_at":"%s"}\n' \
      "$FFI_BUILD_COMMIT" "$FFI_BUILD_DIRTY" "$FFI_BUILD_TIME" \
      > /usr/share/nginx/html/build-info.json

EXPOSE 80
