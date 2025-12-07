<h1>
  <img src="src/browser/logo.svg" alt="pulldash logo" width="32" height="32" align="center">
  Pulldash
</h1>

The fastest way to review pull requests that makes massive PRs feel instant.

- Keybord-driven: navigate, comment, and approve without touching your mouse
- Performant: giant diffs render smoothly, virtualized rendering keeps you at 60fps even on 10k+ line changes
- Local or hosted: download the desktop app to avoid sending your credentials anywhere

## Try It

Head to [pulldash.com](https://pulldash.com) to explore pull-requests (no auth required).

[Download for Desktop](https://github.com/coder/pulldash/releases).

## Features

- Fast

  ![]

- Customize your PR list with search queries:

  ![Filtering PRs](./docs/screenshots/filtering.png)

## Why Not GitHub's Web UI?

- Lack of native PR tracking

GitHub's PR interface is slow, especially for large PRs.

GitHub's PR interface is slow, especially for large PRs.

| Issue                   | GitHub Web                    | Pulldash                            |
| ----------------------- | ----------------------------- | ----------------------------------- |
| **Large PRs**           | Truncates diffs, loads slowly | ✓ Renders everything, stays smooth  |
| **Keyboard navigation** | Limited shortcuts             | ✓ Full keyboard-driven workflow     |
| **Multi-file review**   | Constant page loads           | ✓ Instant tab switching             |
| **Context switching**   | Browser tabs everywhere       | ✓ Dedicated app, focused experience |

GitHub supports [CORS](https://docs.github.com/en/rest/using-the-rest-api/using-cors-and-jsonp-to-make-cross-origin-requests) on their API, making Pulldash a simple UI.

## Keyboard Shortcuts

| Action          | Shortcut           |
| --------------- | ------------------ |
| Command palette | `⌘K` or `⌘P`       |
| Switch tabs     | `⌘1` - `⌘9`        |
| Close tab       | `⌘W`               |
| Navigate files  | `↑` `↓` in palette |

## License

[AGPL](./LICENSE)
