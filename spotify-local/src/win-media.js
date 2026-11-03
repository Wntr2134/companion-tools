// Spotify on Windows, through Windows' own media controls (the panel above the volume pop-up) and
// Spotify's own volume in the Volume Mixer. Runs in one always-on PowerShell helper (win-helper.js),
// so presses are instant and go to Spotify only (not whichever app has the media keys).
// No Companion dependency, so it can be tested on its own.
import { WinHelper } from './win-helper.js'

/** Spotify's own volume and mute (its session in the Volume Mixer). C# 5: Windows PowerShell 5.1 compiles it. */
export const MEDIA_CS = String.raw`
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Runtime.InteropServices;

namespace CompanionSpotify
{
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

	[ComImport, Guid("77AA99A0-1BD6-484F-8BC7-2C654C9A9B6F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
	public interface IAudioSessionManager2
	{
		[PreserveSig] int GetAudioSessionControl(IntPtr guid, int flags, out IntPtr control);
		[PreserveSig] int GetSimpleAudioVolume(IntPtr guid, int flags, out IntPtr volume);
		[PreserveSig] int GetSessionEnumerator(out IAudioSessionEnumerator e);
	}

	[ComImport, Guid("E2F5BB11-0570-40CA-ACDD-3AA01277DEE8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
	public interface IAudioSessionEnumerator
	{
		[PreserveSig] int GetCount(out int n);
		[PreserveSig] int GetSession(int i, out IAudioSessionControl2 s);
	}

	[ComImport, Guid("bfb7ff88-7239-4fc9-8fa2-07c950be9c6d"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
	public interface IAudioSessionControl2
	{
		// IAudioSessionControl first, in order
		[PreserveSig] int GetState(out int state);
		[PreserveSig] int GetDisplayName(out IntPtr name);
		[PreserveSig] int SetDisplayName(IntPtr name, IntPtr ctx);
		[PreserveSig] int GetIconPath(out IntPtr path);
		[PreserveSig] int SetIconPath(IntPtr path, IntPtr ctx);
		[PreserveSig] int GetGroupingParam(out Guid g);
		[PreserveSig] int SetGroupingParam(IntPtr g, IntPtr ctx);
		[PreserveSig] int RegisterAudioSessionNotification(IntPtr n);
		[PreserveSig] int UnregisterAudioSessionNotification(IntPtr n);
		[PreserveSig] int GetSessionIdentifier(out IntPtr id);
		[PreserveSig] int GetSessionInstanceIdentifier(out IntPtr id);
		[PreserveSig] int GetProcessId(out uint pid);
	}

	[ComImport, Guid("87CE5498-68D6-44E5-9215-6DA47EF883D8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
	public interface ISimpleAudioVolume
	{
		[PreserveSig] int SetMasterVolume(float level, ref Guid ctx);
		[PreserveSig] int GetMasterVolume(out float level);
		[PreserveSig] int SetMute([MarshalAs(UnmanagedType.Bool)] bool mute, ref Guid ctx);
		[PreserveSig] int GetMute([MarshalAs(UnmanagedType.Bool)] out bool mute);
	}

	public static class AppVolume
	{
		/** Spotify's sessions on the default output (it can have more than one; they're kept in step). */
		static List<ISimpleAudioVolume> Sessions()
		{
			var list = new List<ISimpleAudioVolume>();
			var en = (IMMDeviceEnumerator)new MMDeviceEnumeratorCom();
			IMMDevice dev;
			if (en.GetDefaultAudioEndpoint(0, 1, out dev) != 0 || dev == null) return list;
			var iid = typeof(IAudioSessionManager2).GUID;
			object o;
			if (dev.Activate(ref iid, 23, IntPtr.Zero, out o) != 0) return list;
			IAudioSessionEnumerator e;
			if (((IAudioSessionManager2)o).GetSessionEnumerator(out e) != 0) return list;
			int n;
			e.GetCount(out n);
			for (int i = 0; i < n; i++)
			{
				IAudioSessionControl2 s;
				if (e.GetSession(i, out s) != 0 || s == null) continue;
				uint pid;
				if (s.GetProcessId(out pid) != 0 || pid == 0) continue;
				string name = "";
				try { name = Process.GetProcessById((int)pid).ProcessName; } catch (Exception) { }
				if (name.Equals("Spotify", StringComparison.OrdinalIgnoreCase)) list.Add((ISimpleAudioVolume)s);
			}
			return list;
		}

		/** { volume 0-100, muted } or null when Spotify hasn't made any sound yet (no session). */
		public static Dictionary<string, object> Get()
		{
			var s = Sessions();
			if (s.Count == 0) return null;
			float v;
			bool m;
			s[0].GetMasterVolume(out v);
			s[0].GetMute(out m);
			return new Dictionary<string, object> { { "volume", (int)Math.Round(v * 100) }, { "muted", m } };
		}

		public static bool Set(double volume)
		{
			var ctx = Guid.Empty;
			var list = Sessions();
			foreach (var s in list) s.SetMasterVolume((float)Math.Max(0, Math.Min(1, volume / 100.0)), ref ctx);
			return list.Count > 0;
		}

		public static bool Mute(bool mute)
		{
			var ctx = Guid.Empty;
			var list = Sessions();
			foreach (var s in list) s.SetMute(mute, ref ctx);
			return list.Count > 0;
		}
	}
}
`

/**
 * The requests: read, art, and the commands. Windows' media controls (GlobalSystemMediaTransportControls)
 * are WinRT, which Windows PowerShell 5.1 reaches directly; its async calls are awaited through AsTask.
 */
export const MEDIA_SCRIPT = String.raw`
Add-Type -AssemblyName System.Runtime.WindowsRuntime
Add-Type -AssemblyName System.Drawing
$null = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media.Control, ContentType = WindowsRuntime]
$null = [Windows.Media.MediaPlaybackAutoRepeatMode, Windows.Media, ContentType = WindowsRuntime]
$null = [Windows.Storage.Streams.IRandomAccessStreamWithContentType, Windows.Storage.Streams, ContentType = WindowsRuntime]
$script:asTask = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation` + '`' + String.raw`1' } | Select-Object -First 1

function Await($op, [Type]$type) {
  $t = $script:asTask.MakeGenericMethod($type).Invoke($null, @($op))
  if (-not $t.Wait(5000)) { throw 'Windows media controls did not answer' }
  $t.Result
}

$script:mgr = $null
function Get-Session {
  if (-not $script:mgr) {
    $script:mgr = Await ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]::RequestAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager])
  }
  # Spotify's desktop app is "Spotify.exe"; the Microsoft Store version is "SpotifyAB.SpotifyMusic_…".
  @($script:mgr.GetSessions()) | Where-Object { $_.SourceAppUserModelId -match 'spotify' } | Select-Object -First 1
}

$script:artKey = ''
$script:artBytes = $null

function Read-State {
  $running = [bool](Get-Process -Name Spotify -ErrorAction SilentlyContinue)
  $vol = [CompanionSpotify.AppVolume]::Get()
  $out = @{ running = $running; session = $false }
  if ($null -ne $vol) { $out.volume = $vol['volume']; $out.muted = $vol['muted'] }
  if (-not $running) { return $out }
  $s = Get-Session
  if (-not $s) { return $out }
  $p = Await ($s.TryGetMediaPropertiesAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties])
  $i = $s.GetPlaybackInfo()
  $t = $s.GetTimelineProperties()
  $status = $i.PlaybackStatus.ToString()
  $playing = $status -eq 'Playing'
  $pos = $t.Position.TotalSeconds
  # Spotify reports the position when it changes state; add the time since while it plays.
  if ($playing -and $t.LastUpdatedTime.Year -gt 2000) { $pos += ([DateTimeOffset]::Now - $t.LastUpdatedTime).TotalSeconds }
  $dur = ($t.EndTime - $t.StartTime).TotalSeconds
  if ($dur -gt 0 -and $pos -gt $dur) { $pos = $dur }
  $c = $i.Controls
  $out.session = $true
  $out.status = $status.ToLower()
  $out.playing = $playing
  $out.track = $p.Title
  $out.artist = $p.Artist
  $out.album = $p.AlbumTitle
  $out.position = [Math]::Round($pos, 1)
  $out.duration = [Math]::Round($dur, 1)
  if ($null -ne $i.IsShuffleActive) { $out.shuffle = [bool]$i.IsShuffleActive }
  if ($null -ne $i.AutoRepeatMode) { $out.repeat = $i.AutoRepeatMode.ToString() -ne 'None' }
  $out.can = @{ seek = [bool]$c.IsPlaybackPositionEnabled; shuffle = [bool]$c.IsShuffleEnabled; repeat = [bool]$c.IsRepeatEnabled }
  $out.artKey = if ($p.Thumbnail) { '' + $p.Title + '|' + $p.Artist + '|' + $p.AlbumTitle } else { '' }
  $out
}

# The cover as a small JPEG (base64), whatever format Spotify handed Windows.
function Read-Art {
  $s = Get-Session
  if (-not $s) { return $null }
  $p = Await ($s.TryGetMediaPropertiesAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties])
  if (-not $p.Thumbnail) { return $null }
  $key = '' + $p.Title + '|' + $p.Artist + '|' + $p.AlbumTitle
  if ($key -eq $script:artKey -and $script:artBytes) { return @{ key = $key; jpeg = $script:artBytes } }
  $ras = Await ($p.Thumbnail.OpenReadAsync()) ([Windows.Storage.Streams.IRandomAccessStreamWithContentType])
  $stream = [System.IO.WindowsRuntimeStreamExtensions]::AsStreamForRead($ras)
  $img = [System.Drawing.Image]::FromStream($stream)
  $bmp = New-Object System.Drawing.Bitmap 300, 300
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g.DrawImage($img, 0, 0, 300, 300)
  $ms = New-Object System.IO.MemoryStream
  $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Jpeg)
  $g.Dispose(); $bmp.Dispose(); $img.Dispose(); $stream.Dispose()
  $script:artKey = $key
  $script:artBytes = [Convert]::ToBase64String($ms.ToArray())
  @{ key = $key; jpeg = $script:artBytes }
}

function Send-SpotifyCommand($cmd, $arg) {
  if ($cmd -eq 'volume') { if ([CompanionSpotify.AppVolume]::Set([double]$arg)) { return 'OK' } else { return 'NOSOUND' } }
  if ($cmd -eq 'mute') { if ([CompanionSpotify.AppVolume]::Mute($arg -eq 'true')) { return 'OK' } else { return 'NOSOUND' } }
  $s = Get-Session
  if (-not $s) { return 'NOTRUNNING' }
  $op = switch ($cmd) {
    'play' { $s.TryPlayAsync() }
    'pause' { $s.TryPauseAsync() }
    'playpause' { $s.TryTogglePlayPauseAsync() }
    'next' { $s.TrySkipNextAsync() }
    'previous' { $s.TrySkipPreviousAsync() }
    'seek' { $s.TryChangePlaybackPositionAsync([long]([double]$arg * 10000000)) }
    'shuffle' { $s.TryChangeShuffleActiveAsync($arg -eq 'true') }
    'repeat' { $s.TryChangeAutoRepeatModeAsync($(if ($arg -eq 'true') { [Windows.Media.MediaPlaybackAutoRepeatMode]::List } else { [Windows.Media.MediaPlaybackAutoRepeatMode]::None })) }
    default { throw "unknown command $cmd" }
  }
  if (Await $op ([bool])) { 'OK' } else { 'REFUSED' }
}

function Invoke-Request($line) {
  $id = $null
  try {
    $r = $line | ConvertFrom-Json
    $id = $r.id
    $result = switch ($r.cmd) {
      'ping' { 'pong' }
      'read' { Read-State }
      'art' { Read-Art }
      'command' { Send-SpotifyCommand $r.name $r.arg }
      default { throw "unknown request $($r.cmd)" }
    }
    @{ id = $id; result = $result } | ConvertTo-Json -Compress -Depth 5
  } catch {
    @{ id = $id; error = $_.Exception.Message } | ConvertTo-Json -Compress
  }
}
`

export class SpotifyHelper extends WinHelper {
	constructor(opts = {}) {
		super({ name: 'spotify', cs: MEDIA_CS, script: MEDIA_SCRIPT, ...opts })
	}
}
