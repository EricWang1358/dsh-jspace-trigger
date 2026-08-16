import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  installedSkillPaths,
  installJSpaceSkill,
  isSkillInstalled,
  skillPaths,
} from '../src/skill-utils.mjs'
import { buildGuideText, evaluateRules, createDefaultConfig, mergeConfig } from '../src/trigger-core.mjs'

let tempRoot

test.before(async () => {
  tempRoot = await mkdtemp(join(tmpdir(), 'jspace-skill-utils-'))
})

test.after(async () => {
  await rm(tempRoot, { recursive: true, force: true })
})

test('isSkillInstalled detects SKILL.md in configured skill root', async () => {
  const root = join(tempRoot, 'root-a')
  await mkdir(join(root, 'j-space'), { recursive: true })
  await writeFile(join(root, 'j-space', 'SKILL.md'), '# J-Space', 'utf8')

  assert.equal(isSkillInstalled({ skillRoots: [root] }), true)
  assert.deepEqual(installedSkillPaths({ skillRoots: [root] }), [join(root, 'j-space')])
})

test('isSkillInstalled returns false when skill is absent', () => {
  const root = join(tempRoot, 'empty-root')
  assert.equal(isSkillInstalled({ skillRoots: [root] }), false)
  assert.deepEqual(installedSkillPaths({ skillRoots: [root] }), [])
})

test('skillPaths maps each configured root to j-space', () => {
  const rootA = join(tempRoot, 'a')
  const rootB = join(tempRoot, 'b')
  assert.deepEqual(skillPaths({ skillRoots: [rootA, rootB] }), [
    join(rootA, 'j-space'),
    join(rootB, 'j-space'),
  ])
})

test('installJSpaceSkill refuses to overwrite an existing skill without force', async () => {
  const root = join(tempRoot, 'already-installed')
  await mkdir(join(root, 'j-space'), { recursive: true })
  await writeFile(join(root, 'j-space', 'SKILL.md'), '# existing', 'utf8')

  const result = await installJSpaceSkill({ skillRoots: [root] }, { preferredRoot: root })
  assert.equal(result.ok, false)
  assert.equal(result.alreadyInstalled, true)
  assert.equal(result.target, join(root, 'j-space'))
})

test('mergeConfig preserves skillRoots/repoUrl/branch', () => {
  const cfg = mergeConfig({
    skillRoots: ['/tmp/custom-skills'],
    repoUrl: 'https://example.com/repo.git',
    branch: 'dev',
  })
  assert.deepEqual(cfg.skillRoots, ['/tmp/custom-skills'])
  assert.equal(cfg.repoUrl, 'https://example.com/repo.git')
  assert.equal(cfg.branch, 'dev')
})

test('buildGuideText appends missing-skill hint when requested', () => {
  const cfg = createDefaultConfig()
  const d = evaluateRules(cfg, '/j-space 复杂任务')
  const guide = buildGuideText(d, '/j-space 复杂任务', cfg, { missingSkill: true })
  assert.match(guide, /J-Space skill is not installed/)
  assert.match(guide, /jspace_install_skill/)

  const guideWithout = buildGuideText(d, '/j-space 复杂任务', cfg, { missingSkill: false })
  assert.doesNotMatch(guideWithout, /J-Space skill is not installed/)
})