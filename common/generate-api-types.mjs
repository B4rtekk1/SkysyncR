import { readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const specPath = resolve(root, 'common/openapi.json')
const outPath = resolve(root, 'frontend/web/src/api/generated.ts')

const spec = JSON.parse(await readFile(specPath, 'utf8'))
const schemas = spec.components?.schemas ?? {}

function refName(ref) {
  const match = /^#\/components\/schemas\/(.+)$/.exec(ref)
  if (!match) throw new Error(`Unsupported ref: ${ref}`)
  return match[1]
}

function typeFor(schema) {
  if (schema.$ref) return refName(schema.$ref)
  if (schema.allOf) return schema.allOf.map(typeFor).join(' & ')
  if (schema.enum) return schema.enum.map((value) => JSON.stringify(value)).join(' | ')

  const nullable = schema.nullable ? ' | null' : ''
  switch (schema.type) {
    case 'string':
      return `string${nullable}`
    case 'integer':
    case 'number':
      return `number${nullable}`
    case 'boolean':
      return `boolean${nullable}`
    case 'array':
      return `${typeFor(schema.items)}[]${nullable}`
    case 'object':
      return `${objectType(schema)}${nullable}`
    default:
      return `unknown${nullable}`
  }
}

function objectType(schema) {
  const required = new Set(schema.required ?? [])
  const props = Object.entries(schema.properties ?? {})
  if (props.length === 0) return 'Record<string, unknown>'

  const lines = props.map(([name, propSchema]) => {
    const optional = required.has(name) ? '' : '?'
    return `  ${JSON.stringify(name)}${optional}: ${typeFor(propSchema)}`
  })
  return `{\n${lines.join('\n')}\n}`
}

const lines = [
  '// Generated from common/openapi.json. Do not edit by hand.',
  '',
]

for (const [name, schema] of Object.entries(schemas)) {
  lines.push(`export type ${name} = ${typeFor(schema)}`)
  lines.push('')
}

if (lines.at(-1) === '') lines.pop()

await writeFile(outPath, `${lines.join('\n')}\n`)
