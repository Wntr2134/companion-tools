// Universal Capture's shortcuts on Windows (Ctrl+number), from one always-on helper (win-helper.js):
// a press takes milliseconds instead of starting PowerShell and compiling each time. It can bring
// Universal Capture to the front first and put the presenter's window back afterwards.
// No Companion dependency, so it can be tested on its own.
import { WinHelper } from './win-helper.js'

/** C# 5: Windows PowerShell 5.1 compiles it. */
export const UC_CS = String.raw`
using System;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

namespace CompanionEcho
{
	public static class Keys
	{
		delegate bool EnumProc(IntPtr h, IntPtr l);
		[StructLayout(LayoutKind.Sequential)] struct KEYBDINPUT { public ushort wVk; public ushort wScan; public uint dwFlags; public uint time; public IntPtr dwExtraInfo; }
		[StructLayout(LayoutKind.Sequential)] struct MOUSEINPUT { public int dx; public int dy; public uint mouseData; public uint dwFlags; public uint time; public IntPtr dwExtraInfo; }
		[StructLayout(LayoutKind.Explicit)] struct UNION { [FieldOffset(0)] public MOUSEINPUT mi; [FieldOffset(0)] public KEYBDINPUT ki; }
		[StructLayout(LayoutKind.Sequential)] struct INPUT { public uint type; public UNION u; }

		[DllImport("user32.dll")] static extern bool EnumWindows(EnumProc f, IntPtr l);
		[DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
		[DllImport("user32.dll")] static extern bool IsIconic(IntPtr h);
		[DllImport("user32.dll")] static extern bool ShowWindow(IntPtr h, int cmd);
		[DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowText(IntPtr h, StringBuilder s, int max);
		[DllImport("user32.dll")] static extern int GetWindowTextLength(IntPtr h);
		[DllImport("user32.dll")] static extern IntPtr GetWindow(IntPtr h, uint cmd);
		[DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
		[DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
		[DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr h);
		[DllImport("user32.dll")] static extern bool BringWindowToTop(IntPtr h);
		[DllImport("user32.dll")] static extern bool AttachThreadInput(uint a, uint b, bool attach);
		[DllImport("kernel32.dll")] static extern uint GetCurrentThreadId();
		[DllImport("user32.dll")] static extern uint SendInput(uint n, INPUT[] inputs, int size);
		[DllImport("user32.dll")] static extern uint MapVirtualKey(uint code, uint type);

		static string ProcName(IntPtr h)
		{
			uint pid;
			GetWindowThreadProcessId(h, out pid);
			try { return Process.GetProcessById((int)pid).ProcessName; } catch (Exception) { return ""; }
		}

		/** Universal Capture's main window: title or program name contains the app name (spaces ignored for the program). */
		static IntPtr FindApp(string app)
		{
			string name = app.ToLowerInvariant(), compact = name.Replace(" ", "");
			IntPtr found = IntPtr.Zero;
			EnumWindows(delegate (IntPtr h, IntPtr l)
			{
				if (!IsWindowVisible(h) || GetWindow(h, 4) != IntPtr.Zero || GetWindowTextLength(h) == 0) return true;
				var sb = new StringBuilder(512);
				GetWindowText(h, sb, sb.Capacity);
				if (sb.ToString().ToLowerInvariant().Contains(name) || ProcName(h).ToLowerInvariant().Contains(compact)) { found = h; return false; }
				return true;
			}, IntPtr.Zero);
			return found;
		}

		static void Front(IntPtr h)
		{
			if (IsIconic(h)) ShowWindow(h, 9);
			uint pid;
			uint fg = GetWindowThreadProcessId(GetForegroundWindow(), out pid), me = GetCurrentThreadId();
			bool attached = fg != 0 && fg != me && AttachThreadInput(me, fg, true);
			BringWindowToTop(h);
			SetForegroundWindow(h);
			if (attached) AttachThreadInput(me, fg, false);
		}

		static INPUT Key(ushort vk, bool up)
		{
			var i = new INPUT();
			i.type = 1;
			i.u.ki.wVk = vk;
			i.u.ki.wScan = (ushort)MapVirtualKey(vk, 0);
			i.u.ki.dwFlags = up ? 2u : 0u;
			return i;
		}

		/** Ctrl + one digit. "OK", or "ERR:not-running" when it was to go to Universal Capture and there's no window. */
		public static string Send(string digit, string app, bool activate, bool returnFocus)
		{
			if (digit == null || digit.Length != 1 || digit[0] < '0' || digit[0] > '9') throw new Exception("unexpected key " + digit);
			var prev = GetForegroundWindow();
			IntPtr target = IntPtr.Zero;
			if (activate)
			{
				target = FindApp(string.IsNullOrEmpty(app) ? "Universal Capture" : app);
				if (target == IntPtr.Zero) return "ERR:not-running";
				Front(target);
				Thread.Sleep(300);
			}
			ushort vk = (ushort)digit[0];
			var keys = new[] { Key(0x11, false), Key(vk, false), Key(vk, true), Key(0x11, true) };
			if (SendInput((uint)keys.Length, keys, Marshal.SizeOf(typeof(INPUT))) != keys.Length) throw new Exception("Windows blocked the key presses (is an app running as administrator in front?)");
			if (activate && returnFocus && prev != IntPtr.Zero && prev != target)
			{
				Thread.Sleep(150);
				Front(prev);
			}
			return "OK";
		}
	}
}
`

export const UC_SCRIPT = String.raw`
function Invoke-Request($line) {
  $id = $null
  try {
    $r = $line | ConvertFrom-Json
    $id = $r.id
    $result = switch ($r.cmd) {
      'ping' { 'pong' }
      'shortcut' { [CompanionEcho.Keys]::Send([string]$r.key, [string]$r.app, [bool]$r.activate, [bool]$r.returnFocus) }
      default { throw "unknown request $($r.cmd)" }
    }
    @{ id = $id; result = $result } | ConvertTo-Json -Compress
  } catch {
    @{ id = $id; error = $_.Exception.Message } | ConvertTo-Json -Compress
  }
}
`

export class UcHelper extends WinHelper {
	constructor(opts = {}) {
		super({ name: 'echo360', cs: UC_CS, script: UC_SCRIPT, ...opts })
	}
}
