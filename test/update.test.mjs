import assert from 'node:assert/strict'
import { test } from 'node:test'

import { REPOSITORY, VERSION, parseRepository, repositoryUrl } from '../lib/meta.js'
import { checkForUpdate } from '../lib/update.js'
import { compareVersions, parseVersion } from '../lib/version.js'

const repo = { owner: 'Ouyha', name: 'dsh-key-switch' }

/** 一个只回固定 JSON 的 fetch 替身。 */
function fakeFetch(body, { status = 200, ok = status >= 200 && status < 300, error = null } = {}) {
  const calls = []
  const fetchImpl = async (url, init) => {
    calls.push({ url, init })
    if (error !== null) throw error
    return { ok, status, async json() { return body } }
  }
  return { calls, fetchImpl }
}

test('版本解析：接受 v 前缀与预发布，拒绝残缺版本', () => {
  assert.deepEqual(parseVersion('v1.2.3'), { major: 1, minor: 2, patch: 3, prerelease: null })
  assert.deepEqual(parseVersion('1.2.3-beta.1'), { major: 1, minor: 2, patch: 3, prerelease: 'beta.1' })
  assert.equal(parseVersion('1.2'), null)
  assert.equal(parseVersion(''), null)
  assert.equal(parseVersion(undefined), null)
})

test('版本比较：主次修订与预发布都按 semver 排序', () => {
  assert.equal(compareVersions('0.2.0', '0.2.0'), 0)
  assert.equal(compareVersions('0.2.0', '0.2.1'), -1)
  assert.equal(compareVersions('v1.0.0', '0.9.9'), 1)
  assert.equal(compareVersions('1.0.0-beta.2', '1.0.0-beta.10'), -1)
  assert.equal(compareVersions('1.0.0', '1.0.0-rc.1'), 1)
  assert.equal(compareVersions('1.0.0+build.2', '1.0.0'), 0)
  assert.equal(compareVersions('nope', '1.0.0'), null)
})

test('仓库解析：HTTPS、SSH 与对象写法都能认出 GitHub 坐标', () => {
  assert.deepEqual(parseRepository('https://github.com/Ouyha/dsh-key-switch.git'), repo)
  assert.deepEqual(parseRepository('git+https://github.com/Ouyha/dsh-key-switch.git'), repo)
  assert.deepEqual(parseRepository('git@github.com:Ouyha/dsh-key-switch.git'), repo)
  assert.deepEqual(parseRepository({ url: 'https://github.com/Ouyha/dsh-key-switch' }), repo)
  assert.equal(parseRepository('https://gitlab.com/Ouyha/dsh-key-switch'), null)
  assert.equal(parseRepository(undefined), null)
  assert.equal(repositoryUrl(null), null)
})

test('package.json 里的版本与仓库能被读出来', () => {
  assert.match(VERSION, /^\d+\.\d+\.\d+/)
  assert.deepEqual(REPOSITORY, repo)
})

test('远端版本更高：提示有更新，并带上仓库地址', async () => {
  const { calls, fetchImpl } = fakeFetch({ version: '0.3.0' })
  const result = await checkForUpdate({ version: '0.2.0', repository: repo, fetchImpl })

  assert.equal(result.configured, true)
  assert.equal(result.current, '0.2.0')
  assert.equal(result.latest, '0.3.0')
  assert.equal(result.relation, 1)
  assert.equal(result.hasUpdate, true)
  assert.equal(result.url, 'https://github.com/Ouyha/dsh-key-switch')
  assert.match(calls[0].url, /^https:\/\/raw\.githubusercontent\.com\/Ouyha\/dsh-key-switch\/HEAD\/package\.json$/)
  assert.match(calls[0].init.headers['user-agent'], /dsh-key-switch\/0\.2\.0/)
})

test('同版本、或本地比远端新：都不提示更新', async () => {
  const same = await checkForUpdate({
    version: '0.2.0', repository: repo, fetchImpl: fakeFetch({ version: '0.2.0' }).fetchImpl,
  })
  assert.equal(same.hasUpdate, false)
  assert.equal(same.relation, 0)

  const ahead = await checkForUpdate({
    version: '0.2.1', repository: repo, fetchImpl: fakeFetch({ version: '0.2.0' }).fetchImpl,
  })
  assert.equal(ahead.hasUpdate, false)
  assert.equal(ahead.relation, -1)
})

test('没有配置仓库时直接说未配置，不发请求', async () => {
  let called = false
  const result = await checkForUpdate({
    version: '0.2.0',
    repository: null,
    fetchImpl: async () => { called = true; throw new Error('should not run') },
  })
  assert.deepEqual(result, { configured: false })
  assert.equal(called, false)
})

test('网络失败：502，并提示可能需要代理', async () => {
  const { fetchImpl } = fakeFetch(null, { error: new Error('fetch failed') })
  await assert.rejects(
    () => checkForUpdate({ version: '0.2.0', repository: repo, fetchImpl }),
    error => {
      assert.equal(error.status, 502)
      assert.match(error.message, /连不上 GitHub/)
      assert.match(error.message, /代理/)
      return true
    },
  )
})

test('GitHub 返回非 200：502，不把 HTML 当版本号', async () => {
  const { fetchImpl } = fakeFetch(null, { status: 503, ok: false })
  await assert.rejects(
    () => checkForUpdate({ version: '0.2.0', repository: repo, fetchImpl }),
    error => error.status === 502 && /HTTP 503/.test(error.message),
  )
})

test('远端 package.json 里没有合法版本：502', async () => {
  const { fetchImpl } = fakeFetch({ name: 'dsh-key-switch' })
  await assert.rejects(
    () => checkForUpdate({ version: '0.2.0', repository: repo, fetchImpl }),
    error => error.status === 502 && /版本号/.test(error.message),
  )
})
