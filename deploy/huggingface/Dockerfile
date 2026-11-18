# Online demo of the Nursery Command Center as a free Hugging Face Space (Docker, no card).
# Paste this file as the Space's "Dockerfile". It builds the `preview` branch from GitHub and
# runs the app with its own throwaway database. Made-up data only (CLAUDE.md rule 10).
FROM postgres:16-bookworm
COPY --from=node:22-bookworm-slim /usr/local /usr/local
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates \
 && rm -rf /var/lib/apt/lists/* && corepack enable pnpm && useradd -m -u 1000 user
USER user
WORKDIR /home/user
# Re-download the code whenever the preview branch has a new commit.
ADD https://api.github.com/repos/abdelhamidm23/Yanmu-APP-Project/commits/preview /tmp/latest-commit.json
RUN git clone --depth 1 -b preview https://github.com/abdelhamidm23/Yanmu-APP-Project.git app
WORKDIR /home/user/app
ENV DEMO_MODE=true NEXT_TELEMETRY_DISABLED=1 PORT=7860 COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN pnpm install --frozen-lockfile && pnpm build
EXPOSE 7860
ENTRYPOINT []
CMD ["sh", "scripts/demo-container.sh"]
