/**
 * 插件自身的元信息：版本号与仓库地址都从 package.json 读，避免代码里写死一份会漂移的副本。
 * @module dsh-key-switch/meta
 */

import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const pkg = require('../package.json')

/** 当前安装的版本，展示在页面标题旁、也用于和 GitHub 上的版本比较。 */
export const VERSION = typeof pkg.version === 'string' && pkg.version !== '' ? pkg.version : '0.0.0'

/**
 * 从 package.json 的 `repository` 字段里取出 GitHub 的 owner/repo。
 * 支持 `https://github.com/a/b.git`、`git@github.com:a/b.git`、`{ url }` 三种写法。
 * @param {unknown} value - `repository` 字段的原始值。
 * @returns {{ owner: string, name: string } | null}
 */
export function parseRepository(value) {
  const raw = typeof value === 'string' ? value : value?.url
  if (typeof raw !== 'string') return null
  const match = /github\.com[/:]([^/]+)\/([^/#?]+?)(?:\.git)?(?:[/#?].*)?$/i.exec(raw.trim())
  if (match === null) return null
  return { owner: match[1], name: match[2] }
}

/** 当前仓库；没有配置或不是 GitHub 时为 null（更新检测会明确说“未配置”）。 */
export const REPOSITORY = parseRepository(pkg.repository)

/**
 * 仓库的网页地址。
 * @param {{ owner: string, name: string } | null} repository - 仓库坐标。
 * @returns {string | null}
 */
export function repositoryUrl(repository) {
  return repository === null ? null : `https://github.com/${repository.owner}/${repository.name}`
}
