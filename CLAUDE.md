# CLAUDE.md

Project conventions for agents live in **[AGENTS.md](./AGENTS.md)** — read it first.

Most important, because they fail silently:

- **Contract addresses have ONE home: `@workspace/contracts`** (`packages/contracts/src/index.ts`). Never hard-code an address or add a `*_LAUNCH_FACTORY` env var — the web app and indexer both import the package so they can't point at different factories.
- **ABIs are generated from `arc-launchpad/abi/*.json`, never hand-edited.**
- **The indexer's `TokenLaunched` event must byte-match the deployed factory** or it indexes zero launches with no error.

See AGENTS.md § "Contract addresses, ABIs, and the indexer" for the full checklist.
