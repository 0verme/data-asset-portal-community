import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveFrontendApiMode } from '../vite.config.js';

test('release builds fail closed, including custom build modes', () => {
  for (const value of [undefined, '', 'mock', 'remtoe']) {
    assert.throws(() => resolveFrontendApiMode({ VITE_API_MODE: value }, 'build'));
  }
  assert.equal(resolveFrontendApiMode({ VITE_API_MODE: 'remote' }, 'build'), 'remote');
  assert.equal(resolveFrontendApiMode({ VITE_API_MODE: 'remote', DAP_STATIC_MOCK_BUILD: '1' }, 'build'), 'remote');
  assert.equal(resolveFrontendApiMode({ VITE_API_MODE: 'mock', DAP_STATIC_MOCK_BUILD: '1' }, 'build'), 'mock');
  assert.throws(() => resolveFrontendApiMode({ VITE_API_MODE: 'remtoe', DAP_STATIC_MOCK_BUILD: '1' }, 'build'));
});

test('development supports explicit Mock and rejects misspellings', () => {
  assert.equal(resolveFrontendApiMode({ VITE_API_MODE: 'mock' }, 'serve'), 'mock');
  assert.equal(resolveFrontendApiMode({}, 'serve'), 'mock');
  assert.throws(() => resolveFrontendApiMode({ VITE_API_MODE: 'remtoe' }, 'serve'));
});
