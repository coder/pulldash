<h1>
  <img src="src/browser/logo.svg" alt="pulldash logo" width="32" height="32" align="center">
  Pulldash
</h1>

Review pull requests in a high-performance UI, driven by keybinds.

> [!WARNING]
> Pulldash is in alpha. Please report bugs.

[![Example](./docs/screenshots/overview.png)](https://pulldash.com)

## Try

**Browser**: on [pulldash.com](https://pulldash.com) [no auth required]

> [!NOTE]
> GitHub tokens are stored in your browser, never on the Pulldash server post-authentication.

**Desktop**: download the [latest release](https://github.com/coder/pulldash/releases) available for Linux, macOS, and Windows.


## Features

- Customize your PR list with search queries:

  ![Filtering PRs](./docs/screenshots/filtering.png)

- Use keybinds to add/remove comments, select line ranges, switch files, and submit reviews:

  ![Keybinds](./docs/screenshots/keybind-driven.png)

- Instantly search across files:

  ![Search](./docs/screenshots/search.png)

## Why not GitHub's UI?

GitHub supports [CORS](https://docs.github.com/en/rest/using-the-rest-api/using-cors-and-jsonp-to-make-cross-origin-requests) for their API, making Pulldash a simple UI wrapper with some nicities:

- Filtering on repositories you care about.
- Opening large files in GitHub is slow (Pulldash performs all diff parsing and syntax highlighting in worker threads).
- GitHub lacks comprehensive keybinds that allow you to be fully keyboard-driven.

## License

[AGPL](./LICENSE)
