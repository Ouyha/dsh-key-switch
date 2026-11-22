#!/usr/bin/env node
/**
 * 把本插件装进 DSH 的 profile。
 *
 * 装到哪儿不用你选：`tools/target.mjs` 会看这是桌面版还是 DSH Go 的手机引擎，
 * 分别落到 `profiles/desktop` 与 `profiles/web`（DSH Go 启动引擎用的就是 web）。
 *
 * 做三件事：
 * 1. 把 lib/、package.json、cordis.patch.yml 复制进 profile 的 node_modules/dsh-key-switch；
 * 2. 在 profile 的 package.json 里登记依赖（file: 指向本目录）与 bundle；
 * 3. 打印后续动作。
 *
 * 用法：node install.mjs [--profile <名字或目录>] [--dsh-go|--desktop] [--print-target]
 */
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { PACKAGE, entryHint, hostLabel, resolveTarget } from './tools/target.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const argv = process.argv.slice(2)

/** 组合时要带上的文件（测试与工具链不进 profile）。 */
const SHIPPED = ['lib', 'package.json', 'cordis.patch.yml', 'README.md']

if (argv.includes('--help') || argv.includes('-h')) {
  console.log(`把 ${PACKAGE} 装进 DSH 的 profile。

  node install.mjs                  自动判断桌面版 / DSH Go
  node install.mjs --dsh-go         强制装进手机本机引擎（profile web）
  node install.mjs --desktop        强制装进桌面版（profile desktop）
  node install.mjs --profile <名>   指定 profile 名或目录
  node install.mjs --print-target   只打印判定结果，不动文件`)
  process.exit(0)
}

// 漏写值时别静默退化成自动判定：那会把插件装到另一台主机的 profile 上。
const at = argv.indexOf('--profile')
if (at !== -1 && (argv[at + 1] === undefined || argv[at + 1].startsWith('--'))) {
  console.error('--profile 后面要跟 profile 名或目录，例如 --profile web')
  process.exit(2)
}

const target = resolveTarget({
  argv,
  env: process.env,
  home: homedir(),
  // 装了 App、还没跑过引擎时 /opt/dsh-go 也在，照样能认出手机版。
  exists: existsSync,
})
const profile = target.profileDir
const manifestFile = join(profile, 'package.json')

if (argv.includes('--print-target')) {
  console.log(`环境：${hostLabel(target.host)}`)
  console.log(`判定：${target.reason}`)
  console.log(`profile：${target.profileName} → ${profile}`)
  console.log(`DSH_HOME：${target.dshHome}`)
  console.log(`profile 已存在：${existsSync(manifestFile) ? '是' : '否'}`)
  process.exit(0)
}

if (!existsSync(manifestFile)) {
  console.error(`找不到 ${manifestFile}`)
  console.error(`\n先让「${hostLabel(target.host)}」至少启动过一次（会生成 profile），`)
  console.error('确认装的是哪一边：node install.mjs --print-target')
  console.error('也可以直接指目录：node install.mjs --profile /path/to/profile')
  process.exit(1)
}

/** 复制插件本体（不带 node_modules 与测试）。 */
async function copyPackage(destination) {
  await rm(destination, { recursive: true, force: true })
  await mkdir(destination, { recursive: true })
  for (const name of SHIPPED) {
    await cp(join(here, name), join(destination, name), { recursive: true })
  }
}

/** 在 profile 的 package.json 里登记依赖与 bundle，保留原有格式。 */
async function register() {
  const text = await readFile(manifestFile, 'utf8')
  const manifest = JSON.parse(text)
  const before = JSON.stringify(manifest)

  manifest.dependencies = manifest.dependencies ?? {}
  manifest.dependencies[PACKAGE] = `file:${resolve(here).replace(/\\/g, '/')}`

  manifest.dsh = manifest.dsh ?? {}
  manifest.dsh.profile = manifest.dsh.profile ?? {}
  const bundles = Array.isArray(manifest.dsh.profile.bundles) ? manifest.dsh.profile.bundles : []
  if (!bundles.includes(PACKAGE)) bundles.push(PACKAGE)
  manifest.dsh.profile.bundles = bundles

  if (JSON.stringify(manifest) === before) return false
  await writeFile(`${manifestFile}.bak-${Date.now()}`, text, 'utf8')
  await writeFile(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
  return true
}

const destination = join(profile, 'node_modules', PACKAGE)
await copyPackage(destination)
const changed = await register()

console.log(`环境：${hostLabel(target.host)}（${target.reason}）`)
console.log(`profile：${profile}`)
console.log(`插件已复制到 ${destination}`)
console.log(changed ? `已在 ${manifestFile} 登记依赖与 bundle` : 'profile 里已登记过，未改动 package.json')
console.log(`\n${entryHint(target)}`)
console.log('卸载：node uninstall.mjs')
