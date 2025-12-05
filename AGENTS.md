# pulldash

Pulldash is the fastest way to review pull requests.

## Development

Use `bun` for everything - package management, tests.

_NEVER_ use browser tools - they will not work with this project.

## Principles

- Performance is P1. If things feel laggy or are not smooth, it is of the utmost importance to fix. Pulldash exists because GitHub's PR review is slow.
- Tests should primarily occur at the data-layer, and the frontend should mostly dummily render the data.

## Testing

Tests should be minimal, not conflict with each other, and not be race-prone.

If you make changes to a file that has tests, you should ensure the tests pass and add a test-case if one does not already exist covering it.
We do not want duplicative tiny tests, but we want cases to be covered.

Good:

- `import { test } from "bun:test"`
- File being tested: "file-name.tsx" -> test name: "file-name.test.tsx"

Bad:

- `import { it } from "bun:test"`
- Any form of timing-based test (e.g. `setTimeout`, `setImmediate`, etc)
- Deep nesting of tests
- File being tested: "my-component.tsx" -> test name: "debug.test.tsx"

## Linting

Always run `bun typecheck` and `bun fmt` after changes to ensure that files are formatted and have no type errors.

## Debugging

If the user provides a PR identifier, you should use the `gh` CLI to inspect the API so we can fix our implementation if it appears incorrect.
