# AGENTS.md

## Project

WebScoop (`webscoop`) is a cross-platform Electron application for mirroring websites for offline browsing.

Stack:
- Electron 45
- Vue 3 + Vuetify
- Vite via electron-vite
- TypeScript 6
- Pinia, Vue Router, vue-i18n
- Vitest for tests
- ESLint flat config

## Common Commands

Install dependencies:

```sh
npm install
```

Run in development mode:

```sh
npm run dev
```

Type-check the project:

```sh
npm run typecheck
```

Lint:

```sh
npm run lint
```

Run unit tests:

```sh
npm test
```

Run tests in watch mode:

```sh
npm run test:watch
```

Build production bundles into `out/`:

```sh
npm run build
```

Preview the production build:

```sh
npm run build
npm run preview
```

Build platform installers:

```sh
npm run build:win
npm run build:mac
npm run build:linux
npm run build:unpack
```

Run the CLI:

```sh
npm run cli -- https://example.com
```

## Verification Workflow

Before considering a change complete, run:

```sh
npm run lint && npm run typecheck && npm test
```

For UI/build-related changes, also run:

```sh
npm run build
```

## Repository Layout

- `src/main/` - Electron main process
- `src/preload/` - preload bridge exposed to the renderer
- `src/renderer/` - Vue 3 renderer application
- `src/core/` - shared crawler, storage, state, filtering, and utility logic
- `src/core/__tests__/` - Vitest unit tests
- `scripts/` - CLI and helper scripts
- `resources/` - app resources and icons

## Path Aliases

- `@core/*` maps to `src/core/*`
- `@/*` maps to `src/renderer/src/*`

## Coding Conventions

- Keep TypeScript strict and avoid weakening types unless necessary.
- Preserve the existing Vue 3 Composition API and Vuetify patterns.
- Keep changes focused and minimal.
- Do not rename public APIs or IPC channel names without updating all callers.
- Avoid changing dependency versions unless the change is tested.
- Generated output such as `out/`, `dist/`, and `build/` should not be committed.

## Dependency Updates

Major dependency updates require verification with:

```sh
npm run lint
npm run typecheck
npm test
npm run build
```

TypeScript 7 is not currently supported by `vue-tsc` and `typescript-eslint` in this repository, so TypeScript 6 is the current major target. Electron updates should also be checked for preload sandbox and native-module compatibility.

## Native Modules

`better-sqlite3` is rebuilt for Electron automatically during `npm install` through `electron-builder install-app-deps`. No manual rebuild step is normally required.
