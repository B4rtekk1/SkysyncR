import assert from 'node:assert/strict'
import test from 'node:test'
import {
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  getPasswordRequirements,
  getPasswordScore,
  getStrengthLevel,
  suggestNameFromEmail,
} from './passwordRules.ts'

function requirement(password: string, labelStart: string) {
  const found = getPasswordRequirements(password).find(({ label }) => label.startsWith(labelStart))
  assert.ok(found, `missing requirement: ${labelStart}`)
  return found
}

test('suggestNameFromEmail formats local email parts into display names', () => {
  assert.equal(suggestNameFromEmail('ewa.nowak-test@example.test'), 'Ewa Nowak Test')
  assert.equal(suggestNameFromEmail('singleword'), 'Singleword')
})

test('password requirements reject common pattern weaknesses', () => {
  assert.equal(requirement('Aaaa1234!!!!', 'No 3+ repeated').met, false)
  assert.equal(requirement('Abcd5678!!!!', 'No sequential').met, false)
  assert.equal(requirement('password123!', 'Not a commonly').met, false)
})

test('password requirements enforce length boundaries', () => {
  assert.equal(requirement('A1!'.padEnd(PASSWORD_MIN_LENGTH, 'x'), `At least ${PASSWORD_MIN_LENGTH}`).met, true)
  assert.equal(requirement('A1!'.padEnd(PASSWORD_MAX_LENGTH + 1, 'x'), `No more than ${PASSWORD_MAX_LENGTH}`).met, false)
})

test('password scoring rewards varied long passwords and caps common passwords at zero', () => {
  assert.equal(getPasswordScore('password123!'), 0)
  assert.ok(getPasswordScore('Longer!Password!42') > getPasswordScore('Short1!'))
})

test('strength levels map scores into visible meter segments', () => {
  assert.deepEqual(getStrengthLevel(0), { label: 'Very weak', className: 'very-weak', segments: 1 })
  assert.deepEqual(getStrengthLevel(9), { label: 'Very strong', className: 'very-strong', segments: 5 })
})
