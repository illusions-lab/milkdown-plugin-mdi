import { test } from 'node:test'
import assert from 'node:assert/strict'
import { archivePath, digest, registryMatches, verifyArtifact } from './release-artifact.mjs'
const bytes = Buffer.from('original archive')
const expected = { name: 'package', version: '0.8.0', sha: 'candidate' }
const manifest = { ...expected, integrity: `sha512-${digest(bytes)}` }
test('recovery rejects changed bytes and a different candidate', () => {
  verifyArtifact(manifest, bytes, expected)
  assert.throws(() => verifyArtifact(manifest, Buffer.from('rebuilt archive'), expected))
  assert.throws(() => verifyArtifact(manifest, bytes, { ...expected, sha: 'other' }))
})
test('an existing version is skipped only when its downloaded bytes match', async () => {
  const fetcher = async url => url.includes('registry.npmjs.org')
    ? new Response(JSON.stringify({ dist: { tarball: 'https://archive.test' } }))
    : new Response(bytes)
  assert.equal(await registryMatches(manifest, bytes, fetcher), true)
  await assert.rejects(registryMatches(manifest, Buffer.from('different'), fetcher), /different bytes/)
})
test('only a missing version permits publication; registry failures stop the job', async () => {
  assert.equal(await registryMatches(manifest, bytes, async () => new Response('', { status: 404 })), false)
  await assert.rejects(registryMatches(manifest, bytes, async () => new Response('', { status: 503 })), /Registry read failed/)
})

test('publication uses an explicit local path instead of a GitHub shorthand', () => {
  assert.equal(archivePath('package-0.8.0.tgz'), './release-artifacts/package-0.8.0.tgz')
})

test('workflow isolates workflow-capable credentials from npm execution', async () => {
  const { readFile } = await import('node:fs/promises')
  const workflow = await readFile(new URL('../.github/workflows/release.yml', import.meta.url), 'utf8')
  const [publisher, finalizer] = workflow.split('\n  finalize:\n')
  assert.ok(finalizer, 'GitHub metadata needs a separate finalization job')
  assert.doesNotMatch(publisher, /secrets\.RELEASE_GITHUB_TOKEN/)
  assert.match(finalizer, /needs: publish/)
  assert.match(finalizer, /environment: release/)
  assert.match(finalizer, /actions\/download-artifact/)
  assert.match(finalizer, /secrets\.RELEASE_GITHUB_TOKEN/)
  assert.doesNotMatch(finalizer, /npm (ci|install|publish)|git push/)
  assert.match(finalizer, /sha=\$CANDIDATE_SHA/)
})
