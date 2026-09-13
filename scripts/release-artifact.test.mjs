import { test } from 'node:test'
import assert from 'node:assert/strict'
import { digest, registryMatches, verifyArtifact } from './release-artifact.mjs'
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
