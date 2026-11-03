// The C# half of the Windows helper (see win-host.js). Kept in a JS file so the module's build packs it.
// C# 5 only: Windows PowerShell 5.1 compiles it with the .NET Framework compiler. No backticks or ${ here.
export const HOST_CS = String.raw`// System Tools' Windows helper. PowerShell compiles this once (cached as a DLL in %TEMP%) and keeps
// one process running; System Tools sends it one JSON request per line and reads one JSON reply per
// line. Keep it to C# 5: Windows PowerShell 5.1 compiles with the .NET Framework compiler.
using System;
using System.Collections;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.IO;
using System.Linq;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;
using System.Windows.Forms;
using Microsoft.Win32;

namespace CompanionSystemTools
{
	public static class Native
	{
		public delegate bool EnumWindowsProc(IntPtr h, IntPtr l);
		public delegate bool MonitorEnumProc(IntPtr m, IntPtr hdc, IntPtr r, IntPtr l);

		[StructLayout(LayoutKind.Sequential)]
		public struct RECT { public int Left, Top, Right, Bottom; }

		[StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
		public struct MONITORINFOEX
		{
			public int cbSize;
			public RECT rcMonitor;
			public RECT rcWork;
			public uint dwFlags;
			[MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)] public string szDevice;
		}

		[StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
		public struct DISPLAY_DEVICE
		{
			public int cb;
			[MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)] public string DeviceName;
			[MarshalAs(UnmanagedType.ByValTStr, SizeConst = 128)] public string DeviceString;
			public int StateFlags;
			[MarshalAs(UnmanagedType.ByValTStr, SizeConst = 128)] public string DeviceID;
			[MarshalAs(UnmanagedType.ByValTStr, SizeConst = 128)] public string DeviceKey;
		}

		[StructLayout(LayoutKind.Sequential)]
		public struct KEYBDINPUT { public ushort wVk; public ushort wScan; public uint dwFlags; public uint time; public IntPtr dwExtraInfo; }

		[StructLayout(LayoutKind.Sequential)]
		public struct MOUSEINPUT { public int dx; public int dy; public uint mouseData; public uint dwFlags; public uint time; public IntPtr dwExtraInfo; }

		[StructLayout(LayoutKind.Explicit)]
		public struct INPUTUNION { [FieldOffset(0)] public MOUSEINPUT mi; [FieldOffset(0)] public KEYBDINPUT ki; }

		[StructLayout(LayoutKind.Sequential)]
		public struct INPUT { public uint type; public INPUTUNION u; }

		[DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
		[DllImport("user32.dll")] public static extern bool SetProcessDpiAwarenessContext(IntPtr value);
		[DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc f, IntPtr l);
		[DllImport("user32.dll")] public static extern bool EnumDisplayMonitors(IntPtr hdc, IntPtr clip, MonitorEnumProc f, IntPtr l);
		[DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern bool GetMonitorInfo(IntPtr m, ref MONITORINFOEX info);
		[DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern bool EnumDisplayDevices(string device, uint n, ref DISPLAY_DEVICE dd, uint flags);
		[DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
		[DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
		[DllImport("user32.dll")] public static extern bool IsZoomed(IntPtr h);
		[DllImport("user32.dll")] public static extern IntPtr GetWindow(IntPtr h, uint cmd);
		[DllImport("user32.dll")] public static extern IntPtr GetAncestor(IntPtr h, uint flags);
		[DllImport("user32.dll", EntryPoint = "GetWindowLongPtrW")] public static extern IntPtr GetWindowLongPtr64(IntPtr h, int index);
		[DllImport("user32.dll", EntryPoint = "GetWindowLongW")] public static extern IntPtr GetWindowLong32(IntPtr h, int index);
		[DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, StringBuilder s, int max);
		[DllImport("user32.dll")] public static extern int GetWindowTextLength(IntPtr h);
		[DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetClassName(IntPtr h, StringBuilder s, int max);
		[DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
		[DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
		[DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr h, IntPtr after, int x, int y, int w, int hh, uint flags);
		[DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int cmd);
		[DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
		[DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
		[DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr h);
		[DllImport("user32.dll")] public static extern bool AttachThreadInput(uint a, uint b, bool attach);
		[DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();
		[DllImport("user32.dll")] public static extern uint SendInput(uint n, INPUT[] inputs, int size);
		[DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern short VkKeyScan(char c);
		[DllImport("user32.dll")] public static extern uint MapVirtualKey(uint code, uint type);
		[DllImport("user32.dll")] public static extern bool PostMessage(IntPtr h, uint msg, IntPtr w, IntPtr l);
		[DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern IntPtr SendMessageTimeout(IntPtr h, uint msg, IntPtr w, string l, uint flags, uint timeout, out IntPtr result);
		[DllImport("dwmapi.dll")] public static extern int DwmGetWindowAttribute(IntPtr h, int attr, out RECT r, int size);
		[DllImport("dwmapi.dll")] public static extern int DwmGetWindowAttribute(IntPtr h, int attr, out int v, int size);
		[DllImport("kernel32.dll")] public static extern uint SetThreadExecutionState(uint flags);
		[DllImport("kernel32.dll")] public static extern IntPtr OpenProcess(uint access, bool inherit, uint pid);
		[DllImport("kernel32.dll")] public static extern bool CloseHandle(IntPtr h);
		[DllImport("kernel32.dll", CharSet = CharSet.Unicode)] public static extern bool QueryFullProcessImageName(IntPtr p, uint flags, StringBuilder s, ref uint size);
		[DllImport("shell32.dll", CharSet = CharSet.Unicode)] public static extern IntPtr SHGetFileInfo(string path, uint attrs, ref SHFILEINFO info, uint size, uint flags);
		[DllImport("shell32.dll")] public static extern int SHGetImageList(int list, ref Guid iid, out IntPtr himl);
		[DllImport("comctl32.dll")] public static extern IntPtr ImageList_GetIcon(IntPtr himl, int i, uint flags);
		[DllImport("user32.dll")] public static extern bool DestroyIcon(IntPtr h);

		[StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
		public struct SHFILEINFO
		{
			public IntPtr hIcon;
			public int iIcon;
			public uint dwAttributes;
			[MarshalAs(UnmanagedType.ByValTStr, SizeConst = 260)] public string szDisplayName;
			[MarshalAs(UnmanagedType.ByValTStr, SizeConst = 80)] public string szTypeName;
		}
	}

	// ---------- sound (Windows Core Audio) ----------

	[ComImport, Guid("5CDF2C82-841E-4546-9722-0CF74078229A"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
	public interface IAudioEndpointVolume
	{
		// Unused slots keep the order of the real interface.
		[PreserveSig] int RegisterControlChangeNotify(IntPtr p);
		[PreserveSig] int UnregisterControlChangeNotify(IntPtr p);
		[PreserveSig] int GetChannelCount(out int n);
		[PreserveSig] int SetMasterVolumeLevel(float db, ref Guid ctx);
		[PreserveSig] int SetMasterVolumeLevelScalar(float level, ref Guid ctx);
		[PreserveSig] int GetMasterVolumeLevel(out float db);
		[PreserveSig] int GetMasterVolumeLevelScalar(out float level);
		[PreserveSig] int SetChannelVolumeLevel(uint ch, float db, ref Guid ctx);
		[PreserveSig] int SetChannelVolumeLevelScalar(uint ch, float level, ref Guid ctx);
		[PreserveSig] int GetChannelVolumeLevel(uint ch, out float db);
		[PreserveSig] int GetChannelVolumeLevelScalar(uint ch, out float level);
		[PreserveSig] int SetMute([MarshalAs(UnmanagedType.Bool)] bool mute, ref Guid ctx);
		[PreserveSig] int GetMute([MarshalAs(UnmanagedType.Bool)] out bool mute);
	}

	[ComImport, Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
	public interface IMMDevice
	{
		[PreserveSig] int Activate(ref Guid iid, int clsCtx, IntPtr p, [MarshalAs(UnmanagedType.IUnknown)] out object o);
	}

	[ComImport, Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
	public interface IMMDeviceEnumerator
	{
		[PreserveSig] int EnumAudioEndpoints(int flow, int state, out IntPtr devices);
		[PreserveSig] int GetDefaultAudioEndpoint(int flow, int role, out IMMDevice device);
	}

	[ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")]
	public class MMDeviceEnumeratorCom { }

	public static class Audio
	{
		static IAudioEndpointVolume Endpoint(bool input)
		{
			var en = (IMMDeviceEnumerator)new MMDeviceEnumeratorCom();
			IMMDevice dev;
			int hr = en.GetDefaultAudioEndpoint(input ? 1 : 0, input ? 0 : 1, out dev);
			if (hr != 0 || dev == null) throw new Exception(input ? "no microphone / input device" : "no sound output device");
			var iid = typeof(IAudioEndpointVolume).GUID;
			object o;
			Marshal.ThrowExceptionForHR(dev.Activate(ref iid, 23, IntPtr.Zero, out o));
			return (IAudioEndpointVolume)o;
		}

		static int Level(IAudioEndpointVolume v)
		{
			float f;
			Marshal.ThrowExceptionForHR(v.GetMasterVolumeLevelScalar(out f));
			return (int)Math.Round(f * 100);
		}

		public static object Read()
		{
			var r = new Dictionary<string, object>();
			try
			{
				var o = Endpoint(false);
				r["output"] = Level(o);
				bool m;
				o.GetMute(out m);
				r["muted"] = m;
			}
			catch (Exception) { r["output"] = null; r["muted"] = false; }
			try { r["input"] = Level(Endpoint(true)); } catch (Exception) { r["input"] = null; }
			return r;
		}

		public static object Set(string what, double value)
		{
			Guid ctx = Guid.Empty;
			if (what == "mute") Marshal.ThrowExceptionForHR(Endpoint(false).SetMute(value != 0, ref ctx));
			else
			{
				float level = (float)Math.Max(0, Math.Min(1, value / 100.0));
				Marshal.ThrowExceptionForHR(Endpoint(what == "input").SetMasterVolumeLevelScalar(level, ref ctx));
			}
			return Read();
		}
	}

	// ---------- screens and windows ----------

	public class Scr
	{
		public string Name;
		public Rectangle Work;
		public Rectangle Full;
		public bool Primary;
	}

	public class Proc
	{
		public string Exe = "";
		public string Name = "";
	}

	public static class Win
	{
		const uint SWP_NOZORDER = 0x4, SWP_NOACTIVATE = 0x10;
		const int SW_MAXIMIZE = 3, SW_MINIMIZE = 6, SW_RESTORE = 9;
		static readonly List<IntPtr> Hidden = new List<IntPtr>();
		static readonly Dictionary<uint, Proc> ProcCache = new Dictionary<uint, Proc>();

		static Rectangle Rect(Native.RECT r) { return Rectangle.FromLTRB(r.Left, r.Top, r.Right, r.Bottom); }

		public static List<Scr> ScreenList()
		{
			var all = new List<Scr>();
			Native.EnumDisplayMonitors(IntPtr.Zero, IntPtr.Zero, delegate (IntPtr m, IntPtr hdc, IntPtr r, IntPtr l)
			{
				var mi = new Native.MONITORINFOEX();
				mi.cbSize = Marshal.SizeOf(typeof(Native.MONITORINFOEX));
				if (Native.GetMonitorInfo(m, ref mi))
					all.Add(new Scr { Name = MonitorName(mi.szDevice, Rect(mi.rcMonitor)), Work = Rect(mi.rcWork), Full = Rect(mi.rcMonitor), Primary = (mi.dwFlags & 1) != 0 });
				return true;
			}, IntPtr.Zero);
			// Screen 1 is the main one (with the taskbar's clock); the rest left to right, like the Mac.
			var list = all.Where(s => s.Primary).ToList();
			list.AddRange(all.Where(s => !s.Primary).OrderBy(s => s.Full.X).ThenBy(s => s.Full.Y));
			return list;
		}

		static string MonitorName(string device, Rectangle full)
		{
			var size = full.Width + "×" + full.Height;
			try
			{
				var dd = new Native.DISPLAY_DEVICE();
				dd.cb = Marshal.SizeOf(typeof(Native.DISPLAY_DEVICE));
				if (Native.EnumDisplayDevices(device, 0, ref dd, 0) && !string.IsNullOrEmpty(dd.DeviceString) && dd.DeviceString.IndexOf("Generic", StringComparison.OrdinalIgnoreCase) < 0)
					return dd.DeviceString + " " + size;
			}
			catch (Exception) { }
			return "Display " + size;
		}

		public static object Screens()
		{
			return ScreenList().Select(s => (object)new Dictionary<string, object> {
				{ "name", s.Name }, { "x", s.Work.X }, { "y", s.Work.Y }, { "w", s.Work.Width }, { "h", s.Work.Height },
				{ "full", new Dictionary<string, object> { { "x", s.Full.X }, { "y", s.Full.Y }, { "w", s.Full.Width }, { "h", s.Full.Height } } },
			}).ToList();
		}

		static string Text(IntPtr h)
		{
			var sb = new StringBuilder(512);
			Native.GetWindowText(h, sb, sb.Capacity);
			return sb.ToString();
		}

		static string ClassOf(IntPtr h)
		{
			var sb = new StringBuilder(256);
			Native.GetClassName(h, sb, sb.Capacity);
			return sb.ToString();
		}

		static long ExStyle(IntPtr h)
		{
			return (IntPtr.Size == 8 ? Native.GetWindowLongPtr64(h, -20) : Native.GetWindowLong32(h, -20)).ToInt64();
		}

		/** A window someone would call an app window: visible, not a tool window, not owned, not hidden by Windows (cloaked). */
		public static bool Usable(IntPtr h)
		{
			if (!Native.IsWindowVisible(h) || Native.GetWindow(h, 4) != IntPtr.Zero) return false;
			if ((ExStyle(h) & 0x80) != 0) return false;
			int cloaked;
			if (Native.DwmGetWindowAttribute(h, 14, out cloaked, 4) == 0 && cloaked != 0) return false;
			if (Native.GetWindowTextLength(h) == 0) return false;
			var c = ClassOf(h);
			return c != "Progman" && c != "WorkerW" && c != "Shell_TrayWnd" && c != "Shell_SecondaryTrayWnd";
		}

		public static Proc ProcOf(IntPtr h)
		{
			uint pid;
			Native.GetWindowThreadProcessId(h, out pid);
			Proc p;
			if (ProcCache.TryGetValue(pid, out p)) return p;
			p = new Proc();
			var hp = Native.OpenProcess(0x1000, false, pid);
			if (hp != IntPtr.Zero)
			{
				var sb = new StringBuilder(1024);
				uint n = (uint)sb.Capacity;
				if (Native.QueryFullProcessImageName(hp, 0, sb, ref n))
				{
					var full = sb.ToString();
					p.Exe = Path.GetFileName(full).ToLowerInvariant();
					try { p.Name = FileVersionInfo.GetVersionInfo(full).FileDescription ?? ""; } catch (Exception) { }
				}
				Native.CloseHandle(hp);
			}
			if (p.Name.Trim() == "") p.Name = Path.GetFileNameWithoutExtension(p.Exe);
			if (ProcCache.Count > 500) ProcCache.Clear();
			ProcCache[pid] = p;
			return p;
		}

		public static List<IntPtr> TopWindows()
		{
			var list = new List<IntPtr>();
			Native.EnumWindows(delegate (IntPtr h, IntPtr l) { if (Usable(h)) list.Add(h); return true; }, IntPtr.Zero);
			return list;
		}

		static string Norm(string s) { return (s ?? "").ToLowerInvariant().Replace(" ", "").Replace(".exe", ""); }

		/** The app's windows, front to back: by program file, then by app name, then (Store apps) by title. */
		public static List<IntPtr> WindowsOf(Dictionary<string, object> it)
		{
			string exe = Host.Str(it, "exe").ToLowerInvariant();
			string path = Host.Str(it, "path");
			string app = Host.Str(it, "app");
			if (exe == "" && path.EndsWith(".exe", StringComparison.OrdinalIgnoreCase)) exe = Path.GetFileName(path).ToLowerInvariant();
			var all = TopWindows();
			if (exe != "") return all.Where(h => ProcOf(h).Exe == exe).ToList();
			if (app == "") return new List<IntPtr>();
			var a = Norm(app);
			var byProc = all.Where(h => { var p = ProcOf(h); return Norm(p.Exe) == a || Norm(p.Name) == a; }).ToList();
			if (byProc.Count > 0) return byProc;
			return all.Where(h => { var t = Text(h); return t.Equals(app, StringComparison.OrdinalIgnoreCase) || t.EndsWith(" - " + app, StringComparison.OrdinalIgnoreCase); }).ToList();
		}

		static bool IsFront(Dictionary<string, object> it)
		{
			return Host.Str(it, "app") == "" && Host.Str(it, "exe") == "" && Host.Str(it, "path") == "";
		}

		static IntPtr FrontWindow()
		{
			var h = Native.GetAncestor(Native.GetForegroundWindow(), 2);
			return h != IntPtr.Zero && Usable(h) ? h : IntPtr.Zero;
		}

		static void Launch(Dictionary<string, object> it)
		{
			string path = Host.Str(it, "path"), exe = Host.Str(it, "exe"), app = Host.Str(it, "app");
			var target = path != "" ? path : exe != "" ? exe : app;
			Process.Start(new ProcessStartInfo(target) { UseShellExecute = true });
		}

		static IntPtr Find(Dictionary<string, object> it, int waitSeconds)
		{
			if (IsFront(it)) return FrontWindow();
			for (int t = 0; ; t++)
			{
				var list = WindowsOf(it);
				string title = Host.Str(it, "title");
				if (title != "")
				{
					var named = list.FirstOrDefault(h => Text(h) == title);
					if (named != IntPtr.Zero) return named;
				}
				if (it.ContainsKey("index") && it["index"] != null)
				{
					int i = Host.Int(it, "index");
					if (i >= 0 && i < list.Count) return list[i];
				}
				if (list.Count > 0) return list[0];
				if (t >= waitSeconds * 4) return IntPtr.Zero;
				Thread.Sleep(250);
			}
		}

		static string NameOf(IntPtr h, Dictionary<string, object> it)
		{
			var app = Host.Str(it, "app");
			return h == IntPtr.Zero ? (app == "" ? "front window" : app) : ProcOf(h).Name;
		}

		/** Where the window shows on screen (Windows 10/11 windows have invisible borders outside this). */
		public static Rectangle Visible(IntPtr h)
		{
			Native.RECT f;
			if (Native.DwmGetWindowAttribute(h, 9, out f, Marshal.SizeOf(typeof(Native.RECT))) == 0) return Rect(f);
			Native.RECT r;
			Native.GetWindowRect(h, out r);
			return Rect(r);
		}

		static void SetVisible(IntPtr h, Rectangle t)
		{
			Native.RECT r;
			Native.GetWindowRect(h, out r);
			var v = Visible(h);
			int l = v.Left - r.Left, top = v.Top - r.Top, rr = r.Right - v.Right, b = r.Bottom - v.Bottom;
			Native.SetWindowPos(h, IntPtr.Zero, t.X - l, t.Y - top, t.Width + l + rr, t.Height + top + b, SWP_NOZORDER | SWP_NOACTIVATE);
		}

		static int ScreenIndexOf(Rectangle r, List<Scr> list)
		{
			var c = new Point(r.X + r.Width / 2, r.Y + r.Height / 2);
			for (int i = 0; i < list.Count; i++) if (list[i].Full.Contains(c)) return i;
			return 0;
		}

		static Rectangle TargetRect(Dictionary<string, object> it, Rectangle cur, List<Scr> list, out bool max)
		{
			max = false;
			int here = ScreenIndexOf(cur, list);
			int idx = here;
			object screen = it.ContainsKey("screen") ? it["screen"] : "same";
			if ("next".Equals(screen)) idx = (here + 1) % list.Count;
			else if ("previous".Equals(screen)) idx = (here - 1 + list.Count) % list.Count;
			else if (screen is int || screen is decimal || screen is double || screen is long) idx = Convert.ToInt32(screen) - 1;
			if (idx < 0 || idx >= list.Count) throw new Exception("there is no screen " + (idx + 1) + " (" + list.Count + " connected)");
			var s = list[idx].Work;
			object rect = it.ContainsKey("rect") ? it["rect"] : null;
			if ("centre".Equals(rect))
			{
				int w = Math.Min(cur.Width, s.Width), hh = Math.Min(cur.Height, s.Height);
				return new Rectangle(s.X + (s.Width - w) / 2, s.Y + (s.Height - hh) / 2, w, hh);
			}
			if ("keep".Equals(rect) || rect == null)
			{
				var from = list[here].Work;
				int w = Math.Min(cur.Width, s.Width), hh = Math.Min(cur.Height, s.Height);
				double fx = from.Width > cur.Width ? (double)(cur.X - from.X) / (from.Width - cur.Width) : 0;
				double fy = from.Height > cur.Height ? (double)(cur.Y - from.Y) / (from.Height - cur.Height) : 0;
				fx = Math.Max(0, Math.Min(1, fx));
				fy = Math.Max(0, Math.Min(1, fy));
				return new Rectangle(s.X + (int)Math.Round(fx * (s.Width - w)), s.Y + (int)Math.Round(fy * (s.Height - hh)), w, hh);
			}
			var d = (Dictionary<string, object>)rect;
			double x = Host.Num(d, "x"), y = Host.Num(d, "y"), rw = Host.Num(d, "w"), rh = Host.Num(d, "h");
			// "Fill the screen" maximises, the Windows way (snap and the title bar's button agree with it).
			max = x == 0 && y == 0 && rw == 1 && rh == 1;
			return new Rectangle(s.X + (int)Math.Round(x * s.Width), s.Y + (int)Math.Round(y * s.Height), (int)Math.Round(rw * s.Width), (int)Math.Round(rh * s.Height));
		}

		public static void Raise(IntPtr h)
		{
			if (Native.IsIconic(h)) Native.ShowWindow(h, SW_RESTORE);
			uint pid;
			uint fg = Native.GetWindowThreadProcessId(Native.GetForegroundWindow(), out pid);
			uint me = Native.GetCurrentThreadId();
			bool attached = fg != 0 && fg != me && Native.AttachThreadInput(me, fg, true);
			Native.BringWindowToTop(h);
			Native.SetForegroundWindow(h);
			if (attached) Native.AttachThreadInput(me, fg, false);
		}

		static Dictionary<string, object> Result(string app, Rectangle r)
		{
			return new Dictionary<string, object> { { "app", app }, { "ok", true }, { "x", r.X }, { "y", r.Y }, { "w", r.Width }, { "h", r.Height } };
		}

		static Dictionary<string, object> Error(string app, string why)
		{
			return new Dictionary<string, object> { { "app", app }, { "error", why } };
		}

		public static object Place(Dictionary<string, object> it, List<Scr> list)
		{
			bool launch = Host.Bool(it, "launch");
			var h = Find(it, 0);
			if (h == IntPtr.Zero && launch && !IsFront(it))
			{
				Launch(it);
				h = Find(it, 15);
			}
			if (h == IntPtr.Zero) return Error(NameOf(h, it), IsFront(it) ? "no window in front" : launch ? "no window to move" : "not open");
			string name = NameOf(h, it);
			if (Native.IsIconic(h) || Native.IsZoomed(h)) Native.ShowWindow(h, SW_RESTORE);
			var cur = Visible(h);
			bool max;
			Rectangle t;
			var abs = it.ContainsKey("abs") ? it["abs"] as Dictionary<string, object> : null;
			if (abs != null)
			{
				t = new Rectangle(Host.Int(abs, "x"), Host.Int(abs, "y"), Host.Int(abs, "w"), Host.Int(abs, "h"));
				max = Host.Bool(abs, "max");
			}
			else t = TargetRect(it, cur, list, out max);
			// Twice: moving to a screen with different scaling can resize the window after the first move.
			SetVisible(h, t);
			SetVisible(h, t);
			if (max) Native.ShowWindow(h, SW_MAXIMIZE);
			if (Host.Bool(it, "raise")) Raise(h);
			return Result(name, t);
		}

		public static object Capture()
		{
			var apps = new List<object>();
			var byExe = new Dictionary<string, Dictionary<string, object>>();
			var counts = new Dictionary<string, int>();
			foreach (var h in TopWindows())
			{
				var p = ProcOf(h);
				if (p.Exe == "" || (p.Exe == "explorer.exe" && ClassOf(h) != "CabinetWClass")) continue;
				int index = counts.ContainsKey(p.Exe) ? counts[p.Exe] : 0;
				counts[p.Exe] = index + 1;
				if (Native.IsIconic(h)) continue;
				Dictionary<string, object> a;
				if (!byExe.TryGetValue(p.Exe, out a))
				{
					a = new Dictionary<string, object> { { "app", p.Name }, { "exe", p.Exe }, { "windows", new List<object>() } };
					byExe[p.Exe] = a;
					apps.Add(a);
				}
				var ws = (List<object>)a["windows"];
				if (ws.Count >= 4) continue;
				var max = Native.IsZoomed(h);
				var v = Visible(h);
				ws.Add(new Dictionary<string, object> { { "title", Text(h) }, { "index", index }, { "x", v.X }, { "y", v.Y }, { "w", v.Width }, { "h", v.Height }, { "max", max } });
			}
			return apps;
		}

		public static object Minimise(Dictionary<string, object> it, bool all)
		{
			var list = IsFront(it) ? new List<IntPtr> { FrontWindow() } : WindowsOf(it);
			list = list.Where(h => h != IntPtr.Zero).ToList();
			foreach (var h in all ? list : list.Take(1)) Native.ShowWindow(h, SW_MINIMIZE);
			return new Dictionary<string, object> { { "ok", list.Count > 0 } };
		}

		/** Minimises every other app's windows and remembers them, so "show all" brings back just those. */
		public static object HideOthers(Dictionary<string, object> it)
		{
			var keep = IsFront(it) ? FrontWindow() : WindowsOf(it).FirstOrDefault();
			string keepExe = keep != IntPtr.Zero ? ProcOf(keep).Exe : "";
			foreach (var h in TopWindows())
			{
				if (Native.IsIconic(h) || ProcOf(h).Exe == keepExe) continue;
				Native.ShowWindow(h, SW_MINIMIZE);
				if (!Hidden.Contains(h)) Hidden.Add(h);
			}
			if (keep != IntPtr.Zero) Raise(keep);
			return new Dictionary<string, object> { { "ok", true } };
		}

		public static object ShowAll()
		{
			foreach (var h in Hidden) if (Native.IsIconic(h)) Native.ShowWindow(h, SW_RESTORE);
			Hidden.Clear();
			return new Dictionary<string, object> { { "ok", true } };
		}

		public static object Focus(Dictionary<string, object> it)
		{
			var h = Find(it, 0);
			if (h != IntPtr.Zero) Raise(h);
			return h != IntPtr.Zero;
		}
	}

	// ---------- keys and text ----------

	public static class Input
	{
		const uint KEYUP = 0x2, UNICODE = 0x4, EXTENDED = 0x1;
		static readonly HashSet<ushort> Extended = new HashSet<ushort> { 0x21, 0x22, 0x23, 0x24, 0x25, 0x26, 0x27, 0x28, 0x2D, 0x2E, 0x5B, 0x5C };

		static Native.INPUT Key(ushort vk, bool up)
		{
			var i = new Native.INPUT();
			i.type = 1;
			i.u.ki.wVk = vk;
			i.u.ki.wScan = (ushort)Native.MapVirtualKey(vk, 0);
			i.u.ki.dwFlags = (up ? KEYUP : 0) | (Extended.Contains(vk) ? EXTENDED : 0);
			return i;
		}

		static void Send(List<Native.INPUT> list)
		{
			if (list.Count == 0) return;
			uint sent = Native.SendInput((uint)list.Count, list.ToArray(), Marshal.SizeOf(typeof(Native.INPUT)));
			if (sent != list.Count) throw new Exception("Windows blocked the key presses (an app running as administrator is in front?)");
		}

		/**
		 * One shortcut: modifier virtual-key codes held while the key is pressed. The key is a virtual-key
		 * code, or a character looked up on this keyboard layout (adding Shift when the layout needs it).
		 */
		public static object Press(int vk, string ch, IList mods)
		{
			var held = mods.Cast<object>().Select(m => (ushort)Convert.ToInt32(m)).ToList();
			if (!string.IsNullOrEmpty(ch))
			{
				short r = Native.VkKeyScan(ch[0]);
				if (r == -1) throw new Exception("this keyboard layout has no key for \"" + ch + "\"");
				vk = r & 0xff;
				if ((r & 0x100) != 0 && !held.Contains(0x10)) held.Add(0x10);
			}
			var list = new List<Native.INPUT>();
			foreach (var m in held) list.Add(Key(m, false));
			list.Add(Key((ushort)vk, false));
			list.Add(Key((ushort)vk, true));
			for (int i = held.Count - 1; i >= 0; i--) list.Add(Key(held[i], true));
			Send(list);
			return true;
		}

		/** Types text as Unicode characters, so it comes out the same whatever the keyboard layout. */
		public static object TypeText(string text)
		{
			var list = new List<Native.INPUT>();
			foreach (char ch in text.Replace("\r\n", "\n"))
			{
				if (ch == '\n')
				{
					list.Add(Key(0x0D, false));
					list.Add(Key(0x0D, true));
					continue;
				}
				foreach (var up in new[] { false, true })
				{
					var i = new Native.INPUT();
					i.type = 1;
					i.u.ki.wScan = ch;
					i.u.ki.dwFlags = UNICODE | (up ? KEYUP : 0);
					list.Add(i);
				}
			}
			Send(list);
			return true;
		}

		/** Puts text on the clipboard, presses Ctrl+V, and optionally puts the old text back. */
		public static object Paste(string text, bool restore)
		{
			string before = null;
			if (restore) try { if (Clipboard.ContainsText()) before = Clipboard.GetText(); } catch (Exception) { }
			Clipboard.SetText(text);
			Press(0x56, null, new object[] { 0x11 });
			if (before != null)
			{
				Thread.Sleep(500);
				try { Clipboard.SetText(before); } catch (Exception) { }
			}
			return true;
		}
	}

	// ---------- system ----------

	public static class Sys
	{
		static uint awake = 0x80000000;

		/** Keeps Windows (and optionally the displays) awake while this helper runs. */
		public static object KeepAwake(bool on, bool displays)
		{
			awake = 0x80000000u | (on ? 1u | (displays ? 2u : 0u) : 0u);
			Native.SetThreadExecutionState(awake);
			return on;
		}

		public static object DisplaySleep()
		{
			Native.PostMessage(new IntPtr(0xffff), 0x112, new IntPtr(0xF170), new IntPtr(2));
			return true;
		}

		public static object ScreenSaver()
		{
			string scr = null;
			try { scr = Registry.GetValue(@"HKEY_CURRENT_USER\Control Panel\Desktop", "SCRNSAVE.EXE", null) as string; } catch (Exception) { }
			if (string.IsNullOrEmpty(scr) || !File.Exists(scr)) scr = Path.Combine(Environment.SystemDirectory, "scrnsave.scr");
			Process.Start(new ProcessStartInfo(scr, "/s") { UseShellExecute = false });
			return true;
		}

		const string Themes = @"HKEY_CURRENT_USER\Software\Microsoft\Windows\CurrentVersion\Themes\Personalize";

		public static bool IsDark()
		{
			var v = Registry.GetValue(Themes, "AppsUseLightTheme", 1);
			return v is int && (int)v == 0;
		}

		public static object SetDark(string mode)
		{
			bool dark = mode == "on" ? true : mode == "off" ? false : !IsDark();
			Registry.SetValue(Themes, "AppsUseLightTheme", dark ? 0 : 1, RegistryValueKind.DWord);
			Registry.SetValue(Themes, "SystemUsesLightTheme", dark ? 0 : 1, RegistryValueKind.DWord);
			IntPtr res;
			Native.SendMessageTimeout(new IntPtr(0xffff), 0x1A, IntPtr.Zero, "ImmersiveColorSet", 2, 200, out res);
			return dark;
		}

		public static object State()
		{
			var r = new Dictionary<string, object>();
			r["dark"] = IsDark();
			var ps = SystemInformation.PowerStatus;
			if ((ps.BatteryChargeStatus & BatteryChargeStatus.NoSystemBattery) == 0 && ps.BatteryChargeStatus != BatteryChargeStatus.Unknown)
			{
				r["battery"] = (int)Math.Round(ps.BatteryLifePercent * 100);
				r["charging"] = ps.PowerLineStatus == PowerLineStatus.Online;
			}
			return r;
		}

		static object Call(object o, string method, params object[] args)
		{
			return o.GetType().InvokeMember(method, BindingFlags.InvokeMethod, null, o, args);
		}

		/** Ejects USB sticks and SD cards (drives Windows calls removable), the way Explorer's Eject does. */
		public static object Eject()
		{
			var drives = DriveInfo.GetDrives().Where(d => d.DriveType == DriveType.Removable && d.IsReady).Select(d => d.Name).ToList();
			if (drives.Count == 0) return new Dictionary<string, object> { { "ejected", 0 }, { "left", new List<object>() } };
			var shell = Activator.CreateInstance(Type.GetTypeFromProgID("Shell.Application"));
			var computer = Call(shell, "NameSpace", 17);
			foreach (var d in drives)
			{
				try
				{
					var item = Call(computer, "ParseName", d);
					if (item != null) Call(item, "InvokeVerb", "Eject");
				}
				catch (Exception) { }
			}
			Thread.Sleep(1500);
			var left = DriveInfo.GetDrives().Where(d => d.DriveType == DriveType.Removable && d.IsReady).Select(d => (object)d.Name).ToList();
			return new Dictionary<string, object> { { "ejected", drives.Count - left.Count }, { "left", left } };
		}
	}

	// ---------- taskbar ----------

	public static class Taskbar
	{
		static object Call(object o, string member, BindingFlags how, params object[] args)
		{
			return o.GetType().InvokeMember(member, how, null, o, args);
		}

		/** Apps pinned to the taskbar, in taskbar order: [{ name, path (the .lnk), target }]. */
		public static object Pinned()
		{
			var outp = new List<object>();
			var dir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), @"Microsoft\Internet Explorer\Quick Launch\User Pinned\TaskBar");
			if (!Directory.Exists(dir)) return outp;
			// The order lives in the registry as a binary list that holds each shortcut's file name.
			string even = "", odd = "";
			try
			{
				var b = Registry.GetValue(@"HKEY_CURRENT_USER\Software\Microsoft\Windows\CurrentVersion\Explorer\Taskband", "Favorites", null) as byte[];
				if (b != null && b.Length > 1)
				{
					even = Encoding.Unicode.GetString(b);
					odd = Encoding.Unicode.GetString(b, 1, b.Length - 1);
				}
			}
			catch (Exception) { }
			object shell = null;
			try { shell = Activator.CreateInstance(Type.GetTypeFromProgID("WScript.Shell")); } catch (Exception) { }
			var files = Directory.GetFiles(dir, "*.lnk").Select(f =>
			{
				var n = Path.GetFileName(f);
				int a = even.IndexOf(n, StringComparison.OrdinalIgnoreCase), c = odd.IndexOf(n, StringComparison.OrdinalIgnoreCase);
				int at = a >= 0 ? a * 2 : c >= 0 ? c * 2 + 1 : int.MaxValue;
				return new { f, at };
			}).OrderBy(x => x.at).ThenBy(x => x.f, StringComparer.OrdinalIgnoreCase);
			foreach (var x in files)
			{
				string target = "";
				try
				{
					var sc = Call(shell, "CreateShortcut", BindingFlags.InvokeMethod, x.f);
					target = Convert.ToString(Call(sc, "TargetPath", BindingFlags.GetProperty));
				}
				catch (Exception) { }
				outp.Add(new Dictionary<string, object> { { "name", Path.GetFileNameWithoutExtension(x.f) }, { "path", x.f }, { "target", target } });
			}
			return outp;
		}
	}

	// ---------- app icons ----------

	public static class Icons
	{
		/** The app's biggest icon (256 px where it has one), centred in the top ~70% of a size×size PNG. */
		public static object Draw(IList items, int size)
		{
			var out_ = new List<object>();
			var iid = new Guid("46EB5926-582E-4017-9FDF-E8998DAA0950");
			IntPtr jumbo;
			Native.SHGetImageList(4, ref iid, out jumbo);
			foreach (var o in items)
			{
				var it = (Dictionary<string, object>)o;
				string path = Host.Str(it, "path"), dest = Host.Str(it, "out");
				try
				{
					var info = new Native.SHFILEINFO();
					Native.SHGetFileInfo(path, 0, ref info, (uint)Marshal.SizeOf(info), 0x4000);
					IntPtr hicon = jumbo != IntPtr.Zero ? Native.ImageList_GetIcon(jumbo, info.iIcon, 1) : IntPtr.Zero;
					if (hicon == IntPtr.Zero) throw new Exception("no icon");
					using (var icon = Icon.FromHandle(hicon))
					using (var src = icon.ToBitmap())
					using (var canvas = new Bitmap(size, size, PixelFormat.Format32bppArgb))
					using (var g = Graphics.FromImage(canvas))
					{
						// Small icons sit in the corner of the 256 px image: draw just the part that's there.
						var b = Bounds(src);
						int s = (int)Math.Round(size * 0.7);
						g.InterpolationMode = InterpolationMode.HighQualityBicubic;
						g.PixelOffsetMode = PixelOffsetMode.HighQuality;
						g.DrawImage(src, new Rectangle((size - s) / 2, (int)Math.Round(size * 0.04), s, s), b, GraphicsUnit.Pixel);
						canvas.Save(dest, ImageFormat.Png);
					}
					Native.DestroyIcon(hicon);
					out_.Add(new Dictionary<string, object> { { "path", path }, { "ok", true } });
				}
				catch (Exception e)
				{
					out_.Add(new Dictionary<string, object> { { "path", path }, { "error", e.Message } });
				}
			}
			return out_;
		}

		static Rectangle Bounds(Bitmap b)
		{
			int minX = b.Width, minY = b.Height, maxX = -1, maxY = -1;
			for (int y = 0; y < b.Height; y++)
				for (int x = 0; x < b.Width; x++)
					if (b.GetPixel(x, y).A > 8)
					{
						if (x < minX) minX = x;
						if (y < minY) minY = y;
						if (x > maxX) maxX = x;
						if (y > maxY) maxY = y;
					}
			if (maxX < 0) return new Rectangle(0, 0, b.Width, b.Height);
			int side = Math.Max(maxX - minX + 1, maxY - minY + 1);
			// keep it square, centred on what's drawn
			int cx = (minX + maxX + 1) / 2, cy = (minY + maxY + 1) / 2;
			return new Rectangle(cx - side / 2, cy - side / 2, side, side);
		}
	}

	// ---------- requests ----------

	public static class Host
	{
		static readonly JavaScriptSerializer Json = new JavaScriptSerializer { MaxJsonLength = int.MaxValue };

		public static void Init()
		{
			// Real pixels on every screen, whatever its scaling, so window positions match what's drawn.
			try { if (Native.SetProcessDpiAwarenessContext(new IntPtr(-4))) return; } catch (Exception) { }
			try { Native.SetProcessDPIAware(); } catch (Exception) { }
		}

		public static string Str(Dictionary<string, object> d, string k)
		{
			object v;
			return d != null && d.TryGetValue(k, out v) && v != null ? Convert.ToString(v) : "";
		}

		public static double Num(Dictionary<string, object> d, string k)
		{
			object v;
			return d != null && d.TryGetValue(k, out v) && v != null ? Convert.ToDouble(v) : 0;
		}

		public static int Int(Dictionary<string, object> d, string k) { return (int)Math.Round(Num(d, k)); }

		public static bool Bool(Dictionary<string, object> d, string k)
		{
			object v;
			return d != null && d.TryGetValue(k, out v) && v is bool && (bool)v;
		}

		static Dictionary<string, object> Item(Dictionary<string, object> r)
		{
			return r.ContainsKey("item") ? r["item"] as Dictionary<string, object> ?? new Dictionary<string, object>() : new Dictionary<string, object>();
		}

		static object Dispatch(Dictionary<string, object> r)
		{
			switch (Str(r, "cmd"))
			{
				case "ping": return "pong";
				case "screens": return Win.Screens();
				case "place":
					{
						var list = Win.ScreenList();
						if (list.Count == 0) throw new Exception("no screens connected");
						var results = new List<object>();
						foreach (var o in (IEnumerable)r["items"])
						{
							var it = (Dictionary<string, object>)o;
							try { results.Add(Win.Place(it, list)); }
							catch (Exception e) { var a = Str(it, "app"); results.Add(new Dictionary<string, object> { { "app", a == "" ? "front window" : a }, { "error", e.Message } }); }
						}
						return results;
					}
				case "capture": return Win.Capture();
				case "minimise": return Win.Minimise(Item(r), false);
				case "hide": return Win.Minimise(Item(r), true);
				case "hide_others": return Win.HideOthers(Item(r));
				case "show_all": return Win.ShowAll();
				case "focus": return Win.Focus(Item(r));
				case "sound": return Audio.Read();
				case "sound_set": return Audio.Set(Str(r, "what"), Num(r, "value"));
				case "keys": return Input.Press(Int(r, "vk"), Str(r, "char"), (IList)(r.ContainsKey("mods") ? r["mods"] : new object[0]));
				case "type": return Input.TypeText(Str(r, "text"));
				case "paste": return Input.Paste(Str(r, "text"), Bool(r, "restore"));
				case "keep_awake": return Sys.KeepAwake(Bool(r, "on"), Bool(r, "displays"));
				case "display_sleep": return Sys.DisplaySleep();
				case "screen_saver": return Sys.ScreenSaver();
				case "dark_mode": return Sys.SetDark(Str(r, "mode"));
				case "state": return Sys.State();
				case "eject": return Sys.Eject();
				case "taskbar": return Taskbar.Pinned();
				case "icons": return Icons.Draw((IList)r["items"], Int(r, "size"));
				default: throw new Exception("unknown command " + Str(r, "cmd"));
			}
		}

		public static string Handle(string line)
		{
			object id = null;
			try
			{
				var req = (Dictionary<string, object>)Json.DeserializeObject(line);
				req.TryGetValue("id", out id);
				return Json.Serialize(new Dictionary<string, object> { { "id", id }, { "result", Dispatch(req) } });
			}
			catch (Exception e)
			{
				return Json.Serialize(new Dictionary<string, object> { { "id", id }, { "error", e.Message } });
			}
		}
	}
}
`
