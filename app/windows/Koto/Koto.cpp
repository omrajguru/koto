// Koto.cpp : Defines the entry point for the application.
//

#include "pch.h"
#include "Koto.h"

#include "AppUpdater.h"
#include "AutolinkedNativeModules.g.h"
#include "BundleManager.h"
#include "DesktopIntegration.h"
#include "LocalStorage.h"
#include "Microphones.h"
#include "WritingStyleMenu.h"

#include "NativeModules.h"

#include <dwmapi.h>
#include <shellapi.h>
#include <winrt/Windows.ApplicationModel.h>

#pragma comment(lib, "dwmapi.lib")

// A PackageProvider containing any turbo modules you define within this app project
struct CompReactPackageProvider
    : winrt::implements<CompReactPackageProvider, winrt::Microsoft::ReactNative::IReactPackageProvider> {
 public: // IReactPackageProvider
  void CreatePackage(winrt::Microsoft::ReactNative::IReactPackageBuilder const &packageBuilder) noexcept {
    AddAttributedModules(packageBuilder, true);
  }
};

namespace {
// Koto keeps running after its window is closed so the hotkey keeps working.
// A hidden host window owns the notification area icon and receives
// "show yourself" requests from a second launch.
constexpr wchar_t kHostWindowClass[] = L"KotoBackgroundHost";
constexpr wchar_t kSingleInstanceMutex[] = L"Local\\KotoDictationSingleInstance";
constexpr UINT kTrayMessage = WM_APP + 10;
constexpr UINT kShowWindowMessage = WM_APP + 11;
constexpr UINT kHideWindowMessage = WM_APP + 12;
constexpr UINT kReloadBundleMessage = WM_APP + 13;
constexpr UINT kOpenCommand = 1;
constexpr UINT kQuitCommand = 2;

winrt::Microsoft::UI::Windowing::AppWindow g_appWindow{nullptr};
// file://<install folder>\Bundle\ : the JavaScript bundle built into this version of the app.
std::wstring g_builtInBundleRoot;

std::wstring BundleRootFor(std::optional<Koto::BundleManager::ActiveBundle> const &bundle) {
  return bundle ? std::wstring(L"file://") + bundle->directory + L"\\" : g_builtInBundleRoot;
}
HANDLE g_singleInstance = nullptr;
HWND g_hostWindow = nullptr;
UINT g_taskbarCreatedMessage = 0;
NOTIFYICONDATAW g_trayIcon{};

bool IsSystemInLightMode() {
  DWORD value = 0;
  DWORD size = sizeof(value);
  // Missing value means the default, which is light.
  if (RegGetValueW(
          HKEY_CURRENT_USER,
          L"Software\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize",
          L"AppsUseLightTheme",
          RRF_RT_REG_DWORD,
          nullptr,
          &value,
          &size) != ERROR_SUCCESS) {
    return true;
  }
  return value != 0;
}

// Paints the caption bar with the app's own background (design tokens bg-primary,
// text-primary, border-subtle) instead of the default light caption, following the
// Windows light or dark app setting like the rest of the interface does.
void ApplyTitleBarTheme() {
  if (!g_appWindow) {
    return;
  }
  HWND window = winrt::Microsoft::UI::GetWindowFromWindowId(g_appWindow.Id());
  bool const isLight = IsSystemInLightMode();
  BOOL const useDarkMode = isLight ? FALSE : TRUE;
  COLORREF const caption = isLight ? RGB(0xFF, 0xFF, 0xFF) : RGB(0x00, 0x00, 0x00);
  COLORREF const text = isLight ? RGB(0x12, 0x12, 0x12) : RGB(0xF0, 0xF0, 0xF0);
  COLORREF const border = isLight ? RGB(0xE9, 0xE9, 0xE9) : RGB(0x1C, 0x1C, 0x1C);
  // Attribute numbers from dwmapi.h; spelled out so older SDK headers still compile.
  constexpr DWORD kUseImmersiveDarkMode = 20;
  constexpr DWORD kBorderColor = 34;
  constexpr DWORD kCaptionColor = 35;
  constexpr DWORD kTextColor = 36;
  DwmSetWindowAttribute(window, kUseImmersiveDarkMode, &useDarkMode, sizeof(useDarkMode));
  DwmSetWindowAttribute(window, kCaptionColor, &caption, sizeof(caption));
  DwmSetWindowAttribute(window, kTextColor, &text, sizeof(text));
  DwmSetWindowAttribute(window, kBorderColor, &border, sizeof(border));
}

void ShowMainWindow() {
  if (!g_appWindow) {
    return;
  }
  g_appWindow.Show(true);
  HWND window = winrt::Microsoft::UI::GetWindowFromWindowId(g_appWindow.Id());
  if (IsIconic(window)) {
    ShowWindow(window, SW_RESTORE);
  }
  SetForegroundWindow(window);
}

void AddTrayIcon(HWND host) {
  g_trayIcon = {sizeof(g_trayIcon)};
  g_trayIcon.hWnd = host;
  g_trayIcon.uID = 1;
  g_trayIcon.uFlags = NIF_ICON | NIF_MESSAGE | NIF_TIP | NIF_SHOWTIP;
  g_trayIcon.uCallbackMessage = kTrayMessage;
  g_trayIcon.hIcon = static_cast<HICON>(LoadImageW(
      GetModuleHandleW(nullptr), MAKEINTRESOURCEW(IDI_ICON1), IMAGE_ICON, GetSystemMetrics(SM_CXSMICON), GetSystemMetrics(SM_CYSMICON), 0));
  wcscpy_s(g_trayIcon.szTip, L"Koto: hold Ctrl + Win to dictate");
  Shell_NotifyIconW(NIM_ADD, &g_trayIcon);
  g_trayIcon.uVersion = NOTIFYICON_VERSION_4;
  Shell_NotifyIconW(NIM_SETVERSION, &g_trayIcon);
}

void ShowTrayMenu(HWND host) {
  HMENU menu = CreatePopupMenu();
  AppendMenuW(menu, MF_STRING, kOpenCommand, L"Open Koto");
  // Destroyed together with the parent menu below.
  AppendMenuW(menu, MF_POPUP, reinterpret_cast<UINT_PTR>(Koto::WritingStyleMenu::Create()), L"Writing style");
  AppendMenuW(menu, MF_POPUP, reinterpret_cast<UINT_PTR>(Koto::Microphones::CreateMenu()), L"Microphone");
  AppendMenuW(menu, MF_SEPARATOR, 0, nullptr);
  AppendMenuW(menu, MF_STRING, kQuitCommand, L"Quit Koto");
  POINT cursor;
  GetCursorPos(&cursor);
  // Required so the menu closes when clicking elsewhere.
  SetForegroundWindow(host);
  UINT const command = TrackPopupMenu(menu, TPM_RETURNCMD | TPM_RIGHTBUTTON | TPM_BOTTOMALIGN, cursor.x, cursor.y, 0, host, nullptr);
  DestroyMenu(menu);
  if (Koto::WritingStyleMenu::HandleCommand(command) || Koto::Microphones::HandleCommand(command)) {
    return;
  }
  if (command == kOpenCommand) {
    ShowMainWindow();
  } else if (command == kQuitCommand) {
    Shell_NotifyIconW(NIM_DELETE, &g_trayIcon);
    // Recordings and history are written as they happen, so exiting immediately loses nothing.
    ExitProcess(0);
  }
}

// Starts a fresh Koto that loads the newly installed bundle, then exits this one.
// ReactNativeHost.ReloadInstance() crashed inside hermes.dll (0xc0000409) every time, so an
// instant update restarts the process instead. Recordings and history are written as they
// happen, and JavaScript only asks for this while no dictation is in progress.
void RestartWithInstalledBundle() {
  std::wstring applicationId;
  try {
    applicationId = std::wstring(winrt::Windows::ApplicationModel::Package::Current().Id().FamilyName()) + L"!App";
  } catch (...) {
    return; // Not packaged: nothing to restart into.
  }
  // Free the single-instance mutex first, or the new process would hand over to this one and exit.
  if (g_singleInstance) {
    ReleaseMutex(g_singleInstance);
    CloseHandle(g_singleInstance);
    g_singleInstance = nullptr;
  }
  Shell_NotifyIconW(NIM_DELETE, &g_trayIcon);
  std::wstring const target = L"shell:AppsFolder\\" + applicationId;
  ShellExecuteW(nullptr, L"open", target.c_str(), nullptr, nullptr, SW_SHOWNORMAL);
  ExitProcess(0);
}

LRESULT CALLBACK HostWindowProc(HWND window, UINT message, WPARAM wParam, LPARAM lParam) {
  if (message == kTrayMessage) {
    switch (LOWORD(lParam)) {
      case NIN_SELECT:
      case NIN_KEYSELECT:
      case WM_LBUTTONUP:
        ShowMainWindow();
        break;
      case WM_CONTEXTMENU:
      case WM_RBUTTONUP:
        ShowTrayMenu(window);
        break;
    }
    return 0;
  }
  if (message == kShowWindowMessage) {
    ShowMainWindow();
    return 0;
  }
  if (message == kReloadBundleMessage) {
    // Development builds load from Metro (no built-in bundle root) and never take instant updates.
    if (!g_builtInBundleRoot.empty()) {
      RestartWithInstalledBundle();
    }
    return 0;
  }
  if (message == kHideWindowMessage) {
    if (g_appWindow) {
      g_appWindow.Hide();
    }
    return 0;
  }
  if (message == WM_SETTINGCHANGE && lParam && wcscmp(reinterpret_cast<wchar_t const *>(lParam), L"ImmersiveColorSet") == 0) {
    // The Windows light or dark setting changed.
    ApplyTitleBarTheme();
    return 0;
  }
  if (message == g_taskbarCreatedMessage && g_taskbarCreatedMessage != 0) {
    // Explorer restarted; the icon must be added again.
    AddTrayIcon(window);
    return 0;
  }
  return DefWindowProcW(window, message, wParam, lParam);
}

HWND CreateHostWindow(HINSTANCE instance) {
  WNDCLASSEXW windowClass{sizeof(windowClass)};
  windowClass.lpfnWndProc = HostWindowProc;
  windowClass.hInstance = instance;
  windowClass.lpszClassName = kHostWindowClass;
  RegisterClassExW(&windowClass);
  g_taskbarCreatedMessage = RegisterWindowMessageW(L"TaskbarCreated");
  // A hidden top-level window (not message-only) so it receives the TaskbarCreated broadcast.
  return CreateWindowExW(WS_EX_TOOLWINDOW, kHostWindowClass, L"Koto", WS_POPUP, 0, 0, 0, 0, nullptr, nullptr, instance, nullptr);
}
} // namespace

// The entry point of the Win32 application
_Use_decl_annotations_ int CALLBACK WinMain(HINSTANCE instance, HINSTANCE, PSTR /* commandLine */, int showCmd) {
  // A second launch (Start menu, taskbar) shows the running instance instead of starting another
  // one, which would install a second hotkey hook and paste everything twice.
  // If the running copy has no host window yet (it is starting, or exiting after an instant
  // update), wait briefly for it to either appear or let go of the mutex.
  bool isAlreadyRunning = false;
  for (int attempt = 0; attempt < 20; ++attempt) {
    g_singleInstance = CreateMutexW(nullptr, TRUE, kSingleInstanceMutex);
    isAlreadyRunning = GetLastError() == ERROR_ALREADY_EXISTS;
    if (!isAlreadyRunning) {
      break;
    }
    CloseHandle(g_singleInstance);
    g_singleInstance = nullptr;
    if (FindWindowW(kHostWindowClass, nullptr)) {
      break;
    }
    Sleep(100);
  }
  if (isAlreadyRunning) {
    if (HWND existing = FindWindowW(kHostWindowClass, nullptr)) {
      AllowSetForegroundWindow(ASFW_ANY);
      PostMessageW(existing, kShowWindowMessage, 0, 0);
    }
    return 0;
  }

  // Initialize WinRT
  winrt::init_apartment(winrt::apartment_type::single_threaded);

  // Voice notes now live in Documents\Koto\Voice notes; bring older ones along.
  Koto::LocalStorage::MoveLegacyRecordings();

  // Enable per monitor DPI scaling
  SetProcessDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2);

  // Find the path hosting the app exe file
  WCHAR appDirectory[MAX_PATH];
  GetModuleFileNameW(NULL, appDirectory, MAX_PATH);
  PathCchRemoveFileSpec(appDirectory, MAX_PATH);

  // Create a ReactNativeWin32App with the ReactNativeAppBuilder
  auto reactNativeWin32App{winrt::Microsoft::ReactNative::ReactNativeAppBuilder().Build()};

  // Configure the initial InstanceSettings for the app's ReactNativeHost
  auto settings{reactNativeWin32App.ReactNativeHost().InstanceSettings()};
  // Register any autolinked native modules
  RegisterAutolinkedNativeModulePackages(settings.PackageProviders());
  // Register any native modules defined within this app project
  settings.PackageProviders().Append(winrt::make<CompReactPackageProvider>());

#if BUNDLE
  // Load the JS bundle from a file (not Metro): an instant update if one is installed for this
  // native version (see BundleManager), otherwise the bundle built into the app.
  g_builtInBundleRoot = std::wstring(L"file://").append(appDirectory).append(L"\\Bundle\\");
  settings.BundleRootPath(BundleRootFor(Koto::BundleManager::Resolve(Koto::AppUpdater::PackageVersion())).c_str());
  // Set the name of the bundle file (without the .bundle extension)
  settings.JavaScriptBundleFile(L"index.windows");
  // Disable hot reload
  settings.UseFastRefresh(false);
#else
  // Load the JS bundle from Metro
  settings.JavaScriptBundleFile(L"index");
  // Enable hot reload
  settings.UseFastRefresh(true);
#endif
#if _DEBUG
  // For Debug builds
  // Enable Direct Debugging of JS
  settings.UseDirectDebugger(true);
  // Enable the Developer Menu
  settings.UseDeveloperSupport(true);
#else
  // For Release builds:
  // Disable Direct Debugging of JS
  settings.UseDirectDebugger(false);
  // Disable the Developer Menu
  settings.UseDeveloperSupport(false);
#endif

  // Get the AppWindow so we can configure its initial title and size
  auto appWindow{reactNativeWin32App.AppWindow()};
  g_appWindow = appWindow;
  appWindow.Title(L"Koto");
  // AppWindow sizes are in physical pixels; scale so the window is the same size on high-DPI displays.
  float const scale = GetDpiForSystem() / 96.0f;
  appWindow.Resize({static_cast<int32_t>(1040 * scale), static_cast<int32_t>(720 * scale)});

  // Closing the window hides it. Koto keeps listening for the hotkey; quit from the tray icon.
  appWindow.Closing([](auto const &sender, winrt::Microsoft::UI::Windowing::AppWindowClosingEventArgs const &args) {
    args.Cancel(true);
    sender.Hide();
  });

  ApplyTitleBarTheme();
  {
    // Caption and Alt + Tab icons, from the executable's icon resource.
    HWND window = winrt::Microsoft::UI::GetWindowFromWindowId(appWindow.Id());
    auto loadIcon = [instance](int metricX, int metricY) {
      return static_cast<HICON>(LoadImageW(
          instance, MAKEINTRESOURCEW(IDI_ICON1), IMAGE_ICON, GetSystemMetrics(metricX), GetSystemMetrics(metricY), 0));
    };
    SendMessageW(window, WM_SETICON, ICON_SMALL, reinterpret_cast<LPARAM>(loadIcon(SM_CXSMICON, SM_CYSMICON)));
    SendMessageW(window, WM_SETICON, ICON_BIG, reinterpret_cast<LPARAM>(loadIcon(SM_CXICON, SM_CYICON)));
  }

  g_hostWindow = CreateHostWindow(instance);
  AddTrayIcon(g_hostWindow);
  Koto::WindowHost::ShowMainWindow() = [] { PostMessageW(g_hostWindow, kShowWindowMessage, 0, 0); };
  Koto::WindowHost::ReloadWithInstalledBundle() = [] { PostMessageW(g_hostWindow, kReloadBundleMessage, 0, 0); };

  // Started by Windows at sign-in: run in the background without showing the window.
  if (Koto::LocalStorage::WasLaunchedAtLogin()) {
    PostMessageW(g_hostWindow, kHideWindowMessage, 0, 0);
  }

  // Get the ReactViewOptions so we can set the initial RN component to load
  auto viewOptions{reactNativeWin32App.ReactViewOptions()};
  viewOptions.ComponentName(L"Koto");

  // Start the app
  reactNativeWin32App.Start();

  Shell_NotifyIconW(NIM_DELETE, &g_trayIcon);
  if (g_singleInstance) {
    CloseHandle(g_singleInstance);
  }
  ExitProcess(0);
}
