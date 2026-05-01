# Contributing to xPaymind

Thank you for your interest in contributing!

## How to contribute

1. **Fork** the repository
2. **Clone** your fork
3. **Create a branch**: `git checkout -b feat/my-feature`
4. **Install**: `pnpm install`
5. **Make changes** and add tests
6. **Verify**: `pnpm typecheck && pnpm test && pnpm lint`
7. **Commit** using [Conventional Commits](https://www.conventionalcommits.org/)
8. **Push** and open a Pull Request

## Development setup

```bash
git clone https://github.com/xPaymind/xpaymind.git
cd xpaymind
pnpm install
pnpm build
pnpm test
```

## Commit convention

```
feat(scope): add new feature
fix(scope): fix a bug
docs: update documentation
test: add or update tests
chore: maintenance tasks
ci: CI/CD changes
```

**Scope** is one of: `core`, `evaluator`, `sdk`, `cli`, `api`, `docs`

## Questions?

Join us on [Discord](https://discord.gg/xpaymind) in the `#dev` channel.
