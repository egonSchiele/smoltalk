# Smoltalk monorepo

This repo hosts:

- **[`smoltalk`](./packages/smoltalk/)** — the core unified-API LLM client (cloud providers: OpenAI, Anthropic, Google, Ollama).
- **[`smoltalk-llama-cpp`](./packages/smoltalk-llama-cpp/)** — `node-llama-cpp` provider plugin for running models locally.

See each package's README for usage.

## Working in the repo

```bash
pnpm install   # install everything
make           # build all packages
make test      # run tests in all packages
make publish   # build then `pnpm publish` in each package
```
