import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { BUILD_COMMIT } from '../version';
import { About } from './About';

describe('About', () => {
  it('says which version is running: the release date and a link to the commit', () => {
    const html = renderToStaticMarkup(createElement(About, { onClose: () => {} }));
    expect(html).toContain('id="about-version"');
    expect(html).toContain('Released');
    if (BUILD_COMMIT) expect(html).toContain(`github.com/ErwannRobin/TrampoVision/commit/${BUILD_COMMIT}`);
    else expect(html).toContain('unknown');
  });
});
