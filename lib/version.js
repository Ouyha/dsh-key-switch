/**
 * 极简 semver 解析与比较：只服务于「本地版本 vs GitHub 上的版本」这一件事，
 * 不引依赖，也不追求完整实现（构建元数据会被忽略，预发布按 semver 规则排序）。
 * @module dsh-key-switch/version
 */

/**
 * 解析 `v1.2.3` / `1.2.3-beta.1` 这样的版本号。
 * @param {unknown} input - 待解析的值。
 * @returns {{ major: number, minor: number, patch: number, prerelease: string | null } | null}
 */
export function parseVersion(input) {
  if (typeof input !== 'string') return null
  const match = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(input.trim())
  if (match === null) return null
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4] ?? null,
  }
}

/** 按 semver 的规则比较预发布段：数字段小于字母段，数字段按数值比。 */
function comparePrerelease(left, right) {
  const a = left.split('.')
  const b = right.split('.')
  const length = Math.max(a.length, b.length)
  for (let index = 0; index < length; index += 1) {
    const x = a[index]
    const y = b[index]
    if (x === undefined) return -1
    if (y === undefined) return 1
    const xNumber = /^\d+$/.test(x)
    const yNumber = /^\d+$/.test(y)
    if (xNumber && yNumber) {
      const delta = Number(x) - Number(y)
      if (delta !== 0) return delta < 0 ? -1 : 1
      continue
    }
    if (xNumber !== yNumber) return xNumber ? -1 : 1
    if (x !== y) return x < y ? -1 : 1
  }
  return 0
}

/**
 * 比较两个版本。
 * @param {unknown} left - 左版本。
 * @param {unknown} right - 右版本。
 * @returns {-1 | 0 | 1 | null} 左小于/等于/大于右；任一版本非法时返回 null。
 */
export function compareVersions(left, right) {
  const a = parseVersion(left)
  const b = parseVersion(right)
  if (a === null || b === null) return null
  for (const key of ['major', 'minor', 'patch']) {
    if (a[key] !== b[key]) return a[key] < b[key] ? -1 : 1
  }
  if (a.prerelease === b.prerelease) return 0
  if (a.prerelease === null) return 1
  if (b.prerelease === null) return -1
  return comparePrerelease(a.prerelease, b.prerelease)
}
