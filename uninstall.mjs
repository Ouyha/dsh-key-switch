#!/usr/bin/env node
/**
 * 从 profile 里撤掉本插件：删目录、去掉 package.json 里的依赖与 bundle。
 * 账号元数据（~/.dsh/key-switch/state.json）与凭据存储里的密钥不动，重装后还能接着用。
 *
 * 用法：node uninstall.mjs [--profile <目录>]
 */
import { readFile, rm, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

const PACKAGE = 'dsh-key-switch'

/** 解析目标 profile 目录。 */
function profileDir() {
  const flag = process.argv.indexOf('--profile')
  if (flag !== -1 && process.argv[flag + 1]) return resolve(process.argv[flag + 1])
  const home = process.env.DSH_HOME ?? join(homedir(), '.dsh')
  return join(home, 'profiles', 'desktop')
}

const profile = profileDir()
await rm(join(profile, 'node_modules', PACKAGE), { recursive: true, force: true })

const file = join(profile, 'package.json')
const text = await readFile(file, 'utf8')
const manifest = JSON.parse(text)
const before = JSON.stringify(manifest)

if (manifest.dependencies) delete manifest.dependencies[PACKAGE]
const bundles = manifest.dsh?.profile?.bundles
if (Array.isArray(bundles)) manifest.dsh.profile.bundles = bundles.filter(name => name !== PACKAGE)

if (JSON.stringify(manifest) !== before) {
  await writeFile(`${file}.bak-${Date.now()}`, text, 'utf8')
  await writeFile(file, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
  console.log('已从 profile 的 package.json 移除登记')
}

console.log('插件已卸载。账号元数据与已保存的密钥仍保留在 ~/.dsh 下，重装即可继续用。')
console.log('重启 DeepSeek Harness 后生效。')
