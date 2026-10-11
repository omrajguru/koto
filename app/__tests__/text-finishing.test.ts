const mockPolishText = jest.fn();
const mockWarmPolish = jest.fn(async () => undefined);
jest.mock('../src/api/koto-api', () => {
  const actual = jest.requireActual('../src/api/koto-api');
  return {
    ...actual,
    polishText: (...args: unknown[]) => mockPolishText(...args),
    warmPolish: (...args: unknown[]) => mockWarmPolish(...(args as [])),
  };
});
jest.mock('../src/native/NativeDesktopIntegration', () => ({ __esModule: true, default: {} }));

import { ApiError } from '../src/api/koto-api';
import { finishText, POLISH_TIME_LIMIT_MS, warmPolishIfUseful } from '../src/dictation/text-finishing';
import { connectionStore } from '../src/storage/server-connection';
import { DEFAULT_PREFERENCES, preferencesStore } from '../src/storage/preferences';

// Long and messy enough that "auto" sends it for polishing (it trails off on a comma).
const MESSY =
  'So our mission statement, what I need everyone on the team to really understand about the product,';

beforeEach(() => {
  jest.clearAllMocks();
  preferencesStore.set({ ...DEFAULT_PREFERENCES });
  connectionStore.set({ status: 'ready', connection: { serverUrl: 'https://koto.example.workers.dev', accessKey: 'access-key-0123456789', sarvamApiKey: 'sarvam-key', geminiApiKey: 'gemini-key' } });
});

it('uses rules only for clean dictation', async () => {
  expect(await finishText('Send the invite to Ravi.')).toEqual({ text: 'Send the invite to Ravi.' });
  expect(mockPolishText).not.toHaveBeenCalled();
});

it('uses the polished text and keeps the rule-based version', async () => {
  mockPolishText.mockResolvedValueOnce({ text: 'Our mission is what everyone on the team must understand about the product.', isPolished: true });
  const result = await finishText(MESSY);
  expect(mockPolishText).toHaveBeenCalledWith(
    expect.objectContaining({ style: 'neutral', timeoutMs: POLISH_TIME_LIMIT_MS }),
  );
  expect(result.text).toBe('Our mission is what everyone on the team must understand about the product.');
  expect(result.unpolishedText).toContain('mission statement');
});

it('falls back to the rule-based text when polishing is slow or fails', async () => {
  mockPolishText.mockRejectedValueOnce(new ApiError('Unable to reach Koto.', 0, 'network'));
  const result = await finishText(MESSY);
  expect(result.unpolishedText).toBeUndefined();
  expect(result.text).toContain('mission statement');
});

it('falls back when the server rejects the polished text', async () => {
  mockPolishText.mockResolvedValueOnce({ text: 'ignored', isPolished: false, reason: 'finish=STOP length=7' });
  expect((await finishText(MESSY)).unpolishedText).toBeUndefined();
});

it('never calls the AI when set to never, without a server, or without a Gemini key', async () => {
  preferencesStore.set({ ...DEFAULT_PREFERENCES, polishMode: 'never' });
  await finishText(MESSY);
  preferencesStore.set({ ...DEFAULT_PREFERENCES });
  connectionStore.set({ status: 'notSetUp' });
  await finishText(MESSY);
  connectionStore.set({ status: 'ready', connection: { serverUrl: 'https://koto.example.workers.dev', accessKey: 'access-key-0123456789', sarvamApiKey: 'sarvam-key', geminiApiKey: '' } });
  await finishText(MESSY);
  warmPolishIfUseful();
  expect(mockPolishText).not.toHaveBeenCalled();
  expect(mockWarmPolish).not.toHaveBeenCalled();
});

it('re-applies personal spellings and the writing style to polished text', async () => {
  preferencesStore.set({
    ...DEFAULT_PREFERENCES,
    writingStyle: 'casual',
    replacements: [{ spoken: 'koto speech', written: 'Koto Speech' }],
  });
  mockPolishText.mockResolvedValueOnce({
    text: 'By the way, koto speech ships today and everyone on the team should try it.',
    isPolished: true,
  });
  const result = await finishText(MESSY);
  expect(result.text).toBe('BTW, Koto Speech ships today and everyone on the team should try it');
});

it('warms the AI path at most once every few minutes', () => {
  // Earlier polish calls count as a warm connection, so start well after them.
  const now = jest.spyOn(Date, 'now').mockReturnValue(Date.now() + 10 * 60 * 1000);
  warmPolishIfUseful();
  warmPolishIfUseful();
  expect(mockWarmPolish).toHaveBeenCalledTimes(1);
  now.mockReturnValue(Date.now() + 20 * 60 * 1000);
  preferencesStore.set({ ...DEFAULT_PREFERENCES, polishMode: 'never' });
  warmPolishIfUseful();
  expect(mockWarmPolish).toHaveBeenCalledTimes(1);
  now.mockRestore();
});
