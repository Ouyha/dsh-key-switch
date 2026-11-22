/**
 * 装完之后的离线自检：按 Harness 自己的组合逻辑把 profile 展开一遍，
 * 确认 key-switch 这条 entry 真的进了组合树、客户端模块能被发现。
 * 不启动 App，不动运行中的进程。
 *
 * 用法：node tools/preflight.mjs
 */
import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

import { resolveTarget } from './target.mjs'

const APP = process.env.DSH_APP_DIR ?? 'D:/app/ds/resources/app/dsh'
// 和安装器同一套判定：装到哪个 profile，就检查哪个。
const { profileDir } = resolveTarget({ argv: process.argv.slice(2), home: homedir() })

const boot = await import(pathToFileURL(join(APP, 'node_modules/@deepseek-ai/dsh-app-boot/lib/index.js')).href)
const profile = boot.loadProfileDirectory('dsh', profileDir, APP)

const warnings = []
// 每一层是 `{packageName, patches, ...}`；组合函数要的是补丁数组的数组。
const entries = boot.composeEntries(profile.layers.map(layer => layer.patches), message => warnings.push(message))
const target = entries.flatMap(row => row.group && Array.isArray(row.config) ? [row, ...row.config] : [row])
  .find(row => row.id === 'key-switch')

if (warnings.length > 0) {
  console.log('组合告警：')
  for (const warning of warnings) console.log(`  - ${warning}`)
}
if (target === undefined) {
  console.error('✗ 组合树里没有 key-switch：插件不会被加载')
  process.exit(1)
}

console.log(`✓ 组合树里有 key-switch（name=${target.name}, disabled=${target.disabled ?? false}）`)

const manifest = JSON.parse(await readFile(join(profileDir, 'node_modules/dsh-key-switch/package.json'), 'utf8'))
if (manifest.dsh?.client?.platform !== 'web') {
  console.error('✗ package.json 缺少 dsh.client.platform = web，设置页不会出现在浏览器里')
  process.exit(1)
}
for (const file of ['lib/index.js', 'lib/client.js']) {
  const text = await readFile(join(profileDir, 'node_modules/dsh-key-switch', file), 'utf8')
  if (text.trim() === '') {
    console.error(`✗ ${file} 是空的`)
    process.exit(1)
  }
}
console.log('✓ package.json 声明了 dsh.client，两个半都非空')

// 模块 id 必须等于包名：宿主按包名把 boot graph 里的条目对到 __ModuleLoader__ 的注册项。
const clientText = await readFile(join(profileDir, 'node_modules/dsh-key-switch/lib/client.js'), 'utf8')
const idMatch = /__ModuleLoader__\.load\(\{\s*id:\s*`([^`]+)`/.exec(clientText)
if (idMatch === null) {
  console.error('✗ lib/client.js 没有按 __ModuleLoader__.load({id, factory}) 的格式注册')
  process.exit(1)
}
if (idMatch[1] !== manifest.name) {
  console.error(`✗ 客户端模块 id（${idMatch[1]}）与包名（${manifest.name}）不一致，设置页不会挂载`)
  process.exit(1)
}
console.log(`✓ 客户端模块 id 与包名一致：${idMatch[1]}`)
