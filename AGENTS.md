# arcwave

OAuth 2.0 / OIDC библиотека на TypeScript, замена Arctic, который объявлен устаревшим. Провайдеры не унифицируются на уровне протокола, общий только результат (`Account`). Пакет публикуется в npm как `arcwave`.

Решения по модулям — в [docs/decisions.md](docs/decisions.md).

## Стек

- Bun, TypeScript в режиме strict, только ESM.
- `jose` для JWT (id_token).
- `drizzle-orm`: только Postgres (`pg-core`).
- `h11`: HTTP-адаптер.
- Тесты: `bun:test`. Интеграционные тесты идут на PGlite, это Postgres в WASM.

## Команды

```sh
bun install
bun test
bunx tsc --noEmit
bun run build        # build:js + build:types → dist/
```

CI (`.github/workflows/ci.yml`) запускает tsc, тесты и сборку. Публикация (`publish.yml`) идёт через npm Trusted Publishing.

## Структура

```
src/
  arcwave.ts          точка входа "arcwave"
  core.ts             AuthCore (базовый класс провайдера), тип Account
  types.ts            ProviderConfig
  utils.ts            buildUrl
  crypto/             randomToken, PKCE, sha256, сравнение за постоянное время
  token/              getToken — обмен code на токены
  providers/          google.ts, github.ts, yandex.ts
  db/schema.ts        точка входа "arcwave/schema": функции create*Table и готовые arcwaveSchema, users, accounts, sessions
  adapters/h11/       точка входа "arcwave/h11": обработчики stage1/stage2, guard, logout, сессии, запросы к БД
```

## Экспорты

- `arcwave`: `src/arcwave.ts`. Провайдеры и crypto, без Drizzle-таблиц.
- `arcwave/h11`: `src/adapters/h11/h11.ts`. Функции `create*Table` тоже экспортируются отсюда, для совместимости.
- `arcwave/schema`: `src/db/schema.ts`.

Новая точка входа добавляется в трёх местах: `exports` в `package.json`, скрипт `build:js` и `include` в `tsconfig.build.json`.
