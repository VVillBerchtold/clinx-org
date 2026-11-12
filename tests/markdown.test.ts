import { describe, expect, it } from 'vitest';
import { renderInline, renderSections } from '../src/lib/markdown';

describe('markdown for the dataset documents', () => {
  it('escapes HTML and renders code and bold', () => {
    expect(renderInline('a <b> & `c` **d**')).toBe('a &lt;b&gt; &amp; <code>c</code> <strong>d</strong>');
  });

  it('drops the title, splits at ## headings and renders tables with a caption and scopes', () => {
    const sections = renderSections('# Title\n\nIntro.\n\n## One\n\nShort lead:\n\n| A | B |\n|---|---|\n| x | y |\n\n- item\n');
    expect(sections.map((s) => s.title)).toEqual(['', 'One']);
    const one = sections[1]!.html;
    expect(one).toContain('<caption><span>One: Short lead</span></caption>');
    expect(one).toContain('<th scope="col">A</th>');
    expect(one).toContain('<th scope="row">x</th>');
    expect(one).toContain('<li>item</li>');
  });
});
