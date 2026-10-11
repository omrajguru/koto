# Koto

Koto is dictation for Windows, made for the way people in India speak. Hold **Ctrl + Win**, speak in English, Hindi, Marathi or any of 22 Indian languages (or a mix of them), and release: the text is typed into whatever app has focus.

Speech is transcribed by **Saaras v4 from Sarvam AI**, a speech model built in India for Indian languages. Koto talks to it through a small server that you deploy to your own Cloudflare account, with your own API keys. Your audio, keys and backups stay in accounts you control, and nothing passes through a service run by Koto, because there is none.

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/omrajguru/koto/tree/main/worker)

## Set up your server

You need three things: a Sarvam API key, a Cloudflare account (the free plan works), and a Windows 10 or 11 PC. A Gemini API key is optional.

1. **Get a Sarvam API key** from the [Sarvam dashboard](https://dashboard.sarvam.ai). Koto uses it to turn speech into text.
2. **Optionally, get a Gemini API key** from [Google AI Studio](https://aistudio.google.com/apikey). Koto uses it only to tidy sentences that its own rules cannot fix. Without it, every request stays with Sarvam and your server.
3. **Deploy the server** with the button above. Cloudflare copies the `worker` folder into a repository on your GitHub account, creates an R2 bucket for backups and deploys the Worker. When it asks for `KOTO_ACCESS_KEY`, enter a long random password of at least 16 characters (`openssl rand -hex 32` makes one, or use a password manager). This key is what stops anyone else from using your server.
4. **Note the server address** Cloudflare shows when the deploy finishes, such as `https://koto-server.<your-subdomain>.workers.dev`. Opening it in a browser shows "Your Koto server is running".
5. **Install Koto** from [Releases](https://github.com/omrajguru/koto/releases/latest):
   1. Once per PC, open `Koto-signing.cer`, choose **Install Certificate**, **Local Machine**, and place it in **Trusted People**.
   2. Open `Koto-x64.msix`, or `Koto-ARM64.msix` on ARM PCs. If Windows says a runtime is missing, use `Koto-<platform>-installer.zip` instead: extract it, right-click `Install.ps1` and choose **Run with PowerShell**.
6. **Connect Koto**. On first launch Koto asks for the server address, the access key, your Sarvam key and, optionally, your Gemini key. **Save and connect** checks them against your server before saving.

The keys are kept in Windows Credential Manager on your PC. Koto sends them over HTTPS to your server with each request; the server uses them for that request and stores none of them. To change them later, open **Settings, Server**.

### What it costs

Koto itself is free and open source. You pay the providers directly, and only for what you use.

| Service | What Koto uses it for | Free allowance |
| --- | --- | --- |
| Cloudflare Workers | The server | 100,000 requests a day |
| Cloudflare R2 | Cloud backup (optional) | 10 GB of storage |
| Sarvam AI | Speech to text, Saaras v4 | See [Sarvam pricing](https://www.sarvam.ai/api-pricing) |
| Google Gemini | Sentence tidy-up (optional) | See [Gemini pricing](https://ai.google.dev/gemini-api/docs/pricing) |

A minute of dictation makes a few requests to your server, well within the free allowance. Short, clean dictation is never sent to Gemini.

## Using Koto

- **Hold** Ctrl + Win to talk, release to insert.
- **Double-tap** Ctrl + Win to dictate hands-free; press it once more (or click the orb) to stop.
- A single quick tap is ignored. **Esc** cancels.

Koto keeps running after its window is closed (tray icon: Open Koto, Writing style, Microphone, Quit Koto) and starts when you sign in to Windows, which can be turned off in Settings.

**Languages.** English, Hindi, Bengali, Gujarati, Kannada, Malayalam, Marathi, Odia, Punjabi, Tamil, Telugu, Urdu, Assamese, Nepali, Konkani, Maithili, Sanskrit and more. Detection is automatic and handles mixed Hindi and English. Hindi, Marathi and other Indian languages are written in English letters by default ("kal meeting hai"); Settings offers their own script or a mix.

**Microphone.** Settings, the tray menu, or the orb's right-click menu while recording. If the chosen microphone is unplugged, Koto records with the Windows default and switches back when it returns.

### Formatting

Saaras already removes most "um" and "uh" and adds punctuation. Koto then applies its own rules, each of which can be switched off in Settings:

- **Spoken corrections.** "Send it to John, oh sorry, it's not John, it's Ravi" becomes "Send it to Ravi". "Scratch that" drops the previous sentence.
- **Lists and layout.** "First, … second, … third, …" becomes a numbered list. "Bullet point", "new line" and "new paragraph" become layout.
- **Spoken punctuation and signs.** "Open bracket … close bracket", "quote … unquote", "question mark", "2 plus 2 equals 4", "C plus plus", "hashtag". Talking *about* punctuation ("the question mark is missing") stays as words.
- **Web and email addresses.** "youtube dot com slash shorts" becomes `youtube.com/shorts`, and "ravi at the rate gmail dot com" becomes `ravi@gmail.com`.
- **Hindi and Marathi numbers** before a unit become digits: "nau vaajta" becomes "9 vaajta", "saade paanch baje" becomes "5:30 baje".
- **Hindi and Marathi filler** (mhanje, matlab, toh, arre, yaar) is removed only where it is filler, because the same words often carry meaning ("rocket mhanje viman").
- **Dictionary.** Words you add are sent to Saaras so names are spelled correctly, and replacements rewrite phrases after transcription.

**Writing styles.** Neutral, Casual (by the way becomes BTW) and Formal (no contractions, slang or chat abbreviations). Switch in Settings, the tray menu or the orb's right-click menu.

**AI tidy-up (optional).** When a dictation still reads like speech after the rules (restarts, trailing thoughts, a phrase said twice), it is sent to Gemini 3.5 Flash-Lite to restructure. An answer that drops a meaningful word, adds content or answers an instruction inside the dictation is rejected, and anything slower than 2.5 seconds falls back to the rule-based text, so the AI step can never delay or lose a dictation. Long dictation is tidied in parts while you are still speaking. History keeps the text before tidying, with **Copy without AI**.

### When something goes wrong, nothing is lost

Audio is written to disk while you speak, and every dictation is saved to History before it is pasted.

| Situation | What Koto does |
| --- | --- |
| No network, server error, rate limit | Retries each part twice. If it still fails, the recording stays in History with **Transcribe again**. |
| Server not connected, or a key not accepted | Still records. The recording is transcribed automatically once the settings are saved. |
| You switched windows before the text was ready | Does not paste into the wrong place. Leaves the text on the clipboard and says so on the orb. |
| The focused app runs as administrator | Windows blocks simulated keys into it, so the text is left on the clipboard. |
| Microphone unplugged mid-recording | Stops, keeps what was recorded, and transcribes it. |
| Koto quits or crashes mid-dictation | The recording is playable. The next launch shows it in History with **Transcribe again**. |
| Esc pressed after more than 2 s of speech | The recording is kept in History in case the cancel was a mistake. |

### Voice notes and backup

Every recording is saved as a WAV file in `Documents\Koto\Voice notes`, about 2 MB per minute, and kept until you choose otherwise in Settings (30, 7 or 1 days).

**Settings, Voice notes, Back up now** copies voice notes, history and preferences to the R2 bucket of your server. It runs in the background, waits while you dictate, and continues where it stopped if interrupted. **Download backup (.zip)** opens a download link that works for 30 minutes. Server settings and keys are never included in a backup. Each server holds up to 3 GB of backups.

### Updates

Koto checks this repository's latest release when it starts and every 6 hours. When a newer version exists, the sidebar and **Settings, About** show **Update and restart**; Windows installs it and reopens Koto. To update your server, copy the latest `worker` folder into the repository Cloudflare created for you; Cloudflare redeploys it on each push.

## Privacy

| Data | Where it goes |
| --- | --- |
| Your voice | From your PC to your server, then to Sarvam for transcription. Saved locally as voice notes. |
| Transcribed text | To Gemini only when the tidy-up is on, a Gemini key is set, and the text needs it. |
| API keys and access key | Windows Credential Manager on your PC, and your server for the length of each request. |
| History and voice notes | Your PC, and your R2 bucket when you back up. |

Koto has no analytics, no accounts and no servers of its own.

## Repository

| Path | Contents |
| --- | --- |
| `app/` | The Windows app: React Native for Windows 0.83, with native C++ for the hotkey, audio capture, the orb, pasting and updates |
| `app/src/formatting/` | The rule-based clean-up, writing styles and the check for when the AI tidy-up is worth asking for |
| `worker/` | The server: a Cloudflare Worker that forwards audio to Sarvam, asks Gemini to tidy text, and keeps backups in R2 |

### Developing

The tests run without Windows-specific tools:

```bash
cd app && npm install && npx jest && npx tsc --noEmit && npx eslint src __tests__ index.js
```

```bash
cd worker && npm install && npm test && npm run typecheck
```

To run the server locally, put `KOTO_ACCESS_KEY=<at least 16 characters>` in `worker/.dev.vars`, then run `npm run dev` and use `http://localhost:8787` as the server address in Koto.

To build and run the app you need Visual Studio with the **Desktop development with C++** and **WinUI application development** workloads:

```bash
cd app && npx react-native run-windows
```

### Building releases

**Actions, Build, Run workflow** builds signed x64 and ARM64 packages and publishes a release named `v1.0.<run number>`. Installed copies of Koto offer it as an update.

Every build must be signed with the same certificate, or Windows will not accept it as an update. A fork that publishes its own builds needs its own certificate, made once:

```bash
openssl req -x509 -newkey rsa:3072 -sha256 -days 3650 -nodes -subj "/CN=Koto" -addext "basicConstraints=critical,CA:FALSE" -addext "keyUsage=critical,digitalSignature" -addext "extendedKeyUsage=codeSigning" -keyout key.pem -out cert.pem
```

```bash
openssl pkcs12 -export -inkey key.pem -in cert.pem -out koto-signing.pfx
```

In Git Bash, start the first command with `MSYS_NO_PATHCONV=1` so `/CN=Koto` is not read as a path. Store the base64 of `koto-signing.pfx` in the repository secret `WINDOWS_SIGNING_CERTIFICATE` and its password in `WINDOWS_SIGNING_PASSWORD`, then delete `key.pem`. The certificate's subject must match `Publisher` in `app/windows/Koto.Package/Package.appxmanifest`; change both together. Keep the `.pfx` somewhere safe: losing it means everyone has to trust a new certificate and reinstall. Forks should also point `app/src/configuration/environment.ts` at their own repository.

## License

[MIT](LICENSE)
