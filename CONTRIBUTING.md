# Contributing to agent-stream

Issues and PRs are welcome.

## Development setup

**Python:**

```bash
cd packages/python
pip install -e ".[dev]"
python -m pytest tests/ -v
```

**React:**

```bash
cd packages/react
npm install
npm test
npm run build
```

## Adding or changing events

Event types are defined in three places — all must stay in sync:

1. `spec/events.schema.json` — JSON Schema (language-agnostic contract)
2. `packages/python/agent_stream/emitter.py` — Python emitter method
3. `packages/react/src/types.ts` — TypeScript interface

Add tests in:
- `packages/python/tests/test_emitter.py`
- `packages/react/src/__tests__/client.test.ts`

## Commits

Use [Conventional Commits](https://www.conventionalcommits.org/):

- `feat:` new event type or API surface
- `fix:` bug fix
- `docs:` README, examples, comments
- `test:` test-only changes
- `build:` packaging, CI changes

## Pull requests

- One change per PR
- Include tests for new behavior
- Update `CHANGELOG.md` under `[Unreleased]`

## Reporting bugs

Open an issue. Include: Python/Node version, minimal reproduction, expected vs actual behavior.
