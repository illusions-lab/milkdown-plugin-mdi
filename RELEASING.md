# Releasing

The first public release is `v0.1.0`. The `illusions-lab` npm organization and maintainer publishing access already exist and are used by `@illusions-lab/milkdown-plugin-vertical-writing`; do not create or store a new long-lived `NPM_TOKEN` for this package.

## First publication

An npm trusted publisher is configured per package, so establish `@illusions-lab/milkdown-plugin-mdi` with the existing maintainer account before enabling its GitHub publisher:

1. Run `npm whoami` and confirm that the account can publish packages in the `@illusions-lab` scope.
2. Run `npm run release:check` locally with all three Playwright browsers installed.
3. Commit and push the release state, then wait for CI to pass on that exact commit.
4. Tag the verified commit `v0.1.0` and, from its clean worktree, run `npm publish --access public`.
5. Push the tag, then create the matching GitHub Release.

The release workflow verifies that the GitHub Release tag equals the package version and repeats the complete release suite. For the first release it sees that the exact version was already published and does not publish it again.

## Trusted publishing after `v0.1.0`

Configure npm trusted publishing for:

- GitHub organization: `illusions-lab`
- Repository: `milkdown-plugin-mdi`
- Workflow: `release.yml`

Future releases are published by the workflow through OIDC and do not require `NPM_TOKEN`. GitHub Actions must retain `id-token: write`; npm trusted publishing also requires npm 11.5.1 or newer and Node 22.14.0 or newer. Trusted publishing automatically generates provenance for those releases.

## Verification after publication

```sh
npm view @illusions-lab/milkdown-plugin-mdi version dist-tags --json
npm install @illusions-lab/milkdown-plugin-mdi@0.1.0
npm audit signatures
```

Confirm that the installed package exposes only `mdi`, `getMdi`, and `initializeMdi`, that `style.css` resolves, and that the published dependency graph exposes the expected stable `@illusions-lab/mdi` analysis APIs directly.
