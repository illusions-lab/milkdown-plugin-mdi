import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const root = new URL('..', import.meta.url)
const temporary = mkdtempSync(join(tmpdir(), 'milkdown-mdi-pack-'))

try {
  execFileSync('npm', ['run', 'build'], { cwd: root, stdio: 'inherit' })
  const packed = JSON.parse(execFileSync('npm', ['pack', '--json', '--pack-destination', temporary], {
    cwd: root,
    encoding: 'utf8',
  }))[0]
  const archive = join(temporary, packed.filename)
  const entries = execFileSync('tar', ['-tf', archive], { encoding: 'utf8' }).trim().split('\n')
  const forbidden = entries.filter((entry) => /(^|\/)(src|debug|test|browser)\/|\.(test|spec)\.[cm]?[jt]sx?$/.test(entry))
  if (forbidden.length) throw new Error(`tarball contains development files: ${forbidden.join(', ')}`)
  for (const required of [
    'package/dist/index.js',
    'package/dist/index.d.ts',
    'package/dist/editing.js',
    'package/dist/editing.d.ts',
    'package/dist/input-clipboard.js',
    'package/dist/input-clipboard.d.ts',
    'package/dist/mapping.js',
    'package/dist/mapping.d.ts',
    'package/dist/style.css',
    'package/CHANGELOG.md',
  ]) {
    if (!entries.includes(required)) throw new Error(`tarball is missing ${required}`)
  }
  const index = execFileSync('tar', ['-xOf', archive, 'package/dist/index.js'], { encoding: 'utf8' })
  if (/\.\.\/src|\/debug\//.test(index)) throw new Error('published entrypoint contains a local development path')
  console.log(`tarball contract passed: ${packed.filename}`)
} finally {
  rmSync(temporary, { recursive: true, force: true })
}
