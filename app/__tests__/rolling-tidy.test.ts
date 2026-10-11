const mockPolishText = jest.fn();
jest.mock('../src/api/koto-api', () => {
  const actual = jest.requireActual('../src/api/koto-api');
  return { ...actual, polishText: (...args: unknown[]) => mockPolishText(...args), warmPolish: jest.fn(async () => undefined) };
});
jest.mock('../src/native/NativeDesktopIntegration', () => ({ __esModule: true, default: {} }));

import { RollingTidy } from '../src/dictation/rolling-tidy';
import { POLISH_TIME_LIMIT_MS } from '../src/dictation/text-finishing';
import { connectionStore } from '../src/storage/server-connection';
import { DEFAULT_PREFERENCES, preferencesStore } from '../src/storage/preferences';

// About 45 words each, the length of one 15 to 28 s segment.
const FIRST =
  'One thing I need everyone to understand is what the company really is, so even if you had to pitch it to anyone at the last minute you should have a clear answer ready. We are a research lab and technology company working across healthcare and biology.';
const SECOND =
  'Substrate Console is a product by us that makes everyday clinical operations such as patient management, medical records, consultations, labs, documentation and compliance easy for clinics of every size, and it is the closest thing we have to a consumer product right now.';
const THIRD = 'Our mission statement is making healthcare more affordable, accessible and effective for everyone.';

/** Echoes the text back marked as polished, so the tests can see which parts went through the AI. */
function polishByEcho() {
  mockPolishText.mockImplementation(async ({ text }: { text: string }) => ({ text: `${text} [tidied]`, isPolished: true }));
}

function settle(): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, 0));
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.useRealTimers();
  preferencesStore.set({ ...DEFAULT_PREFERENCES });
  connectionStore.set({ status: 'ready', connection: { serverUrl: 'https://koto.example.workers.dev', accessKey: 'access-key-0123456789', sarvamApiKey: 'sarvam-key', geminiApiKey: 'gemini-key' } });
});

it('tidies earlier parts while recording and lays the result out in paragraphs', async () => {
  polishByEcho();
  const tidy = new RollingTidy();
  tidy.add(Promise.resolve(FIRST));
  tidy.add(Promise.resolve(SECOND));
  await settle();
  // The first part was sent while the person was still talking.
  expect(mockPolishText).toHaveBeenCalledTimes(1);
  expect(mockPolishText.mock.calls[0][0].text).toContain('research lab');

  tidy.add(Promise.resolve(THIRD));
  const result = await tidy.finish();
  const paragraphs = result.text.split('\n\n');
  expect(paragraphs).toHaveLength(3);
  expect(paragraphs[0]).toMatch(/research lab.*\[tidied\]$/);
  expect(paragraphs[1]).toMatch(/Substrate Console.*\[tidied\]$/);
  // The short last part of a long dictation is still tidied.
  expect(paragraphs[2]).toMatch(/Our mission statement.*\[tidied\]$/);
  expect(result.unpolishedText).not.toContain('[tidied]');
});

it('keeps a correction together with what it corrects', async () => {
  polishByEcho();
  const tidy = new RollingTidy();
  tidy.add(Promise.resolve(FIRST));
  tidy.add(Promise.resolve('Sorry, a research lab in Mumbai working across healthcare and biology.'));
  await settle();
  expect(mockPolishText).not.toHaveBeenCalled();
  await tidy.finish();
  expect(mockPolishText).toHaveBeenCalledTimes(1);
  expect(mockPolishText.mock.calls[0][0].text).toContain('in Mumbai');
});

it('keeps a spoken list in one part', async () => {
  polishByEcho();
  const tidy = new RollingTidy();
  tidy.add(Promise.resolve(`${FIRST} There are three pillars. First, the lab.`));
  tidy.add(Promise.resolve('Second, the console. Third, the research.'));
  await settle();
  expect(mockPolishText).not.toHaveBeenCalled();
});

it('treats "the second thing is" as prose, not a list', async () => {
  polishByEcho();
  const tidy = new RollingTidy();
  tidy.add(Promise.resolve(`${FIRST} Okay, so the second thing is marketing.`));
  tidy.add(Promise.resolve('Third thing is support, so we need someone checking the inbox every few hours on launch day.'));
  await settle();
  expect(mockPolishText).toHaveBeenCalledTimes(1);
});

it('does not split a sentence cut at a pause', async () => {
  polishByEcho();
  const tidy = new RollingTidy();
  tidy.add(Promise.resolve(FIRST.replace(/\.$/, ',')));
  tidy.add(Promise.resolve(SECOND));
  await settle();
  expect(mockPolishText).not.toHaveBeenCalled();
});

it('leaves short dictation to the usual single pass', async () => {
  const tidy = new RollingTidy();
  tidy.add(Promise.resolve('Send the invite to Ravi.'));
  expect(await tidy.finish()).toEqual({ text: 'Send the invite to Ravi.' });
  expect(mockPolishText).not.toHaveBeenCalled();
});

it('uses the rule-based text of a part the AI has not finished by the deadline', async () => {
  jest.useFakeTimers();
  mockPolishText.mockImplementation(({ text }: { text: string }) =>
    text.includes('research lab') ? new Promise(() => undefined) : Promise.resolve({ text, isPolished: false }),
  );
  const tidy = new RollingTidy();
  tidy.add(Promise.resolve(FIRST));
  tidy.add(Promise.resolve(SECOND));
  const finishing = tidy.finish();
  await jest.advanceTimersByTimeAsync(POLISH_TIME_LIMIT_MS);
  const result = await finishing;
  expect(result.text.split('\n\n')[0]).toContain('research lab');
  expect(result.unpolishedText).toBeUndefined();
});

it('stops quietly when a segment fails; the dictation reports the failure', async () => {
  const tidy = new RollingTidy();
  const failed = Promise.reject(new Error('Transcription failed.'));
  failed.catch(() => undefined);
  tidy.add(failed);
  tidy.add(Promise.resolve(SECOND));
  await settle();
  expect(mockPolishText).not.toHaveBeenCalled();
});
