# Releasing

Production publication runs only in GitHub Actions. Local commands are limited
to builds, tests, dry runs, and registry verification. No local npm login is needed.

## Prepare a candidate

1. Pin the MDI dependencies to their official registry versions and update the lockfile.
2. Run `npm run release:check`, `npm run test:performance`,
   `npm run test:browser:performance`, and `node --test scripts/release-artifact.test.mjs`.
3. Merge the candidate to main and wait for Verify to pass on that exact SHA.
4. Dispatch `release.yml` from main with `candidate_sha` and `version`.
   `publish_runner` selects either the default GitHub-hosted Ubuntu pool or its
   ARM64 pool if runner allocation stalls. Cancel the queued attempt before
   switching pools; never overlap publication attempts.

The workflow validates main ancestry and the successful Verify run, builds and
packs once, and retains the original tarball plus a SHA-512 manifest for 90 days
before publishing. It uses npm OIDC, verifies downloaded registry bytes, and
creates the tag and GitHub Release in the same workflow. The Release assets also
retain the original archive and manifest. It does not depend on another workflow
being triggered by a bot-created Release.

Configure the npm trusted publisher for organization `illusions-lab`, repository
`milkdown-plugin-mdi`, workflow `release.yml`. Node 24 supplies the supported npm
CLI. Do not provide `NODE_AUTH_TOKEN`. See the
[npm trusted publisher documentation](https://docs.npmjs.com/trusted-publishers/).

## Recovery

Dispatch the same candidate SHA and version with `recovery_run_id` identifying
the original Release workflow. Recovery downloads the saved artifact and checks
its candidate, version, and checksum; it never rebuilds or republishes it.
Only byte-identical registry archives can be skipped. Missing registry metadata
after a publication attempt is handled by read-only retries. If the original run
failed before publication, inspect the run before starting a fresh publication.
Never overwrite a different archive: select the first unused `0.8.x` patch,
update the version and lockfile, and verify that new candidate on main.

## Verify the registry consumer

Run `REGISTRY_PLUGIN_VERSION=0.8.0 PLAYWRIGHT_BROWSERS=all npm run test:consumer`
with the released version. This independently installs from npm and checks public
exports, Worker preparation, stylesheet/WASM assets, comment preservation, body
projection, and prepared transport in Chromium, Firefox, and WebKit. Local
candidate substitutions are not accepted for release verification.
