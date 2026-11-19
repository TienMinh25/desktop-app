FROM electronuserland/builder:wine

SHELL ["/bin/bash", "-o", "pipefail", "-c"]

# Trust host Root CA certificates (for corporate proxy / SSL inspection)
COPY .docker-host-ca.crt /tmp/host-ca.crt
RUN if [ -s /tmp/host-ca.crt ]; then \
      cat /tmp/host-ca.crt >> /etc/ssl/certs/ca-certificates.crt; \
    fi && rm -f /tmp/host-ca.crt

ENV SSL_CERT_FILE=/etc/ssl/certs/ca-certificates.crt
ENV NODE_EXTRA_CA_CERTS=/etc/ssl/certs/ca-certificates.crt
ENV CURL_CA_BUNDLE=/etc/ssl/certs/ca-certificates.crt
ENV GIT_SSL_CAINFO=/etc/ssl/certs/ca-certificates.crt
ENV ELECTRON_CACHE=/root/.cache/electron
ENV ELECTRON_BUILDER_CACHE=/root/.cache/electron-builder

# Install Bun via npm (uses registry.npmjs.org, allowed by corporate proxy)
RUN npm install -g bun

WORKDIR /app

# Install dependencies first for layer caching (skip Linux electron binary postinstall)
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --ignore-scripts && \
    for pkg in win32-x64 darwin-x64 darwin-arm64; do \
      mkdir -p "node_modules/@vscode/ripgrep-${pkg}" && \
      curl -fsSL "https://registry.npmjs.org/@vscode/ripgrep-${pkg}/-/ripgrep-${pkg}-1.18.0.tgz" \
        | tar -xz -C "node_modules/@vscode/ripgrep-${pkg}" --strip-components=1 && \
      chmod +x "node_modules/@vscode/ripgrep-${pkg}/bin/"* || true; \
    done

# Copy source and build configuration
COPY . .

# Build-time environment variables (can be passed via --build-arg, -e / --env-file, or .env)
ARG BACKEND_HOST=""
ARG MCP_REGISTRY_BASE_URL="https://registry.modelcontextprotocol.io"
ARG MCP_REGISTRY_API_VERSION="v0.1"
ARG UPDATE_FEED_URL="https://updates.ccodex.com/releases"

ENV BACKEND_HOST=${BACKEND_HOST}
ENV MCP_REGISTRY_BASE_URL=${MCP_REGISTRY_BASE_URL}
ENV MCP_REGISTRY_API_VERSION=${MCP_REGISTRY_API_VERSION}
ENV UPDATE_FEED_URL=${UPDATE_FEED_URL}

# Default: build both Windows (.exe) and macOS (.zip) packages into /app/release
CMD ["bun", "run", "build:all"]
