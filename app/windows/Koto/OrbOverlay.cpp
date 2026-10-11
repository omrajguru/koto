#include "pch.h"
#include "OrbOverlay.h"

#include "TextInsertion.h"
#include "Microphones.h"
#include "WritingStyleMenu.h"

#include <ShellScalingApi.h>
#include <windowsx.h>

#include <algorithm>
#include <cmath>
#include <memory>

// GDI+ expects the min/max macros that NOMINMAX removes.
namespace Gdiplus {
using std::max;
using std::min;
} // namespace Gdiplus
#include <objidl.h>
#include <gdiplus.h>

#pragma comment(lib, "gdi32.lib")
#pragma comment(lib, "gdiplus.lib")
#pragma comment(lib, "Shcore.lib")

namespace Koto {

namespace {
constexpr UINT kApplyStateMessage = WM_APP + 1;
constexpr UINT_PTR kAnimationTimer = 1;
constexpr UINT kFrameIntervalMs = 16;
// Canvas in device-independent pixels. Large enough for the orb and a notice beside it.
constexpr int kCanvasWidth = 520;
constexpr int kCanvasHeight = 88;
constexpr int kOrbDiameter = 40;
constexpr int kBottomMargin = 28;
constexpr float kFadeStep = 1.0f / 8.0f; // ~130 ms

// Design tokens (dark surface; the overlay floats over any app so it keeps one appearance).
Gdiplus::Color const kSurface(240, 10, 10, 10);
Gdiplus::Color const kBorder(255, 42, 42, 42);
Gdiplus::Color const kTextPrimary(255, 240, 240, 240);
Gdiplus::Color const kTextSecondary(255, 154, 154, 154);
Gdiplus::Color const kAccent(255, 255, 90, 31);
Gdiplus::Color const kAccentLight(255, 255, 122, 69);
Gdiplus::Color const kError(255, 240, 56, 74);
Gdiplus::Color const kNeutral(255, 30, 30, 30);

Gdiplus::Color WithAlpha(Gdiplus::Color color, float alpha) {
  return Gdiplus::Color(static_cast<BYTE>(std::clamp(alpha, 0.0f, 1.0f) * color.GetA()), color.GetR(), color.GetG(), color.GetB());
}

void AddRoundedRectangle(Gdiplus::GraphicsPath &path, Gdiplus::RectF rect, float radius) {
  float const diameter = radius * 2;
  path.AddArc(rect.X, rect.Y, diameter, diameter, 180, 90);
  path.AddArc(rect.GetRight() - diameter, rect.Y, diameter, diameter, 270, 90);
  path.AddArc(rect.GetRight() - diameter, rect.GetBottom() - diameter, diameter, diameter, 0, 90);
  path.AddArc(rect.X, rect.GetBottom() - diameter, diameter, diameter, 90, 90);
  path.CloseFigure();
}

// Created once on the overlay thread after GDI+ starts; font lookup is too slow to repeat every frame.
std::unique_ptr<Gdiplus::FontFamily> g_fontFamily;

std::unique_ptr<Gdiplus::FontFamily> CreateInterfaceFontFamily() {
  for (wchar_t const *name : {L"Segoe UI Variable Text", L"Segoe UI"}) {
    auto family = std::make_unique<Gdiplus::FontFamily>(name);
    if (family->GetLastStatus() == Gdiplus::Ok) {
      return family;
    }
  }
  return std::make_unique<Gdiplus::FontFamily>(L"Arial");
}
} // namespace

OrbOverlay &OrbOverlay::Instance() noexcept {
  static OrbOverlay instance;
  return instance;
}

void OrbOverlay::Start(std::function<float()> levelSource, std::function<void()> onToggle) noexcept {
  if (m_thread.joinable()) {
    return;
  }
  m_levelSource = std::move(levelSource);
  m_onToggle = std::move(onToggle);
  m_thread = std::thread([this] { Run(); });
  m_thread.detach();
}

void OrbOverlay::SetState(State state, std::wstring message) noexcept {
  {
    std::lock_guard lock(m_pendingMutex);
    m_pendingState = state;
    m_pendingMessage = std::move(message);
  }
  if (m_window) {
    PostMessageW(m_window, kApplyStateMessage, 0, 0);
  }
}

void OrbOverlay::Run() noexcept {
  Gdiplus::GdiplusStartupInput startupInput;
  ULONG_PTR gdiplusToken = 0;
  Gdiplus::GdiplusStartup(&gdiplusToken, &startupInput, nullptr);
  g_fontFamily = CreateInterfaceFontFamily();

  WNDCLASSEXW windowClass{sizeof(windowClass)};
  windowClass.lpfnWndProc = WindowProc;
  windowClass.hInstance = GetModuleHandleW(nullptr);
  windowClass.lpszClassName = L"KotoOrbOverlay";
  windowClass.hCursor = LoadCursorW(nullptr, IDC_HAND);
  RegisterClassExW(&windowClass);

  m_window = CreateWindowExW(
      WS_EX_LAYERED | WS_EX_TOPMOST | WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE,
      windowClass.lpszClassName,
      L"Koto",
      WS_POPUP,
      0,
      0,
      kCanvasWidth,
      kCanvasHeight,
      nullptr,
      nullptr,
      windowClass.hInstance,
      this);
  ApplyPendingState();

  MSG message;
  while (GetMessageW(&message, nullptr, 0, 0) > 0) {
    TranslateMessage(&message);
    DispatchMessageW(&message);
  }
  g_fontFamily.reset();
  Gdiplus::GdiplusShutdown(gdiplusToken);
}

LRESULT CALLBACK OrbOverlay::WindowProc(HWND window, UINT message, WPARAM wParam, LPARAM lParam) noexcept {
  auto &overlay = Instance();
  switch (message) {
    case kApplyStateMessage:
      overlay.ApplyPendingState();
      return 0;
    case WM_TIMER:
      overlay.Render();
      return 0;
    case WM_MOUSEACTIVATE:
      // Clicking the orb must not steal focus from the app being dictated into.
      return MA_NOACTIVATE;
    case WM_LBUTTONUP: {
      POINT point{GET_X_LPARAM(lParam), GET_Y_LPARAM(lParam)};
      bool const isRecording = overlay.m_state == State::Listening || overlay.m_state == State::HandsFree;
      // Only a recording orb is a control; clicking a notice does nothing.
      if (isRecording && PtInRect(&overlay.m_orbBounds, point) && overlay.m_onToggle) {
        overlay.m_onToggle();
      }
      return 0;
    }
    case WM_RBUTTONUP: {
      POINT point{GET_X_LPARAM(lParam), GET_Y_LPARAM(lParam)};
      bool const isRecording = overlay.m_state == State::Listening || overlay.m_state == State::HandsFree;
      if (!isRecording || !PtInRect(&overlay.m_orbBounds, point)) {
        return 0;
      }
      // Writing style for this dictation, and the microphone for the next one. A popup menu
      // needs its owner in the foreground to close properly, so focus is handed back to the
      // app being dictated into afterwards.
      HMENU menu = WritingStyleMenu::Create();
      AppendMenuW(menu, MF_SEPARATOR, 0, nullptr);
      AppendMenuW(menu, MF_POPUP, reinterpret_cast<UINT_PTR>(Microphones::CreateMenu()), L"Microphone for next dictation");
      POINT cursor;
      GetCursorPos(&cursor);
      SetForegroundWindow(window);
      UINT const command = TrackPopupMenu(
          menu, TPM_RETURNCMD | TPM_RIGHTBUTTON | TPM_BOTTOMALIGN | TPM_CENTERALIGN, cursor.x, cursor.y, 0, window, nullptr);
      PostMessageW(window, WM_NULL, 0, 0);
      DestroyMenu(menu);
      if (!WritingStyleMenu::HandleCommand(command)) {
        Microphones::HandleCommand(command);
      }
      TextInsertion::RestoreFocusToTarget();
      return 0;
    }
    case WM_SETCURSOR: {
      POINT point;
      GetCursorPos(&point);
      ScreenToClient(window, &point);
      bool const isRecording = overlay.m_state == State::Listening || overlay.m_state == State::HandsFree;
      SetCursor(LoadCursorW(nullptr, isRecording && PtInRect(&overlay.m_orbBounds, point) ? IDC_HAND : IDC_ARROW));
      return TRUE;
    }
  }
  return DefWindowProcW(window, message, wParam, lParam);
}

void OrbOverlay::ApplyPendingState() noexcept {
  State next;
  std::wstring message;
  {
    std::lock_guard lock(m_pendingMutex);
    next = m_pendingState;
    message = m_pendingMessage;
  }
  bool const wasHidden = m_state == State::Hidden && m_opacity <= 0.0f;
  m_state = next;
  if (next != State::Hidden) {
    // Keep drawing the last visible state while fading out.
    m_drawnState = next;
    m_message = std::move(message);
  }
  if (next != State::Hidden && wasHidden) {
    Position();
    ShowWindow(m_window, SW_SHOWNOACTIVATE);
  }
  SetTimer(m_window, kAnimationTimer, kFrameIntervalMs, nullptr);
  Render();
}

void OrbOverlay::Position() noexcept {
  // Show on the monitor the person is working on.
  HMONITOR monitor = MonitorFromWindow(GetForegroundWindow(), MONITOR_DEFAULTTOPRIMARY);
  MONITORINFO info{sizeof(info)};
  GetMonitorInfoW(monitor, &info);
  UINT dpiX = 96, dpiY = 96;
  GetDpiForMonitor(monitor, MDT_EFFECTIVE_DPI, &dpiX, &dpiY);
  m_dpi = dpiX;
  float const scale = m_dpi / 96.0f;
  int const width = static_cast<int>(kCanvasWidth * scale);
  int const height = static_cast<int>(kCanvasHeight * scale);
  RECT const &work = info.rcWork;
  int const x = work.left + (work.right - work.left - width) / 2;
  int const y = work.bottom - height - static_cast<int>(kBottomMargin * scale);
  SetWindowPos(m_window, HWND_TOPMOST, x, y, width, height, SWP_NOACTIVATE);
}

void OrbOverlay::Render() noexcept {
  bool const isVisible = m_state != State::Hidden;
  m_opacity = std::clamp(m_opacity + (isVisible ? kFadeStep : -kFadeStep), 0.0f, 1.0f);
  if (!isVisible && m_opacity <= 0.0f) {
    KillTimer(m_window, kAnimationTimer);
    ShowWindow(m_window, SW_HIDE);
    SetRectEmpty(&m_orbBounds);
    return;
  }

  float const targetLevel = (m_state == State::Listening || m_state == State::HandsFree) && m_levelSource ? m_levelSource() : 0.0f;
  m_level += (targetLevel - m_level) * 0.35f;
  m_phase += kFrameIntervalMs / 1000.0;

  float const scale = m_dpi / 96.0f;
  int const width = static_cast<int>(kCanvasWidth * scale);
  int const height = static_cast<int>(kCanvasHeight * scale);

  BITMAPINFO bitmapInfo{};
  bitmapInfo.bmiHeader.biSize = sizeof(BITMAPINFOHEADER);
  bitmapInfo.bmiHeader.biWidth = width;
  bitmapInfo.bmiHeader.biHeight = -height;
  bitmapInfo.bmiHeader.biPlanes = 1;
  bitmapInfo.bmiHeader.biBitCount = 32;
  bitmapInfo.bmiHeader.biCompression = BI_RGB;
  void *pixels = nullptr;
  HDC screen = GetDC(nullptr);
  HDC memory = CreateCompatibleDC(screen);
  HBITMAP bitmap = CreateDIBSection(memory, &bitmapInfo, DIB_RGB_COLORS, &pixels, nullptr, 0);
  HGDIOBJ previous = SelectObject(memory, bitmap);

  {
    Gdiplus::Bitmap canvas(width, height, width * 4, PixelFormat32bppPARGB, static_cast<BYTE *>(pixels));
    Gdiplus::Graphics graphics(&canvas);
    graphics.SetSmoothingMode(Gdiplus::SmoothingModeAntiAlias);
    graphics.SetTextRenderingHint(Gdiplus::TextRenderingHintAntiAliasGridFit);
    graphics.ScaleTransform(scale, scale);
    graphics.Clear(Gdiplus::Color(0, 0, 0, 0));

    // Notices and errors always carry a message. While recording, the message is the writing
    // style in use when it is not Neutral.
    bool const isRecordingState = m_drawnState == State::Listening || m_drawnState == State::HandsFree;
    bool const hasMessage =
        (m_drawnState == State::Notice || m_drawnState == State::Error || isRecordingState) && !m_message.empty();
    Gdiplus::Font font(g_fontFamily.get(), 13.0f, Gdiplus::FontStyleRegular, Gdiplus::UnitPixel);
    Gdiplus::RectF textBounds;
    if (hasMessage) {
      graphics.MeasureString(m_message.c_str(), -1, &font, Gdiplus::PointF(0, 0), &textBounds);
    }

    // Capsule: orb alone, or orb plus message.
    float const capsuleHeight = kOrbDiameter + 16.0f;
    float const textWidth = hasMessage ? std::min(textBounds.Width, static_cast<float>(kCanvasWidth - 120)) : 0.0f;
    float const capsuleWidth = hasMessage ? capsuleHeight + textWidth + 20.0f : capsuleHeight;
    float const capsuleX = (kCanvasWidth - capsuleWidth) / 2.0f;
    float const capsuleY = kCanvasHeight - capsuleHeight - 8.0f;
    Gdiplus::RectF capsule(capsuleX, capsuleY, capsuleWidth, capsuleHeight);

    Gdiplus::GraphicsPath capsulePath;
    AddRoundedRectangle(capsulePath, capsule, capsuleHeight / 2.0f);
    Gdiplus::SolidBrush surface(WithAlpha(kSurface, m_opacity));
    graphics.FillPath(&surface, &capsulePath);
    Gdiplus::Pen border(WithAlpha(kBorder, m_opacity), 1.0f);
    graphics.DrawPath(&border, &capsulePath);

    float const centerX = capsuleX + capsuleHeight / 2.0f;
    float const centerY = capsuleY + capsuleHeight / 2.0f;
    float const radius = kOrbDiameter / 2.0f;

    switch (m_drawnState) {
      case State::Listening:
      case State::HandsFree: {
        // Halo grows with the voice; the core breathes slightly so silence still reads as live.
        float const breathing = 0.03f * static_cast<float>(std::sin(m_phase * 3.0));
        float const coreRadius = radius * (0.62f + 0.22f * m_level + breathing);
        float const haloRadius = coreRadius + 3.0f + 9.0f * m_level;
        Gdiplus::SolidBrush halo(WithAlpha(kAccent, m_opacity * (0.18f + 0.22f * m_level)));
        graphics.FillEllipse(&halo, centerX - haloRadius, centerY - haloRadius, haloRadius * 2, haloRadius * 2);
        Gdiplus::GraphicsPath corePath;
        corePath.AddEllipse(centerX - coreRadius, centerY - coreRadius, coreRadius * 2, coreRadius * 2);
        Gdiplus::PathGradientBrush core(&corePath);
        core.SetCenterPoint(Gdiplus::PointF(centerX - coreRadius * 0.3f, centerY - coreRadius * 0.35f));
        core.SetCenterColor(WithAlpha(kAccentLight, m_opacity));
        Gdiplus::Color edge = WithAlpha(kAccent, m_opacity);
        int edgeCount = 1;
        core.SetSurroundColors(&edge, &edgeCount);
        graphics.FillPath(&core, &corePath);
        if (m_drawnState == State::HandsFree) {
          // Stop glyph: clicking the orb finishes hands-free dictation.
          Gdiplus::GraphicsPath stopPath;
          AddRoundedRectangle(stopPath, Gdiplus::RectF(centerX - 5, centerY - 5, 10, 10), 2.0f);
          Gdiplus::SolidBrush stop(WithAlpha(Gdiplus::Color(255, 255, 255, 255), m_opacity));
          graphics.FillPath(&stop, &stopPath);
        }
        break;
      }
      case State::Processing: {
        Gdiplus::SolidBrush base(WithAlpha(kNeutral, m_opacity));
        graphics.FillEllipse(&base, centerX - radius * 0.62f, centerY - radius * 0.62f, radius * 1.24f, radius * 1.24f);
        Gdiplus::Pen arc(WithAlpha(kAccent, m_opacity), 2.5f);
        arc.SetStartCap(Gdiplus::LineCapRound);
        arc.SetEndCap(Gdiplus::LineCapRound);
        float const arcRadius = radius * 0.62f;
        float const start = static_cast<float>(std::fmod(m_phase * 300.0, 360.0));
        graphics.DrawArc(&arc, centerX - arcRadius, centerY - arcRadius, arcRadius * 2, arcRadius * 2, start, 100.0f);
        break;
      }
      case State::Notice:
      case State::Error:
      case State::Hidden: {
        Gdiplus::SolidBrush dot(WithAlpha(m_drawnState == State::Error ? kError : kTextSecondary, m_opacity));
        graphics.FillEllipse(&dot, centerX - 5, centerY - 5, 10.0f, 10.0f);
        break;
      }
    }

    if (hasMessage) {
      Gdiplus::SolidBrush text(WithAlpha(isRecordingState ? kTextSecondary : kTextPrimary, m_opacity));
      Gdiplus::StringFormat format;
      format.SetLineAlignment(Gdiplus::StringAlignmentCenter);
      format.SetTrimming(Gdiplus::StringTrimmingEllipsisCharacter);
      format.SetFormatFlags(Gdiplus::StringFormatFlagsNoWrap);
      Gdiplus::RectF layout(capsuleX + capsuleHeight - 4.0f, capsuleY, textWidth + 4.0f, capsuleHeight);
      graphics.DrawString(m_message.c_str(), -1, &font, layout, &format, &text);
    }

    m_orbBounds = {
        static_cast<LONG>(capsuleX * scale),
        static_cast<LONG>(capsuleY * scale),
        static_cast<LONG>((capsuleX + capsuleWidth) * scale),
        static_cast<LONG>((capsuleY + capsuleHeight) * scale)};
  }

  POINT source{0, 0};
  SIZE size{width, height};
  BLENDFUNCTION blend{AC_SRC_OVER, 0, 255, AC_SRC_ALPHA};
  RECT windowRect;
  GetWindowRect(m_window, &windowRect);
  POINT destination{windowRect.left, windowRect.top};
  UpdateLayeredWindow(m_window, screen, &destination, &size, memory, &source, 0, &blend, ULW_ALPHA);

  SelectObject(memory, previous);
  DeleteObject(bitmap);
  DeleteDC(memory);
  ReleaseDC(nullptr, screen);

  // Static states do not need 60 fps.
  bool const isAnimating = m_state == State::Listening || m_state == State::HandsFree || m_state == State::Processing ||
      (m_opacity > 0.0f && m_opacity < 1.0f);
  if (!isAnimating) {
    KillTimer(m_window, kAnimationTimer);
  }
}

} // namespace Koto
