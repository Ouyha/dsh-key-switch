#!/usr/bin/env node
/**
 * 从 profile 里撤掉本插件：删目录、去掉 package.json 里的依赖与 bundle。
 *
 * 账号元数据（`$DSH_HOME/key-switch/state.json`）与凭据存储里的密钥不动，重装后还能接着用。
 * 装的是桌面版还是 DSH Go，和 install.mjs 用同一套判定。
 *
 * 用法：node uninstall.mjs [--profile <名字或目录>] [--dsh-go|--desktop]
 */
import { readFile, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

import { PACKAGE, hostLabel, resolveTarget } from './tools/target.mjs'

const argv = process.argv.slice(2)
const at = argv.indexOf('--profile')
if (at !== -1 && (argv[at + 1] === undefined || argv[at + 1].startsWith('--'))) {
  console.error('--profile 后面要跟 profile 名或目录，例如 --profile web')
  process.exit(2)
}

const target = resolveTarget({ argv, env: process.env, home: homedir(), exists: existsSync })
const profile = target.profileDir

await rm(join(profile, 'node_modules', PACKAGE), { recursive: true, force: true })

const file = join(profile, 'package.json')
if (!existsSync(file)) {
  console.log(`没有 ${file}，已跳过程序清单清理。`)
  console.log('插件目录已删除。')
  process.exit(0)
}

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

console.log(`环境：${hostLabel(target.host)}（${target.reason}）`)
console.log(`profile：${profile}`)
console.log(`插件已卸载。账号元数据与已保存的密钥仍保留在 ${target.dshHome} 下，重装即可继续用。`)
console.log('重启 DSH 后生效。')
