/*
 * Codex-Boss Alien2 Real Work v1 RC1 — thin Windows installer.
 *
 * This is NOT an application packager. It carries one payload: the ZIP that
 * `pnpm run package:portable` produced, appended to this executable. The
 * installer only unpacks that payload, creates the shortcuts and registers the
 * uninstall entry; it never decides which files belong to the application.
 *
 * Roles, chosen by file name / argument:
 *
 *   Setup.exe [--silent] [--launch] [--dir=<path>]     install or upgrade
 *   Uninstall.exe [--silent]                           remove binaries only
 *
 * User data lives at %LOCALAPPDATA%\Codex-Boss and is NEVER touched here: the
 * uninstall removes the installation the installer owns and nothing else.
 *
 * Compiled by the Windows-provided csc.exe (no build dependency). Target is the
 * C# 5 compiler shipping with .NET Framework 4.8, so this file avoids newer
 * syntax on purpose.
 */

using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.IO.Compression;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Text;
using Microsoft.Win32;

internal static class Installer
{
    private const string DefaultInstallFolderName = "Codex-Boss";
    private const string UninstallKeyPath = @"Software\Microsoft\Windows\CurrentVersion\Uninstall\Codex-Boss-Alien2-RealWork-v1-RC1";
    private const string ShortcutName = "Codex-Boss Alien2 Real Work v1 RC1";
    private const string AppExecutableName = "Codex Boss.exe";
    private const string UserDataFolderName = "Codex-Boss";
    private const uint EocdSignature = 0x06054b50;

    private static int Main(string[] args)
    {
        try
        {
            bool silent = HasFlag(args, "--silent");
            bool uninstallRole = HasFlag(args, "--uninstall") || IsUninstallerExecutable();
            if (uninstallRole) return RunUninstall(args, silent);
            return RunInstall(args, silent);
        }
        catch (Exception error)
        {
            Console.Error.WriteLine("[setup] FAILED: " + error.Message);
            if (!HasFlag(args, "--silent"))
            {
                Console.Error.WriteLine(error.ToString());
                Console.Error.WriteLine("Press Enter to close.");
                try { Console.ReadLine(); } catch { /* no console */ }
            }
            return 1;
        }
    }

    /* ------------------------------------------------------------------ */
    /* install                                                             */
    /* ------------------------------------------------------------------ */

    private static int RunInstall(string[] args, bool silent)
    {
        string installRoot = Value(args, "--dir");
        if (string.IsNullOrEmpty(installRoot)) installRoot = DefaultInstallRoot();
        installRoot = Path.GetFullPath(installRoot);

        string userDataRoot = Value(args, "--user-data-root");
        if (string.IsNullOrEmpty(userDataRoot)) userDataRoot = DefaultUserDataRoot();

        Console.WriteLine("[setup] product:    " + BuildInfo.ProductDisplayName);
        Console.WriteLine("[setup] version:    " + BuildInfo.Version + " (" + BuildInfo.Channel + ")");
        Console.WriteLine("[setup] commit:     " + BuildInfo.CandidateCommit);
        Console.WriteLine("[setup] install to: " + installRoot);
        Console.WriteLine("[setup] user data:  " + userDataRoot + "  (never touched by setup or uninstall)");

        string staging = Path.Combine(Path.GetTempPath(), "codex-boss-payload-" + Process.GetCurrentProcess().Id.ToString(CultureInfo.InvariantCulture));
        if (Directory.Exists(staging)) Directory.Delete(staging, true);
        Directory.CreateDirectory(staging);

        try
        {
            string payloadZip;
            int payloadBytes = ResolvePayload(staging, out payloadZip);
            Console.WriteLine("[setup] payload:    " + (payloadBytes / (1024 * 1024)).ToString(CultureInfo.InvariantCulture) + " MB from " + payloadZip);
            Directory.CreateDirectory(installRoot);
            int files = ExpandZip(payloadZip, installRoot);
            Console.WriteLine("[setup] installed " + files.ToString(CultureInfo.InvariantCulture) + " files");
        }
        finally
        {
            TryDeleteDirectory(staging);
        }

        string appExe = Path.Combine(installRoot, AppExecutableName);
        if (!File.Exists(appExe)) throw new FileNotFoundException("the payload did not contain the application executable", appExe);

        File.Copy(Assembly.GetExecutingAssembly().Location, Path.Combine(installRoot, "Uninstall.exe"), true);

        List<string> shortcuts = new List<string>();
        shortcuts.Add(CreateShortcut(Path.Combine(StartMenuPrograms(), ShortcutName + ".lnk"), appExe, installRoot));
        shortcuts.Add(CreateShortcut(Path.Combine(DesktopDirectory(), ShortcutName + ".lnk"), appExe, installRoot));
        foreach (string shortcut in shortcuts) Console.WriteLine("[setup] shortcut:   " + shortcut);

        RegisterUninstall(installRoot, appExe);
        Console.WriteLine("[setup] registered the uninstall entry for the current user");

        bool shouldLaunch = HasFlag(args, "--launch");
        if (!shouldLaunch && !silent && !HasFlag(args, "--no-launch"))
        {
            Console.Write("[setup] Launch " + BuildInfo.ProductDisplayName + " now? [Y/n] ");
            string answer = null;
            try { answer = Console.ReadLine(); } catch { /* no console */ }
            shouldLaunch = answer == null || answer.Trim().Length == 0 || answer.Trim().ToLowerInvariant().StartsWith("y");
        }
        if (shouldLaunch)
        {
            Process.Start(new ProcessStartInfo(appExe) { WorkingDirectory = installRoot, UseShellExecute = true });
            Console.WriteLine("[setup] launched");
        }

        Console.WriteLine("[setup] OK");
        return 0;
    }

    private static void RegisterUninstall(string installRoot, string appExe)
    {
        using (RegistryKey key = Registry.CurrentUser.CreateSubKey(UninstallKeyPath))
        {
            if (key == null) throw new InvalidOperationException("cannot create the uninstall registry key");
            string uninstaller = Path.Combine(installRoot, "Uninstall.exe");
            key.SetValue("DisplayName", BuildInfo.ProductDisplayName);
            key.SetValue("DisplayVersion", BuildInfo.Version);
            key.SetValue("Publisher", BuildInfo.Publisher);
            key.SetValue("InstallLocation", installRoot);
            key.SetValue("DisplayIcon", appExe);
            key.SetValue("UninstallString", "\"" + uninstaller + "\"");
            key.SetValue("QuietUninstallString", "\"" + uninstaller + "\" --silent");
            key.SetValue("NoModify", 1, RegistryValueKind.DWord);
            key.SetValue("NoRepair", 1, RegistryValueKind.DWord);
            key.SetValue("EstimatedSize", DirectorySizeKb(installRoot), RegistryValueKind.DWord);
            key.SetValue("URLInfoAbout", BuildInfo.ProductUrl);
        }
    }

    /* ------------------------------------------------------------------ */
    /* uninstall                                                           */
    /* ------------------------------------------------------------------ */

    private static int RunUninstall(string[] args, bool silent)
    {
        string here = Assembly.GetExecutingAssembly().Location;
        string installRoot = Path.GetDirectoryName(here);
        if (HasFlag(args, "--detached"))
        {
            // Second pass, running from %TEMP% so the installation can be removed whole.
            Console.WriteLine("[uninstall] removing " + installRoot);
            TryDeleteDirectory(installRoot);
            RemoveUninstallRegistration();
            Console.WriteLine("[uninstall] user data was left in place: " + DefaultUserDataRoot());
            Console.WriteLine("[uninstall] OK");
            File.Delete(here);
            return 0;
        }

        Console.WriteLine("[uninstall] product:  " + BuildInfo.ProductDisplayName);
        foreach (string name in new string[] { ShortcutName + ".lnk" })
        {
            TryDeleteFile(Path.Combine(StartMenuPrograms(), name));
            TryDeleteFile(Path.Combine(DesktopDirectory(), name));
        }
        Console.WriteLine("[uninstall] shortcuts removed");

        // A running executable cannot delete its own directory: hand the removal to a
        // copy of this uninstaller in %TEMP% and exit immediately.
        string detached = Path.Combine(Path.GetTempPath(), "codex-boss-uninstall-" + Process.GetCurrentProcess().Id.ToString(CultureInfo.InvariantCulture) + ".exe");
        File.Copy(here, detached, true);
        Process.Start(new ProcessStartInfo(detached, "--uninstall --detached" + (silent ? " --silent" : "")) { UseShellExecute = false });
        Console.WriteLine("[uninstall] binaries, shortcuts and the uninstall entry will be removed");
        Console.WriteLine("[uninstall] user data is preserved at " + DefaultUserDataRoot());
        return 0;
    }

    private static void RemoveUninstallRegistration()
    {
        try { Registry.CurrentUser.DeleteSubKeyTree(UninstallKeyPath, false); } catch { /* already gone */ }
    }

    /* ------------------------------------------------------------------ */
    /* payload                                                             */
    /* ------------------------------------------------------------------ */

    /**
     * Finds the payload.
     *
     * The payload is a ZIP built by `pnpm run package:portable` plus the generated
     * build manifest. It is looked for BESIDE this executable first, so the
     * installer is a small program rather than a 170 MB self-extracting binary:
     * endpoint protection on real hosts treats a freshly built, unsigned,
     * self-extracting executable as untrusted and quarantines it, while the very
     * same bytes as a ZIP are left alone. A build that appends the payload (the
     * single-file form) is still supported through the fall-back below.
     */
    private static int ResolvePayload(string staging, out string payloadPath)
    {
        string here = Assembly.GetExecutingAssembly().Location;
        string directory = Path.GetDirectoryName(here);
        string[] candidates = new string[]
        {
            Path.Combine(directory, Path.GetFileNameWithoutExtension(here) + ".payload.zip"),
            Path.Combine(directory, "Codex-Boss-Alien2-RealWork-v1-RC1-Portable.zip"),
            Path.Combine(directory, "payload.zip")
        };
        foreach (string candidate in candidates)
        {
            if (File.Exists(candidate))
            {
                payloadPath = candidate;
                return (int)new FileInfo(candidate).Length;
            }
        }
        payloadPath = Path.Combine(staging, "payload.zip");
        return ExtractAppendedPayload(payloadPath);
    }

    /** Copies the ZIP appended to this executable into <paramref name="destination"/>. */
    private static int ExtractAppendedPayload(string destination)
    {
        string self = Assembly.GetExecutingAssembly().Location;
        byte[] bytes = File.ReadAllBytes(self);
        long eocd = FindEndOfCentralDirectory(bytes);
        if (eocd < 0) throw new InvalidDataException("no appended payload found in " + self);
        uint centralSize = BitConverter.ToUInt32(bytes, (int)eocd + 12);
        uint centralOffset = BitConverter.ToUInt32(bytes, (int)eocd + 16);
        long zipStart = eocd - centralSize - centralOffset;
        if (zipStart <= 0 || zipStart >= bytes.Length) throw new InvalidDataException("appended payload is not addressable");
        using (FileStream output = File.Create(destination))
        {
            output.Write(bytes, (int)zipStart, (int)(bytes.Length - zipStart));
        }
        return (int)(bytes.Length - zipStart);
    }

    private static long FindEndOfCentralDirectory(byte[] bytes)
    {
        int minimum = 22;
        int scanFrom = Math.Max(0, bytes.Length - 66000);
        for (int index = bytes.Length - minimum; index >= scanFrom; index--)
        {
            if (BitConverter.ToUInt32(bytes, index) == EocdSignature) return index;
        }
        return -1;
    }

    private static int ExpandZip(string zipPath, string targetRoot)
    {
        int count = 0;
        string rootWithSeparator = targetRoot.TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar;
        using (ZipArchive archive = ZipFile.OpenRead(zipPath))
        {
            foreach (ZipArchiveEntry entry in archive.Entries)
            {
                string relative = entry.FullName.Replace('/', Path.DirectorySeparatorChar);
                string target = Path.GetFullPath(Path.Combine(targetRoot, relative));
                if (!target.StartsWith(rootWithSeparator, StringComparison.OrdinalIgnoreCase)) throw new InvalidDataException("payload entry escapes the install directory: " + entry.FullName);
                if (entry.FullName.EndsWith("/", StringComparison.Ordinal)) { Directory.CreateDirectory(target); continue; }
                string parent = Path.GetDirectoryName(target);
                if (!string.IsNullOrEmpty(parent)) Directory.CreateDirectory(parent);
                entry.ExtractToFile(target, true);
                count++;
                if (count % 500 == 0) Console.WriteLine("[setup] ... " + count.ToString(CultureInfo.InvariantCulture) + " files");
            }
        }
        return count;
    }

    /* ------------------------------------------------------------------ */
    /* shortcuts                                                           */
    /* ------------------------------------------------------------------ */

    private static string CreateShortcut(string shortcutPath, string targetExe, string workingDirectory)
    {
        string parent = Path.GetDirectoryName(shortcutPath);
        if (!string.IsNullOrEmpty(parent)) Directory.CreateDirectory(parent);
        Type shellLinkType = Type.GetTypeFromCLSID(new Guid("00021401-0000-0000-C000-000000000046"), true);
        object instance = Activator.CreateInstance(shellLinkType);
        IShellLinkW link = (IShellLinkW)instance;
        link.SetPath(targetExe);
        link.SetWorkingDirectory(workingDirectory);
        link.SetDescription(BuildInfo.ProductDisplayName);
        link.SetIconLocation(targetExe, 0);
        IPersistFile file = (IPersistFile)instance;
        file.Save(shortcutPath, true);
        Marshal.FinalReleaseComObject(instance);
        return shortcutPath;
    }

    /* ------------------------------------------------------------------ */
    /* locations                                                           */
    /* ------------------------------------------------------------------ */

    /** The LOCALAPPDATA environment variable wins, so an isolated test can redirect it. */
    private static string LocalAppData()
    {
        string fromEnvironment = Environment.GetEnvironmentVariable("LOCALAPPDATA");
        if (!string.IsNullOrEmpty(fromEnvironment)) return fromEnvironment;
        return Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
    }

    private static string DefaultInstallRoot()
    {
        return Path.Combine(Path.Combine(LocalAppData(), "Programs"), DefaultInstallFolderName);
    }

    private static string DefaultUserDataRoot()
    {
        return Path.Combine(LocalAppData(), UserDataFolderName);
    }

    private static string StartMenuPrograms()
    {
        string appData = Environment.GetEnvironmentVariable("APPDATA");
        if (string.IsNullOrEmpty(appData)) appData = Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData);
        return Path.Combine(Path.Combine(Path.Combine(appData, "Microsoft"), "Windows"), Path.Combine("Start Menu", "Programs"));
    }

    private static string DesktopDirectory()
    {
        string profile = Environment.GetEnvironmentVariable("USERPROFILE");
        if (!string.IsNullOrEmpty(profile)) return Path.Combine(profile, "Desktop");
        return Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory);
    }

    /* ------------------------------------------------------------------ */
    /* small helpers                                                       */
    /* ------------------------------------------------------------------ */

    private static bool HasFlag(string[] args, string flag)
    {
        foreach (string argument in args) if (string.Equals(argument, flag, StringComparison.OrdinalIgnoreCase)) return true;
        return false;
    }

    private static string Value(string[] args, string name)
    {
        foreach (string argument in args)
        {
            if (argument.StartsWith(name + "=", StringComparison.OrdinalIgnoreCase)) return argument.Substring(name.Length + 1);
        }
        return null;
    }

    private static bool IsUninstallerExecutable()
    {
        string name = Path.GetFileNameWithoutExtension(Assembly.GetExecutingAssembly().Location);
        return string.Equals(name, "Uninstall", StringComparison.OrdinalIgnoreCase);
    }

    private static int DirectorySizeKb(string directory)
    {
        long total = 0;
        try
        {
            foreach (string file in Directory.GetFiles(directory, "*", SearchOption.AllDirectories)) total += new FileInfo(file).Length;
        }
        catch { /* best effort, display only */ }
        long kb = total / 1024;
        return kb > int.MaxValue ? int.MaxValue : (int)kb;
    }

    private static void TryDeleteFile(string path)
    {
        try { if (File.Exists(path)) File.Delete(path); } catch { /* best effort */ }
    }

    private static void TryDeleteDirectory(string path)
    {
        try { if (Directory.Exists(path)) Directory.Delete(path, true); } catch { /* best effort */ }
    }
}

/*
 * `BuildInfo` is not declared here: scripts/package-installer.cjs generates
 * `BuildInfo.g.cs` next to this file at build time, so the product name, version,
 * channel and the candidate commit the installer reports are the ones actually
 * built rather than a constant that drifts.
 */

[ComImport, Guid("000214F9-0000-0000-C000-000000000046"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
internal interface IShellLinkW
{
    void GetPath([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder pszFile, int cch, IntPtr pfd, int fFlags);
    void GetIDList(out IntPtr ppidl);
    void SetIDList(IntPtr pidl);
    void GetDescription([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder pszName, int cch);
    void SetDescription([MarshalAs(UnmanagedType.LPWStr)] string pszName);
    void GetWorkingDirectory([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder pszDir, int cch);
    void SetWorkingDirectory([MarshalAs(UnmanagedType.LPWStr)] string pszDir);
    void GetArguments([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder pszArgs, int cch);
    void SetArguments([MarshalAs(UnmanagedType.LPWStr)] string pszArgs);
    void GetHotkey(out short pwHotkey);
    void SetHotkey(short wHotkey);
    void GetShowCmd(out int piShowCmd);
    void SetShowCmd(int iShowCmd);
    void GetIconLocation([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder pszIconPath, int cch, out int piIcon);
    void SetIconLocation([MarshalAs(UnmanagedType.LPWStr)] string pszIconPath, int iIcon);
    void SetRelativePath([MarshalAs(UnmanagedType.LPWStr)] string pszPathRel, int dwReserved);
    void Resolve(IntPtr hwnd, int fFlags);
    void SetPath([MarshalAs(UnmanagedType.LPWStr)] string pszFile);
}

[ComImport, Guid("0000010b-0000-0000-C000-000000000046"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
internal interface IPersistFile
{
    void GetClassID(out Guid pClassID);
    void IsDirty();
    void Load([MarshalAs(UnmanagedType.LPWStr)] string pszFileName, uint dwMode);
    void Save([MarshalAs(UnmanagedType.LPWStr)] string pszFileName, [MarshalAs(UnmanagedType.Bool)] bool fRemember);
    void SaveCompleted([MarshalAs(UnmanagedType.LPWStr)] string pszFileName);
    void GetCurFile([MarshalAs(UnmanagedType.LPWStr)] out string ppszFileName);
}
