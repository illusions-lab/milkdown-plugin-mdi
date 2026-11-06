import { expect, it } from 'vitest'
import { shrinkFailure } from './scenarios/shrink'
it('keeps a prerequisite and the same failure while deleting irrelevant operations', async () => {
  const minimized = await shrinkFailure(['noise', 'create', 'other', 'fail', 'tail'], 'expected', async operations => {
    if (!operations.includes('create')) return 'precondition-invalid'
    return operations.includes('fail') ? 'expected' : null
  })
  expect(minimized).toEqual(['create', 'fail'])
})
