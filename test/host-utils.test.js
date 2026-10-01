import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { sanitizeSlug, nextFileIndex, writeFigure, pruneFigures, figureRelPath } from '../lib/host-utils.js'

test('sanitizeSlug: kebab-cases and falls back', () => {
  assert.equal(sanitizeSlug('Text Image!'), 'text-image')
  assert.equal(sanitizeSlug('架构 图'), 'figure')
  assert.equal(sanitizeSlug('!!!'), 'figure')
  assert.equal(sanitizeSlug('a'.repeat(50)).length, 24)
})

test('nextFileIndex: max of numeric prefixes + 1', () => {
  assert.equal(nextFileIndex([]), 1)
  assert.equal(nextFileIndex(['3-a.svg', '11-b.svg', 'note.txt']), 12)
})

test('figureRelPath: posix path with session prefix', () => {
  assert.equal(figureRelPath('abcdef1234567890', '4-wave.svg'), '.dsh-figures/abcdef12/4-wave.svg')
})

test('writeFigure + pruneFigures round trip in temp dir', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-fig-'))
  try {
    const a = await writeFigure(dir, '<svg viewBox="0 0 1 1"></svg>', 'first')
    assert.equal(a.file, '1-first.svg')
    assert.equal(fs.readFileSync(path.join(dir, '.gitignore'), 'utf8'), '*\n')
    const b = await writeFigure(dir, '<svg viewBox="0 0 1 1"></svg>', 'second')
    assert.equal(b.file, '2-second.svg')
    assert.equal(fs.readFileSync(path.join(dir, '1-first.svg'), 'utf8'), '<svg viewBox="0 0 1 1"></svg>')
    for (let i = 0; i < 6; i++) await writeFigure(dir, '<svg viewBox="0 0 1 1"></svg>', `f${i}`)
    const doomed = await pruneFigures(dir, 3)
    assert.equal(doomed.length, 5)
    const left = (await fsp.readdir(dir)).filter((f) => /\.svg$/.test(f))
    assert.equal(left.length, 3)
    assert.ok(fs.existsSync(path.join(dir, '8-f5.svg')), 'newest figure survives')
    assert.ok(!fs.existsSync(path.join(dir, '1-first.svg')), 'oldest figure pruned')
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('writeFigure collides safely when file exists', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-fig-'))
  try {
    await writeFigure(dir, 'x', 'a')
    fs.writeFileSync(path.join(dir, '2-b.svg'), 'pre-existing')
    const made = await writeFigure(dir, 'y', 'b')
    assert.equal(made.file, '3-b.svg')
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})
