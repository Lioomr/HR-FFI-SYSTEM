FROM node:22-alpine AS build

WORKDIR /app

COPY package*.json /app/
RUN npm ci

COPY . /app

# Vite reads FrontEnd/.env during this disposable build stage. Only VITE_*
# values belong there because those values are compiled into browser assets.
ARG VITE_API_BASE_URL=
ENV VITE_API_BASE_URL=${VITE_API_BASE_URL}

RUN npm run build

FROM nginx:1.27-alpine

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80
