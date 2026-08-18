// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { ownsTextInput } from '../../web/ui/keys.js';

describe('ownsTextInput', () => {
  it('true для input, select и textarea', () => {
    expect(ownsTextInput(document.createElement('input'))).toBe(true);
    expect(ownsTextInput(document.createElement('select'))).toBe(true);
    expect(ownsTextInput(document.createElement('textarea'))).toBe(true);
  });

  it('true для редактируемой области', () => {
    const div = document.createElement('div');
    div.contentEditable = 'true';
    document.body.append(div);
    expect(ownsTextInput(div)).toBe(true);
    div.remove();
  });

  it('false для обычного элемента, не-HTMLElement и null', () => {
    expect(ownsTextInput(document.createElement('button'))).toBe(false);
    expect(ownsTextInput(document.createElement('div'))).toBe(false);
    expect(ownsTextInput(null)).toBe(false);
    expect(ownsTextInput(document)).toBe(false);
  });
});
