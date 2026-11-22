#!/usr/bin/env node
/**
 * 把本插件装进 DeepSeek Harness 的 profile（默认 ~/.dsh/profiles/desktop）。
 *
 * 做三件事：
 * 1. 把 lib/、package.json、cordis.patch.yml 复制进 profile 的 node_modules/dsh-key-switch；
 * 2. 在 profile 的 package.json 里登记依赖（file: 指向本目录）与 bundle；
 * 3. 打印后续动作。改 package.json 前会留一份 .bak。
 *
 * 用法：node install.mjs [--profile <目录>]
 */
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const PACKAGE = 'dsh-key-switch'

/** 解析目标 profile 目录。 */
function profileDir() {
  const flag = process.argv.indexOf('--profile')
  if (flag !== -1 && process.argv[flag + 1]) return resolve(process.argv[flag + 1])
  const home = process.env.DSH_HOME ?? join(homedir(), '.dsh')
  return join(home, 'profiles', 'desktop')
}

/** 复制插件本体（不带 node_modules 与测试）。 */
async function copyPackage(target) {
  await rm(target, { recursive: true, force: true })
  await mkdir(target, { recursive: true })
  for (const name of ['lib', 'package.json', 'cordis.patch.yml', 'README.md']) {
    await cp(join(here, name), join(target, name), { recursive: true })
  }
}

/** 在 profile 的 package.json 里登记依赖与 bundle，保留原有格式。 */
async function register(profile) {
  const file = join(profile, 'package.json')
  const text = await readFile(file, 'utf8')
  const manifest = JSON.parse(text)
  const before = JSON.stringify(manifest)

  manifest.dependencies = manifest.dependencies ?? {}
  manifest.dependencies[PACKAGE] = `file:${here.replace(/\\/g, '/')}`

  manifest.dsh = manifest.dsh ?? {}
  manifest.dsh.profile = manifest.dsh.profile ?? {}
  const bundles = Array.isArray(manifest.dsh.profile.bundles) ? manifest.dsh.profile.bundles : []
  if (!bundles.includes(PACKAGE)) bundles.push(PACKAGE)
  manifest.dsh.profile.bundles = bundles

  if (JSON.stringify(manifest) === before) return false
  await writeFile(`${file}.bak-${Date.now()}`, text, 'utf8')
  await writeFile(file, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
  return true
}

const profile = profileDir()
const target = join(profile, 'node_modules', PACKAGE)

await copyPackage(target)
const changed = await register(profile)

console.log(`插件已复制到 ${target}`)
console.log(changed ? `已在 ${join(profile, 'package.json')} 登记依赖与 bundle` : 'profile 里已登记过，未改动 package.json')
console.log('\n接下来重启 DeepSeek Harness（完全退出再打开），左侧栏会出现「密钥切换」。')
console.log('卸载：node uninstall.mjs')
