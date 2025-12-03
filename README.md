# pulldash

The fastest way to review pull requests—a native desktop app that makes massive PRs feel instant.

- Keyboard-driven workflow: navigate, comment, and approve without touching your mouse
- Handles giant diffs smoothly: virtualized rendering keeps you at 60fps even on 10k+ line changes
- Uses your GitHub credentials: no app install on GitHub, no OAuth dance

Originally created for internal use at [Coder](https://coder.com), but designed to work with any GitHub repository.

## Try It

- [Live Demo](https://pulldash.com) to explore the UI (read-only).

- On your computer:

  Download the latest release for your platform:

  | Platform | Download |
  | -------- | -------- |
  | macOS (Apple Silicon) | [Pulldash-0.0.2-arm64.dmg](https://github.com/coder/pulldash/releases/download/v0.0.2/Pulldash-0.0.2-arm64.dmg) |
  | macOS (Intel) | [Pulldash-0.0.2.dmg](https://github.com/coder/pulldash/releases/download/v0.0.2/Pulldash-0.0.2.dmg) |
  | Windows | [Pulldash-Setup-0.0.2.exe](https://github.com/coder/pulldash/releases/download/v0.0.2/Pulldash-Setup-0.0.2.exe) |
  | Linux | [Pulldash-0.0.2.AppImage](https://github.com/coder/pulldash/releases/download/v0.0.2/Pulldash-0.0.2.AppImage) |

  Or view all releases on the [releases page](https://github.com/coder/pulldash/releases).

## Why Not GitHub's Web UI?

GitHub's PR interface works, but it wasn't built for speed:

| Issue | GitHub Web | Pulldash |
| ----- | ---------- | -------- |
| **Large PRs** | Truncates diffs, loads slowly | ✓ Renders everything, stays smooth |
| **Keyboard navigation** | Limited shortcuts | ✓ Full keyboard-driven workflow |
| **Multi-file review** | Constant page loads | ✓ Instant tab switching |
| **Context switching** | Browser tabs everywhere | ✓ Dedicated app, focused experience |

## Keyboard Shortcuts

| Action | Shortcut |
| ------ | -------- |
| Command palette | `⌘K` or `⌘P` |
| Switch tabs | `⌘1` - `⌘9` |
| Close tab | `⌘W` |
| Navigate files | `↑` `↓` in palette |

## Development

> Requires [Bun](https://bun.sh).

```bash
bun install
bun run electron:dev
```

To build distributable packages:

```bash
bun run electron:package
```

## License

[MIT](./LICENSE)
