#include "pch.h"
#include "Microphones.h"

#include <mmdeviceapi.h>

#include <algorithm>
#include <mutex>
#include <thread>

namespace Koto::Microphones {

namespace {
// PKEY_Device_FriendlyName, spelled out so no extra library is needed to define it.
PROPERTYKEY const kFriendlyName{{0xa45c254e, 0xdf1c, 0x4efd, {0x80, 0x20, 0x67, 0xd1, 0x46, 0xa8, 0x50, 0xe0}}, 14};

std::mutex g_mutex;
std::wstring g_preferred;
std::function<void(std::wstring const &)> g_listener;
// Ids behind the items of the last menu, so a command maps back to its device.
std::vector<std::wstring> g_menuIds;

// COM on whatever thread asks: initialise it if needed, and leave it as it was afterwards.
struct ComScope {
  bool shouldUninitialize;
  ComScope() noexcept : shouldUninitialize(SUCCEEDED(CoInitializeEx(nullptr, COINIT_MULTITHREADED))) {}
  ~ComScope() {
    if (shouldUninitialize) {
      CoUninitialize();
    }
  }
};

std::wstring DeviceId(IMMDevice *device) {
  LPWSTR id = nullptr;
  std::wstring result;
  if (SUCCEEDED(device->GetId(&id)) && id) {
    result = id;
  }
  CoTaskMemFree(id);
  return result;
}

std::wstring FriendlyName(IMMDevice *device) {
  winrt::com_ptr<IPropertyStore> properties;
  std::wstring name;
  if (SUCCEEDED(device->OpenPropertyStore(STGM_READ, properties.put()))) {
    PROPVARIANT value;
    PropVariantInit(&value);
    if (SUCCEEDED(properties->GetValue(kFriendlyName, &value)) && value.vt == VT_LPWSTR && value.pwszVal) {
      name = value.pwszVal;
    }
    PropVariantClear(&value);
  }
  return name.empty() ? L"Microphone" : name;
}
} // namespace

std::vector<Microphone> List() noexcept {
  std::vector<Microphone> microphones;
  try {
    ComScope com;
    winrt::com_ptr<IMMDeviceEnumerator> enumerator;
    if (FAILED(CoCreateInstance(__uuidof(MMDeviceEnumerator), nullptr, CLSCTX_ALL, IID_PPV_ARGS(enumerator.put())))) {
      return microphones;
    }
    std::wstring defaultId;
    winrt::com_ptr<IMMDevice> defaultDevice;
    if (SUCCEEDED(enumerator->GetDefaultAudioEndpoint(eCapture, eConsole, defaultDevice.put()))) {
      defaultId = DeviceId(defaultDevice.get());
    }
    winrt::com_ptr<IMMDeviceCollection> devices;
    if (FAILED(enumerator->EnumAudioEndpoints(eCapture, DEVICE_STATE_ACTIVE, devices.put()))) {
      return microphones;
    }
    UINT count = 0;
    devices->GetCount(&count);
    for (UINT index = 0; index < count && microphones.size() < kMaximumItems - 1; ++index) {
      winrt::com_ptr<IMMDevice> device;
      if (FAILED(devices->Item(index, device.put()))) {
        continue;
      }
      std::wstring id = DeviceId(device.get());
      if (id.empty()) {
        continue;
      }
      bool const isDefault = id == defaultId;
      microphones.push_back({std::move(id), FriendlyName(device.get()), isDefault});
    }
  } catch (...) {
  }
  return microphones;
}

void SetPreferred(std::wstring const &id) noexcept {
  std::lock_guard lock(g_mutex);
  g_preferred = id;
}

std::wstring Preferred() noexcept {
  std::lock_guard lock(g_mutex);
  return g_preferred;
}

void SetListener(std::function<void(std::wstring const &)> listener) noexcept {
  std::lock_guard lock(g_mutex);
  g_listener = std::move(listener);
}

HMENU CreateMenu() noexcept {
  HMENU menu = CreatePopupMenu();
  std::vector<Microphone> const microphones = List();
  std::wstring const preferred = Preferred();
  bool const isPreferredConnected =
      std::any_of(microphones.begin(), microphones.end(), [&preferred](Microphone const &microphone) { return microphone.id == preferred; });
  std::vector<std::wstring> ids{L""};
  AppendMenuW(menu, MF_STRING | (preferred.empty() ? MF_CHECKED : MF_UNCHECKED), kFirstCommand, L"Windows default");
  if (!microphones.empty()) {
    AppendMenuW(menu, MF_SEPARATOR, 0, nullptr);
  }
  for (Microphone const &microphone : microphones) {
    UINT const command = kFirstCommand + static_cast<UINT>(ids.size());
    AppendMenuW(menu, MF_STRING | (microphone.id == preferred ? MF_CHECKED : MF_UNCHECKED), command, microphone.name.c_str());
    ids.push_back(microphone.id);
  }
  if (!preferred.empty() && !isPreferredConnected) {
    // The chosen microphone is unplugged: say so, and that the default is used meanwhile.
    AppendMenuW(menu, MF_SEPARATOR, 0, nullptr);
    AppendMenuW(menu, MF_STRING | MF_GRAYED, 0, L"Chosen microphone not connected; using the default");
  }
  std::lock_guard lock(g_mutex);
  g_menuIds = std::move(ids);
  return menu;
}

namespace {
// Windows calls this on its own threads whenever an audio endpoint changes.
struct DeviceWatcher : winrt::implements<DeviceWatcher, IMMNotificationClient> {
  std::function<void()> onChange;

  void Notify() const noexcept {
    try {
      if (onChange) {
        onChange();
      }
    } catch (...) {
    }
  }

  HRESULT STDMETHODCALLTYPE OnDeviceStateChanged(LPCWSTR, DWORD) noexcept override {
    Notify();
    return S_OK;
  }
  HRESULT STDMETHODCALLTYPE OnDeviceAdded(LPCWSTR) noexcept override {
    Notify();
    return S_OK;
  }
  HRESULT STDMETHODCALLTYPE OnDeviceRemoved(LPCWSTR) noexcept override {
    Notify();
    return S_OK;
  }
  HRESULT STDMETHODCALLTYPE OnDefaultDeviceChanged(EDataFlow flow, ERole role, LPCWSTR) noexcept override {
    if (flow == eCapture && role == eConsole) {
      Notify();
    }
    return S_OK;
  }
  // Fires constantly (volume, format); names do not change in a way worth refreshing for.
  HRESULT STDMETHODCALLTYPE OnPropertyValueChanged(LPCWSTR, PROPERTYKEY const) noexcept override {
    return S_OK;
  }
};

// Kept for the life of the process: unregistering on exit is unnecessary.
winrt::com_ptr<IMMDeviceEnumerator> g_watchingEnumerator;
winrt::com_ptr<DeviceWatcher> g_watcher;
} // namespace

void WatchForChanges(std::function<void()> onChange) noexcept {
  // Registered from a short-lived thread in the multithreaded apartment, which
  // CoIncrementMTAUsage keeps alive afterwards, so the caller's thread model does not matter.
  std::thread([onChange = std::move(onChange)]() mutable {
    try {
      if (FAILED(CoInitializeEx(nullptr, COINIT_MULTITHREADED))) {
        return;
      }
      CO_MTA_USAGE_COOKIE cookie{};
      CoIncrementMTAUsage(&cookie);
      winrt::com_ptr<IMMDeviceEnumerator> enumerator;
      if (SUCCEEDED(CoCreateInstance(__uuidof(MMDeviceEnumerator), nullptr, CLSCTX_ALL, IID_PPV_ARGS(enumerator.put())))) {
        auto watcher = winrt::make_self<DeviceWatcher>();
        watcher->onChange = std::move(onChange);
        if (SUCCEEDED(enumerator->RegisterEndpointNotificationCallback(watcher.get()))) {
          std::lock_guard lock(g_mutex);
          g_watchingEnumerator = enumerator;
          g_watcher = watcher;
        }
      }
      CoUninitialize();
    } catch (...) {
    }
  }).detach();
}

bool HandleCommand(unsigned int command) noexcept {
  std::wstring id;
  std::function<void(std::wstring const &)> listener;
  {
    std::lock_guard lock(g_mutex);
    if (command < kFirstCommand || command >= kFirstCommand + g_menuIds.size()) {
      return false;
    }
    id = g_menuIds[command - kFirstCommand];
    g_preferred = id;
    listener = g_listener;
  }
  if (listener) {
    listener(id);
  }
  return true;
}

} // namespace Koto::Microphones
