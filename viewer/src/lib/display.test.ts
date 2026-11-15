import { describe, expect, it } from 'vitest'
import { disp } from './display'

describe('disp', () => {
  it('prefers the romanized name', () => {
    expect(disp({ roman: 'Teresa Ikeda', name: '池田_瑛紗' })).toBe('Teresa Ikeda')
  })

  it('falls back to the Japanese name when roman is null', () => {
    expect(disp({ roman: null, name: '池田_瑛紗' })).toBe('池田_瑛紗')
  })
})
