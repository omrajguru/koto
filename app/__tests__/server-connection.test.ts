jest.mock('../src/native/NativeDesktopIntegration', () => ({ __esModule: true, default: {} }));

import {
  describeConnectionProblem,
  normaliseConnection,
  SETTINGS_FIXABLE_FAILURE,
} from '../src/storage/server-connection';

const VALID = {
  serverUrl: 'https://koto-server.example.workers.dev',
  accessKey: 'a'.repeat(32),
  sarvamApiKey: 'sk_test',
  geminiApiKey: '',
};

it('trims what was typed and removes a trailing slash', () => {
  expect(
    normaliseConnection({ serverUrl: ' https://koto-server.example.workers.dev/ ', accessKey: ' key ', sarvamApiKey: 'sk\n', geminiApiKey: ' ' }),
  ).toEqual({ serverUrl: 'https://koto-server.example.workers.dev', accessKey: 'key', sarvamApiKey: 'sk', geminiApiKey: '' });
});

it('accepts a complete connection; the Gemini key is optional', () => {
  expect(describeConnectionProblem(VALID)).toBeUndefined();
  expect(describeConnectionProblem({ ...VALID, serverUrl: 'http://localhost:8787' })).toBeUndefined();
});

it('explains what is missing', () => {
  expect(describeConnectionProblem({ ...VALID, serverUrl: 'koto-server.example.workers.dev' })).toMatch(/https:\/\//);
  expect(describeConnectionProblem({ ...VALID, serverUrl: 'http://koto-server.example.workers.dev' })).toMatch(/https:\/\//);
  expect(describeConnectionProblem({ ...VALID, accessKey: 'short' })).toMatch(/16 characters/);
  expect(describeConnectionProblem({ ...VALID, sarvamApiKey: '' })).toMatch(/Sarvam/);
});

it('recognises failures that saving the settings can fix', () => {
  expect(SETTINGS_FIXABLE_FAILURE.test('Connect your server in Koto settings to transcribe this recording.')).toBe(true);
  expect(SETTINGS_FIXABLE_FAILURE.test('Sarvam did not accept your API key. Check it in Koto settings.')).toBe(true);
  expect(SETTINGS_FIXABLE_FAILURE.test('Transcription is rate limited. Try again in a moment.')).toBe(false);
});
