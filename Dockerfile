# We build our container using node:16-alpine
FROM node:20-alpine AS builder
ENV NODE_ENV=development

# Change dir to install dir.
WORKDIR /usr/src/custommailcow-ldap

# Copy over the package and package-lock
COPY package.json .
COPY yarn.lock .

COPY tsconfig.json .
COPY .yarnrc.yml /usr/src/app

# Copy over the source files
COPY src/ ./src/

# Install dependencies
RUN corepack enable && \
    yarn install --immutable

# Transpile the typescript files
RUN yarn build


# Create production container.
FROM node:20-alpine AS prod

# Set correct dir.
WORKDIR /app

# Copy over the package and package-lock
COPY package.json .
COPY yarn.lock .
COPY .yarnrc.yml .

# Install production dependencies
RUN corepack enable && \
    yarn install && \
    yarn cache clean

# Copy over the template data
COPY templates /app/templates

# Copy over the source files from the builder
COPY --from=builder /usr/src/custommailcow-ldap/dist/src/ /app/src/

# Set correct priv.
USER root

VOLUME [ "/app/db" ]
VOLUME [ "/app/conf/dovecot" ]
VOLUME [ "/app/conf/sogo" ]

CMD ["node", "/app/src/index.js"]
