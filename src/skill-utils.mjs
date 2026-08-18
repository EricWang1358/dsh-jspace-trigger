// skill-utils: J-Space skill 安装/检测工具（Node 内置依赖，无第三方包）。
//
// 设计原则：
// - 只做显式安装，绝不自动下载/覆盖。
// - 默认检测/安装目录：~/.agents/skills、~/.dsh/skills。
// - 可通过 plugin config 的 skillRoots / repoUrl / branch 覆盖。

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { existsSync } from 'node:fs'
import { cp, mkdir, mkdtemp, rm } from 'node:fs/promises'

const execFileAsync = promisify(execFile)

export const SKILL_DIR_NAME = 'j-space'
export const DEFAULT_REPO_URL = 'https://github.com/Tiger3807861189/J-Space-Cognition-Suite-V3.6.git'
export const DEFAULT_BRANCH = 'main'

export function defaultSkillRoots() {
  return [join(homedir(), '.agents', 'skills'), join(homedir(), '.dsh', 'skills')]
}

export function skillConfigRoots(config) {
  const roots = config?.skillRoots || defaultSkillRoots()
  const list = Array.isArray(roots) ? roots : [roots]
  // An explicit empty roots list means "no configured roots" — fall back to the
  // built-in defaults rather than reporting the skill as permanently missing.
  return list.length > 0 ? list : defaultSkillRoots()
}

export function skillPaths(config) {
  return skillConfigRoots(config).map((root) => join(root, SKILL_DIR_NAME))
}

export function isSkillInstalled(config) {
  return skillPaths(config).some((dir) => existsSync(join(dir, 'SKILL.md')))
}

export function installedSkillPaths(config) {
  return skillPaths(config).filter((dir) => existsSync(join(dir, 'SKILL.md')))
}

/**
 * 显式安装 J-Space skill。
 *
 * @param {object} config plugin config（可含 skillRoots / repoUrl / branch）
 * @param {object} [options]
 * @param {boolean} [options.force=false] 已存在时是否覆盖重装
 * @param {string} [options.preferredRoot] 指定安装根目录
 */
export async function installJSpaceSkill(config = {}, options = {}) {
  const repoUrl = config.repoUrl || DEFAULT_REPO_URL
  const branch = config.branch || DEFAULT_BRANCH
  const roots = skillConfigRoots(config)
  const targetRoot = options.preferredRoot || roots[0] || defaultSkillRoots()[0]
  const target = join(targetRoot, SKILL_DIR_NAME)

  if (existsSync(join(target, 'SKILL.md')) && !options.force) {
    return { ok: false, alreadyInstalled: true, target }
  }

  await mkdir(targetRoot, { recursive: true })
  const temp = await mkdtemp(join(tmpdir(), 'jspace-install-'))
  try {
    // `stdio: 'ignore'` (not the default 'pipe') — under DSH's Windows ACL
    // sandbox, capturing child-process output through a pipe fails with EPERM.
    // We don't consume git's output, so ignore it and let execFile throw on a
    // non-zero exit.
    await execFileAsync('git', ['clone', '--depth', '1', '--branch', branch, repoUrl, temp], {
      windowsHide: true,
      timeout: 120000,
      stdio: 'ignore',
    })

    const src = join(temp, SKILL_DIR_NAME)
    if (!existsSync(join(src, 'SKILL.md'))) {
      throw new Error(`J-Space skill directory not found in upstream repo: ${src}`)
    }

    if (existsSync(target)) {
      await rm(target, { recursive: true, force: true })
    }
    await mkdir(target, { recursive: true })
    await cp(src, target, { recursive: true })

    return { ok: true, target, repoUrl, branch }
  } finally {
    await rm(temp, { recursive: true, force: true }).catch(() => {})
  }
}