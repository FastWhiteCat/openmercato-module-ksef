import * as esbuild from 'esbuild'
import { glob } from 'glob'
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))

const entryPoints = await glob('src/**/*.{ts,tsx}', {
  cwd: __dirname,
  ignore: ['**/__tests__/**', '**/*.test.ts', '**/*.test.tsx', '**/__integration__/**', '**/scripts/**'],
  absolute: true,
})

if (entryPoints.length === 0) {
  console.error('No entry points found!')
  process.exit(1)
}

console.log(`Found ${entryPoints.length} entry points`)

const addJsExtension = {
  name: 'add-js-extension',
  setup(build) {
    build.onEnd(async (result) => {
      if (result.errors.length > 0) return
      const outputFiles = await glob('dist/**/*.js', { cwd: __dirname, absolute: true })
      for (const file of outputFiles) {
        const fileDir = dirname(file)
        let content = readFileSync(file, 'utf-8')
        content = content.replace(
          /from\s+["'](\.[^"']+)["']/g,
          (match, path) => {
            if (path.endsWith('.js') || path.endsWith('.json')) return match
            const resolvedPath = join(fileDir, path)
            if (existsSync(resolvedPath) && existsSync(join(resolvedPath, 'index.js'))) {
              return `from "${path}/index.js"`
            }
            return `from "${path}.js"`
          }
        )
        content = content.replace(
          /import\s*\(\s*["'](\.[^"']+)["']\s*\)/g,
          (match, path) => {
            if (path.endsWith('.js') || path.endsWith('.json')) return match
            const resolvedPath = join(fileDir, path)
            if (existsSync(resolvedPath) && existsSync(join(resolvedPath, 'index.js'))) {
              return `import("${path}/index.js")`
            }
            return `import("${path}.js")`
          }
        )
        writeFileSync(file, content)
      }
    })
  }
}

await esbuild.build({
  entryPoints,
  outdir: 'dist',
  format: 'esm',
  platform: 'node',
  target: 'node18',
  sourcemap: true,
  jsx: 'automatic',
  plugins: [addJsExtension],
})

// Bundlers (Turbopack in particular) don't reliably match extensionless,
// multi-segment subpaths against wildcard "exports" patterns like "./*",
// even though Node's own resolver does. Consumers (the OpenMercato module
// generator) import every file by its extensionless bare path, so we
// generate one literal exports entry per real source file instead of
// relying on wildcards — the same approach @open-mercato/core itself uses.
const sourceFiles = await glob('src/**/*.{ts,tsx,json}', {
  cwd: __dirname,
  ignore: ['**/__tests__/**', '**/*.test.ts', '**/*.test.tsx', '**/__integration__/**', '**/scripts/**', '**/*.d.ts'],
})

const exportsMap = { '.': './dist/index.js' }
for (const file of sourceFiles.sort()) {
  const rel = file.slice('src/'.length)
  if (rel.endsWith('.json')) {
    exportsMap[`./${rel}`] = `./src/${rel}`
    continue
  }
  const noExt = rel.replace(/\.tsx?$/, '')
  exportsMap[`./${noExt}`] = {
    types: `./src/${rel}`,
    default: `./dist/${noExt}.js`,
  }
}

const pkgPath = join(__dirname, 'package.json')
const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'))
pkg.exports = exportsMap
writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n')

console.log(`Generated ${Object.keys(exportsMap).length} explicit exports entries`)
console.log('integration-ksef-direct built successfully')
