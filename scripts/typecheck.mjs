import { spawnSync } from 'child_process'

const result = spawnSync('tsc', ['--noEmit'], { encoding: 'utf8' })
const output = (result.stdout + result.stderr).trim()

const errors = output
  .split('\n')
  .filter(line => !line.startsWith('node_modules/') && !line.includes("npm i --save-dev @types/"))
  .join('\n')
  .trim()

if (errors) {
  console.error(errors)
  process.exit(1)
}
