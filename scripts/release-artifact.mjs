import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync, readdirSync, appendFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

export const digest = bytes => createHash('sha512').update(bytes).digest('base64')
export function verifyArtifact(manifest, bytes, expected) {
  if (manifest.sha !== expected.sha || manifest.version !== expected.version || manifest.name !== expected.name)
    throw new Error('Artifact provenance does not match the candidate')
  if (manifest.integrity !== `sha512-${digest(bytes)}`) throw new Error('Artifact bytes do not match the manifest')
}
export async function registryMatches(manifest, bytes, fetcher = fetch) {
  const response = await fetcher(`https://registry.npmjs.org/${encodeURIComponent(manifest.name)}/${manifest.version}`)
  if (response.status === 404) return false
  if (!response.ok) throw new Error(`Registry read failed: ${response.status}`)
  const metadata = await response.json()
  const archive = await fetcher(metadata.dist.tarball)
  if (!archive.ok) throw new Error(`Tarball read failed: ${archive.status}`)
  const published = Buffer.from(await archive.arrayBuffer())
  if (!published.equals(bytes)) throw new Error('Published version contains different bytes; never overwrite it')
  return true
}

async function main() {
  const [mode] = process.argv.slice(2)
  const pkg = JSON.parse(readFileSync('package.json', 'utf8'))
  const expected = { name: pkg.name, version: process.env.RELEASE_VERSION, sha: process.env.CANDIDATE_SHA }
  if (pkg.version !== expected.version) throw new Error('Package version mismatch')
  const directory = 'release-artifacts'
  if (mode === 'record') {
    const files = readdirSync(directory).filter(name => name.endsWith('.tgz'))
    if (files.length !== 1) throw new Error('Expected exactly one original tarball')
    const file = files[0]
    const integrity = `sha512-${digest(readFileSync(`${directory}/${file}`))}`
    writeFileSync(`${directory}/manifest.json`, JSON.stringify({ ...expected, file, integrity }, null, 2) + '\n')
  }
  const manifest = JSON.parse(readFileSync(`${directory}/manifest.json`, 'utf8'))
  if (manifest.file !== manifest.file.split('/').pop() || !manifest.file.endsWith('.tgz')) throw new Error('Invalid archive filename')
  const bytes = readFileSync(`${directory}/${manifest.file}`)
  verifyArtifact(manifest, bytes, expected)
  if (mode === 'registry' || mode === 'confirm') {
    let published = false
    const attempts = mode === 'confirm' ? 20 : 1
    for (let attempt = 0; attempt < attempts; attempt++) {
      published = await registryMatches(manifest, bytes)
      if (published) break
      if (attempt + 1 < attempts) await new Promise(resolve => setTimeout(resolve, 15000))
    }
    if (mode === 'confirm' && !published) throw new Error('Registry visibility pending; recover using the original artifact, do not republish')
    if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `published=${published}\narchive=${directory}/${manifest.file}\n`)
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await main()
