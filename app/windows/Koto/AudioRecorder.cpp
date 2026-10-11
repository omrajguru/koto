#include "pch.h"
#include "AudioRecorder.h"

#include "Microphones.h"

#include <Audioclient.h>
#include <mmdeviceapi.h>

#include <chrono>
#include <cmath>
#include <condition_variable>
#include <cstdio>
#include <stdexcept>

namespace Koto {

namespace {
constexpr uint32_t kSampleRate = 16000;
constexpr size_t kFrameSamples = kSampleRate / 10; // 100 ms
constexpr REFERENCE_TIME kBufferDuration = 2'000'000; // 200 ms in 100 ns units
constexpr auto kHeaderRefreshInterval = std::chrono::seconds(3);

void WriteWaveHeader(FILE *file, uint32_t dataBytes) noexcept {
  struct {
    char riff[4]{'R', 'I', 'F', 'F'};
    uint32_t riffSize;
    char wave[4]{'W', 'A', 'V', 'E'};
    char fmt[4]{'f', 'm', 't', ' '};
    uint32_t fmtSize{16};
    uint16_t format{1};
    uint16_t channels{1};
    uint32_t sampleRate{kSampleRate};
    uint32_t byteRate{kSampleRate * 2};
    uint16_t blockAlign{2};
    uint16_t bitsPerSample{16};
    char data[4]{'d', 'a', 't', 'a'};
    uint32_t dataSize;
  } header;
  static_assert(sizeof(header) == 44);
  header.riffSize = 36 + dataBytes;
  header.dataSize = dataBytes;
  long const position = ftell(file);
  fseek(file, 0, SEEK_SET);
  fwrite(&header, sizeof(header), 1, file);
  fflush(file);
  if (position > 0) {
    fseek(file, position, SEEK_SET);
  }
}

std::string DescribeFailure(HRESULT hr) {
  if (hr == E_ACCESSDENIED) {
    return "Microphone access is off. Turn it on in Settings, Privacy & security, Microphone.";
  }
  if (hr == static_cast<HRESULT>(0x80070490) /* E_NOTFOUND */ || hr == AUDCLNT_E_DEVICE_INVALIDATED) {
    return "No microphone was found. Connect one and try again.";
  }
  if (hr == AUDCLNT_E_DEVICE_IN_USE) {
    return "The microphone is in use by another app.";
  }
  return "The microphone could not be started.";
}
} // namespace

AudioRecorder &AudioRecorder::Instance() noexcept {
  static AudioRecorder instance;
  return instance;
}

std::wstring AudioRecorder::Start(std::wstring const &directory, Callbacks callbacks) {
  // Start and Stop arrive on different worker threads; only one may touch m_thread at a time.
  std::lock_guard lifecycle(m_lifecycleMutex);
  m_shouldStop = true;
  if (m_thread.joinable()) {
    m_thread.join();
  }
  CreateDirectoryW(directory.c_str(), nullptr);
  SYSTEMTIME now;
  GetLocalTime(&now);
  wchar_t name[64];
  swprintf_s(
      name,
      L"\\%04u%02u%02u-%02u%02u%02u-%03u.wav",
      now.wYear,
      now.wMonth,
      now.wDay,
      now.wHour,
      now.wMinute,
      now.wSecond,
      now.wMilliseconds);
  std::wstring path = directory + name;

  {
    std::lock_guard lock(m_startMutex);
    m_hasStartResult = false;
    m_startError.clear();
  }
  m_shouldStop = false;
  m_path = path;
  m_thread = std::thread([this, path, callbacks = std::move(callbacks)]() mutable { Run(path, std::move(callbacks)); });

  std::unique_lock lock(m_startMutex);
  m_started.wait(lock, [this] { return m_hasStartResult; });
  if (!m_startError.empty()) {
    lock.unlock();
    m_thread.join();
    throw std::runtime_error(m_startError);
  }
  return path;
}

bool AudioRecorder::StopIfRecording(std::wstring const &path) noexcept {
  std::lock_guard lifecycle(m_lifecycleMutex);
  if (!m_isRecording.load() || m_path != path) {
    return false;
  }
  m_shouldStop = true;
  if (m_thread.joinable()) {
    m_thread.join();
  }
  return true;
}

std::wstring AudioRecorder::Stop() noexcept {
  std::lock_guard lifecycle(m_lifecycleMutex);
  m_shouldStop = true;
  if (m_thread.joinable()) {
    m_thread.join();
  }
  return m_path;
}

void AudioRecorder::Run(std::wstring path, Callbacks callbacks) noexcept {
  auto reportStart = [this](std::string error) {
    {
      std::lock_guard lock(m_startMutex);
      m_startError = std::move(error);
      m_hasStartResult = true;
    }
    m_started.notify_all();
  };

  HRESULT hr = CoInitializeEx(nullptr, COINIT_MULTITHREADED);
  bool const shouldUninitialize = SUCCEEDED(hr);

  winrt::com_ptr<IMMDeviceEnumerator> enumerator;
  winrt::com_ptr<IMMDevice> device;
  winrt::com_ptr<IAudioClient> client;
  winrt::com_ptr<IAudioCaptureClient> capture;
  HANDLE bufferReady = CreateEventW(nullptr, FALSE, FALSE, nullptr);
  FILE *file = nullptr;

  WAVEFORMATEX format{};
  format.wFormatTag = WAVE_FORMAT_PCM;
  format.nChannels = 1;
  format.nSamplesPerSec = kSampleRate;
  format.wBitsPerSample = 16;
  format.nBlockAlign = 2;
  format.nAvgBytesPerSec = kSampleRate * 2;

  hr = CoCreateInstance(__uuidof(MMDeviceEnumerator), nullptr, CLSCTX_ALL, IID_PPV_ARGS(enumerator.put()));
  // The microphone chosen in Koto, if it is connected; otherwise the Windows default.
  std::wstring const preferred = Microphones::Preferred();
  if (SUCCEEDED(hr) && !preferred.empty()) {
    DWORD state = 0;
    if (FAILED(enumerator->GetDevice(preferred.c_str(), device.put())) || FAILED(device->GetState(&state)) ||
        state != DEVICE_STATE_ACTIVE) {
      device = nullptr;
    }
  }
  if (SUCCEEDED(hr) && !device) {
    hr = enumerator->GetDefaultAudioEndpoint(eCapture, eConsole, device.put());
  }
  if (SUCCEEDED(hr)) {
    hr = device->Activate(__uuidof(IAudioClient), CLSCTX_ALL, nullptr, client.put_void());
  }
  if (SUCCEEDED(hr)) {
    // WASAPI converts from the device's mix format to 16 kHz mono PCM for us.
    hr = client->Initialize(
        AUDCLNT_SHAREMODE_SHARED,
        AUDCLNT_STREAMFLAGS_EVENTCALLBACK | AUDCLNT_STREAMFLAGS_AUTOCONVERTPCM | AUDCLNT_STREAMFLAGS_SRC_DEFAULT_QUALITY,
        kBufferDuration,
        0,
        &format,
        nullptr);
  }
  if (SUCCEEDED(hr)) {
    hr = client->SetEventHandle(bufferReady);
  }
  if (SUCCEEDED(hr)) {
    hr = client->GetService(IID_PPV_ARGS(capture.put()));
  }
  if (SUCCEEDED(hr) && _wfopen_s(&file, path.c_str(), L"wb") != 0) {
    hr = E_FAIL;
  }
  if (SUCCEEDED(hr)) {
    WriteWaveHeader(file, 0);
    hr = client->Start();
  }
  if (FAILED(hr)) {
    if (file) {
      fclose(file);
      DeleteFileW(path.c_str());
    }
    CloseHandle(bufferReady);
    reportStart(DescribeFailure(hr));
    if (shouldUninitialize) {
      CoUninitialize();
    }
    return;
  }

  m_isRecording = true;
  reportStart({});

  std::vector<int16_t> pending;
  pending.reserve(kFrameSamples * 2);
  uint32_t dataBytes = 0;
  auto lastHeaderWrite = std::chrono::steady_clock::now();
  float level = 0.0f;
  std::string failure;

  auto deliver = [&](bool isFinal) {
    while (pending.size() >= kFrameSamples || (isFinal && !pending.empty())) {
      size_t const count = std::min(pending.size(), kFrameSamples);
      std::vector<int16_t> frame(pending.begin(), pending.begin() + count);
      pending.erase(pending.begin(), pending.begin() + count);
      fwrite(frame.data(), sizeof(int16_t), frame.size(), file);
      dataBytes += static_cast<uint32_t>(frame.size() * sizeof(int16_t));
      double sum = 0;
      for (int16_t sample : frame) {
        double const value = sample / 32768.0;
        sum += value * value;
      }
      float const rms = static_cast<float>(std::sqrt(sum / frame.size()));
      // Speech RMS rarely exceeds 0.3, so scale for a lively orb, then smooth.
      float const target = std::min(1.0f, rms * 4.0f);
      level = target > level ? target : level * 0.75f + target * 0.25f;
      m_level = level;
      if (callbacks.onFrame) {
        callbacks.onFrame(frame);
      }
    }
    if (std::chrono::steady_clock::now() - lastHeaderWrite > kHeaderRefreshInterval) {
      WriteWaveHeader(file, dataBytes);
      lastHeaderWrite = std::chrono::steady_clock::now();
    }
  };

  while (!m_shouldStop.load()) {
    DWORD const wait = WaitForSingleObject(bufferReady, 250);
    if (wait != WAIT_OBJECT_0 && wait != WAIT_TIMEOUT) {
      failure = "Recording stopped unexpectedly.";
      break;
    }
    UINT32 packetFrames = 0;
    hr = capture->GetNextPacketSize(&packetFrames);
    while (SUCCEEDED(hr) && packetFrames > 0) {
      BYTE *data = nullptr;
      UINT32 frames = 0;
      DWORD flags = 0;
      hr = capture->GetBuffer(&data, &frames, &flags, nullptr, nullptr);
      if (FAILED(hr)) {
        break;
      }
      auto const *samples = reinterpret_cast<int16_t const *>(data);
      if (flags & AUDCLNT_BUFFERFLAGS_SILENT) {
        pending.insert(pending.end(), frames, 0);
      } else {
        pending.insert(pending.end(), samples, samples + frames);
      }
      capture->ReleaseBuffer(frames);
      hr = capture->GetNextPacketSize(&packetFrames);
    }
    if (FAILED(hr)) {
      failure = hr == AUDCLNT_E_DEVICE_INVALIDATED ? "The microphone was disconnected. What was recorded is saved."
                                                    : "Recording stopped unexpectedly. What was recorded is saved.";
      break;
    }
    deliver(false);
  }

  client->Stop();
  deliver(true);
  WriteWaveHeader(file, dataBytes);
  fclose(file);
  CloseHandle(bufferReady);
  m_level = 0.0f;
  m_isRecording = false;
  if (!failure.empty() && callbacks.onError) {
    callbacks.onError(failure);
  }
  if (shouldUninitialize) {
    CoUninitialize();
  }
}

} // namespace Koto
