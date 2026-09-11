/**
 * The Windows sandbox launcher source, embedded so the compiled Electron
 * bundle does not depend on a loose `.cs` file being copied next to it.
 *
 * The canonical file is `electron/self-evolution/sandbox/windows-appcontainer/launcher.cs`;
 * `tests/unit/evolution-sandbox.test.ts` asserts the two are byte-identical.
 *
 * This is HOST-owned code: a Candidate can never reach it, and the host
 * compiles it with the .NET Framework compiler that ships with Windows.
 * Windows refuses a caller-supplied environment block for an AppContainer
 * process, so the launcher installs the host-sanitized block on itself and
 * lets the child inherit it (every pre-existing variable is removed first).
 */
export const SANDBOX_LAUNCHER_SOURCE = String.raw`using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Runtime.InteropServices;
using System.Security.AccessControl;
using System.Security.Principal;
using System.Text;

/// <summary>
/// Codex-Boss Autonomous Evolution hard-execution sandbox launcher (Windows).
///
/// This process is the ONLY thing that turns a Candidate subprocess request into
/// an operating-system process. It applies, in order:
///
///   1. a Windows AppContainer security context (lowbox token) whose SID is
///      granted access only to the paths the host explicitly grants, so the
///      child cannot read or write anything else, and has no network capability;
///   2. an explicit environment block (never the launcher's own environment);
///   3. a Job Object that owns the whole process tree, with an active-process
///      ceiling, a memory ceiling and kill-on-close;
///   4. a suspended start, so the child cannot run before the job is applied.
///
/// The launcher is deliberately dependency-free: it is compiled by the host with
/// the .NET Framework compiler that ships with Windows, and it never parses
/// arguments from a Candidate-provided command line.
/// </summary>
internal static class SandboxLauncher
{
    private const int EXTENDED_STARTUPINFO_PRESENT = 0x00080000;
    private const int CREATE_UNICODE_ENVIRONMENT = 0x00000400;
    private const int CREATE_SUSPENDED = 0x00000004;
    private const int CREATE_NEW_PROCESS_GROUP = 0x00000200;
    private const int STARTF_USESTDHANDLES = 0x00000100;
    private const int HANDLE_FLAG_INHERIT = 0x00000001;

    private const int JobObjectExtendedLimitInformation = 9;
    private const uint JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE = 0x00002000;
    private const uint JOB_OBJECT_LIMIT_ACTIVE_PROCESS = 0x00000008;
    private const uint JOB_OBJECT_LIMIT_PROCESS_MEMORY = 0x00000100;
    private const uint JOB_OBJECT_LIMIT_JOB_MEMORY = 0x00000200;
    private const uint JOB_OBJECT_LIMIT_DIE_ON_UNHANDLED_EXCEPTION = 0x00000400;

    private static readonly IntPtr PROC_THREAD_ATTRIBUTE_SECURITY_CAPABILITIES = new IntPtr(0x00020009);

    private const uint WAIT_OBJECT_0 = 0x00000000;
    private const uint WAIT_TIMEOUT = 0x00000102;

    [StructLayout(LayoutKind.Sequential)]
    private struct SECURITY_CAPABILITIES
    {
        public IntPtr AppContainerSid;
        public IntPtr Capabilities;
        public uint CapabilityCount;
        public uint Reserved;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct STARTUPINFO
    {
        public int cb;
        public IntPtr lpReserved;
        public IntPtr lpDesktop;
        public IntPtr lpTitle;
        public int dwX, dwY, dwXSize, dwYSize, dwXCountChars, dwYCountChars, dwFillAttribute, dwFlags;
        public short wShowWindow, cbReserved2;
        public IntPtr lpReserved2;
        public IntPtr hStdInput, hStdOutput, hStdError;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct STARTUPINFOEX
    {
        public STARTUPINFO StartupInfo;
        public IntPtr lpAttributeList;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct PROCESS_INFORMATION
    {
        public IntPtr hProcess;
        public IntPtr hThread;
        public int dwProcessId;
        public int dwThreadId;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct JOBOBJECT_BASIC_LIMIT_INFORMATION
    {
        public long PerProcessUserTimeLimit;
        public long PerJobUserTimeLimit;
        public uint LimitFlags;
        public UIntPtr MinimumWorkingSetSize;
        public UIntPtr MaximumWorkingSetSize;
        public uint ActiveProcessLimit;
        public UIntPtr Affinity;
        public uint PriorityClass;
        public uint SchedulingClass;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct IO_COUNTERS
    {
        public ulong ReadOperationCount, WriteOperationCount, OtherOperationCount;
        public ulong ReadTransferCount, WriteTransferCount, OtherTransferCount;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct JOBOBJECT_EXTENDED_LIMIT_INFORMATION
    {
        public JOBOBJECT_BASIC_LIMIT_INFORMATION BasicLimitInformation;
        public IO_COUNTERS IoInfo;
        public UIntPtr ProcessMemoryLimit;
        public UIntPtr JobMemoryLimit;
        public UIntPtr PeakProcessMemoryUsed;
        public UIntPtr PeakJobMemoryUsed;
    }

    [DllImport("userenv.dll", CharSet = CharSet.Unicode, SetLastError = false)]
    private static extern int CreateAppContainerProfile(string name, string displayName, string description, IntPtr capabilities, uint capabilityCount, out IntPtr sid);

    [DllImport("userenv.dll", CharSet = CharSet.Unicode, SetLastError = false)]
    private static extern int DeriveAppContainerSidFromAppContainerName(string name, out IntPtr sid);

    [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool ConvertSidToStringSid(IntPtr sid, out IntPtr stringSid);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool InitializeProcThreadAttributeList(IntPtr list, int count, int flags, ref IntPtr size);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool UpdateProcThreadAttribute(IntPtr list, uint flags, IntPtr attribute, IntPtr value, IntPtr size, IntPtr previous, IntPtr returned);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool DeleteProcThreadAttributeList(IntPtr list);

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool CreateProcessW(
        string applicationName, StringBuilder commandLine, IntPtr processAttributes, IntPtr threadAttributes,
        bool inheritHandles, int creationFlags, IntPtr environment, string currentDirectory,
        ref STARTUPINFOEX startupInfo, out PROCESS_INFORMATION processInformation);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern uint ResumeThread(IntPtr thread);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern uint WaitForSingleObject(IntPtr handle, uint milliseconds);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool GetExitCodeProcess(IntPtr process, out uint exitCode);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool CloseHandle(IntPtr handle);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool TerminateProcess(IntPtr process, uint exitCode);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern IntPtr CreateJobObjectW(IntPtr attributes, string name);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool SetInformationJobObject(IntPtr job, int infoClass, IntPtr info, uint infoLength);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool TerminateJobObject(IntPtr job, uint exitCode);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool SetHandleInformation(IntPtr handle, int mask, int flags);

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern IntPtr CreateFileW(string name, uint access, uint share, IntPtr attributes, uint disposition, uint flags, IntPtr template);

    private static readonly IntPtr INVALID_HANDLE_VALUE = new IntPtr(-1);

    private static int Main(string[] args)
    {
        if (args.Length != 1)
        {
            Console.Error.WriteLine("usage: SandboxLauncher.exe <request-file>");
            return 2;
        }

        Request request;
        try
        {
            request = Request.Parse(File.ReadAllLines(args[0], Encoding.UTF8));
        }
        catch (Exception error)
        {
            Console.Error.WriteLine("invalid sandbox request: " + error.Message);
            return 2;
        }

        if (request.Probe)
        {
            return RunProbe(request);
        }

        var report = new Report { launcher = "codex-boss-evolution-sandbox", startedAt = DateTime.UtcNow.ToString("o") };
        var stopwatch = Stopwatch.StartNew();
        IntPtr appContainerSid = IntPtr.Zero;
        string sidText = null;

        try
        {
            if (!string.IsNullOrEmpty(request.Container))
            {
                appContainerSid = ResolveAppContainerSid(request.Container, out sidText);
                report.container = request.Container;
                report.containerSid = sidText;
                var grantClock = Stopwatch.StartNew();
                foreach (Grant grant in request.Grants)
                {
                    long before = grantClock.ElapsedMilliseconds;
                    ApplyGrant(new SecurityIdentifier(sidText), grant);
                    report.grants.Add(grant.Access + ":" + grant.Path);
                    report.phases.Add("grant:" + grant.Access + ":" + (grantClock.ElapsedMilliseconds - before) + "ms");
                }
                report.phases.Add("grants-total:" + grantClock.ElapsedMilliseconds + "ms");
            }

            return Execute(request, report, appContainerSid, stopwatch);
        }
        catch (Exception error)
        {
            report.failure = error.GetType().Name + ": " + error.Message;
            Win32Exception win32 = error as Win32Exception;
            report.win32Error = win32 != null ? win32.NativeErrorCode : Marshal.GetLastWin32Error();
            report.completedAt = DateTime.UtcNow.ToString("o");
            report.durationMs = stopwatch.ElapsedMilliseconds;
            WriteReport(request, report);
            Console.Error.WriteLine("sandbox launcher failed: " + report.failure);
            return 3;
        }
    }

    private static int RunProbe(Request request)
    {
        var report = new Report { launcher = "codex-boss-evolution-sandbox", startedAt = DateTime.UtcNow.ToString("o") };
        try
        {
            string sidText;
            IntPtr sid = ResolveAppContainerSid(request.Container ?? "CodexBossEvolutionProbe", out sidText);
            report.containerSid = sidText;
            report.probe = new ProbeReport { appContainer = true, appContainerSid = sidText };
            IntPtr job = CreateJobObjectW(IntPtr.Zero, null);
            report.probe.jobObject = job != IntPtr.Zero;
            if (job != IntPtr.Zero) CloseHandle(job);
            report.ok = true;
        }
        catch (Exception error)
        {
            report.failure = error.GetType().Name + ": " + error.Message;
            report.ok = false;
        }
        report.completedAt = DateTime.UtcNow.ToString("o");
        WriteReport(request, report);
        return 0;
    }

    private static string ToSidText(IntPtr sid)
    {
        IntPtr textPointer;
        if (!ConvertSidToStringSid(sid, out textPointer)) throw new Win32Exception(Marshal.GetLastWin32Error(), "ConvertSidToStringSid");
        return Marshal.PtrToStringUni(textPointer);
    }

    private static IntPtr ResolveAppContainerSid(string name, out string sidText)
    {
        IntPtr sid;
        int created = CreateAppContainerProfile(name, name, "Codex-Boss autonomous evolution sandbox", IntPtr.Zero, 0, out sid);
        if (created != 0)
        {
            // 0x800700B7 == HRESULT_FROM_WIN32(ERROR_ALREADY_EXISTS): reuse the existing profile.
            int derived = DeriveAppContainerSidFromAppContainerName(name, out sid);
            if (derived != 0) throw new InvalidOperationException("AppContainer unavailable: CreateAppContainerProfile=0x" + created.ToString("X8") + " DeriveAppContainerSid=0x" + derived.ToString("X8"));
        }
        sidText = ToSidText(sid);
        return sid;
    }

    private static void ApplyGrant(SecurityIdentifier appContainer, Grant grant)
    {
        FileSystemRights rights;
        switch (grant.Access)
        {
            case "write":
                rights = FileSystemRights.Modify | FileSystemRights.Synchronize;
                break;
            case "read":
                rights = FileSystemRights.ReadAndExecute | FileSystemRights.Synchronize;
                break;
            case "traverse":
                // Metadata-only: lets the loader stat a path component without
                // granting directory listing or file content. Used for the
                // ancestors of a granted root and for nothing else.
                rights = FileSystemRights.Traverse | FileSystemRights.ReadAttributes | FileSystemRights.Synchronize;
                break;
            default:
                throw new InvalidOperationException("unknown grant access: " + grant.Access);
        }

        if (Directory.Exists(grant.Path))
        {
            var info = new DirectoryInfo(grant.Path);
            DirectorySecurity security = info.GetAccessControl(AccessControlSections.Access);
            // Setting a DACL with inheritable ACEs makes Windows walk the whole
            // subtree, which is far too expensive to repeat for a large
            // read-only toolchain. A grant that is already present is a no-op.
            if (AlreadyGranted(security, appContainer, rights)) return;
            InheritanceFlags inheritance = grant.Access == "traverse"
                ? InheritanceFlags.None
                : InheritanceFlags.ContainerInherit | InheritanceFlags.ObjectInherit;
            security.AddAccessRule(new FileSystemAccessRule(appContainer, rights, inheritance, PropagationFlags.None, AccessControlType.Allow));
            info.SetAccessControl(security);
            return;
        }

        if (File.Exists(grant.Path))
        {
            var info = new FileInfo(grant.Path);
            FileSecurity security = info.GetAccessControl(AccessControlSections.Access);
            if (AlreadyGranted(security, appContainer, rights)) return;
            security.AddAccessRule(new FileSystemAccessRule(appContainer, rights, AccessControlType.Allow));
            info.SetAccessControl(security);
            return;
        }

        throw new FileNotFoundException("grant path does not exist: " + grant.Path);
    }

    private static int Execute(Request request, Report report, IntPtr appContainerSid, Stopwatch stopwatch)
    {
        IntPtr standardOutput = INVALID_HANDLE_VALUE;
        IntPtr standardError = INVALID_HANDLE_VALUE;
        IntPtr standardInput = INVALID_HANDLE_VALUE;

        IntPtr environment = IntPtr.Zero;
        IntPtr capabilitiesBuffer = IntPtr.Zero;
        IntPtr attributeList = IntPtr.Zero;
        PROCESS_INFORMATION process = new PROCESS_INFORMATION();
        IntPtr job = IntPtr.Zero;

        try
        {
            // Windows refuses a caller-supplied environment block for an
            // AppContainer process (CreateProcess fails with ERROR_ENVVAR_NOT_FOUND),
            // so the block is installed on this launcher instead and inherited.
            // The child still sees exactly the host-supplied variables because
            // every pre-existing variable is removed first.
            if (request.Environment.Count > 0)
            {
                foreach (System.Collections.DictionaryEntry entry in Environment.GetEnvironmentVariables())
                {
                    string existing = entry.Key as string;
                    if (existing == null) continue;
                    try { Environment.SetEnvironmentVariable(existing, null); } catch { }
                }
                foreach (KeyValuePair<string, string> entry in request.Environment)
                {
                    Environment.SetEnvironmentVariable(entry.Key, entry.Value);
                }
            }
            environment = IntPtr.Zero;

            if (!string.IsNullOrEmpty(request.StdOutFile)) standardOutput = CreateInheritableFile(request.StdOutFile, false);
            if (!string.IsNullOrEmpty(request.StdErrFile)) standardError = CreateInheritableFile(request.StdErrFile, false);
            standardInput = CreateInheritableFile(string.IsNullOrEmpty(request.StdInFile) ? "NUL" : request.StdInFile, true);

            var startup = new STARTUPINFOEX();
            startup.StartupInfo.cb = Marshal.SizeOf(typeof(STARTUPINFOEX));
            if (!string.IsNullOrEmpty(request.StdOutFile) || !string.IsNullOrEmpty(request.StdErrFile))
            {
                startup.StartupInfo.dwFlags |= STARTF_USESTDHANDLES;
                startup.StartupInfo.hStdInput = standardInput;
                startup.StartupInfo.hStdOutput = standardOutput;
                startup.StartupInfo.hStdError = standardError;
            }

            if (appContainerSid != IntPtr.Zero)
            {
                var capabilities = new SECURITY_CAPABILITIES { AppContainerSid = appContainerSid, Capabilities = IntPtr.Zero, CapabilityCount = 0, Reserved = 0 };
                capabilitiesBuffer = Marshal.AllocHGlobal(Marshal.SizeOf(typeof(SECURITY_CAPABILITIES)));
                Marshal.StructureToPtr(capabilities, capabilitiesBuffer, false);

                IntPtr size = IntPtr.Zero;
                InitializeProcThreadAttributeList(IntPtr.Zero, 1, 0, ref size);
                attributeList = Marshal.AllocHGlobal(size);
                if (!InitializeProcThreadAttributeList(attributeList, 1, 0, ref size)) throw new Win32Exception(Marshal.GetLastWin32Error(), "InitializeProcThreadAttributeList");
                if (!UpdateProcThreadAttribute(attributeList, 0, PROC_THREAD_ATTRIBUTE_SECURITY_CAPABILITIES, capabilitiesBuffer, new IntPtr(Marshal.SizeOf(typeof(SECURITY_CAPABILITIES))), IntPtr.Zero, IntPtr.Zero))
                    throw new Win32Exception(Marshal.GetLastWin32Error(), "UpdateProcThreadAttribute(SECURITY_CAPABILITIES)");
                startup.lpAttributeList = attributeList;
            }

            int creationFlags = EXTENDED_STARTUPINFO_PRESENT | CREATE_UNICODE_ENVIRONMENT | CREATE_SUSPENDED | CREATE_NEW_PROCESS_GROUP;
            var commandLine = new StringBuilder(BuildCommandLine(request.Executable, request.Arguments));

            bool created = CreateProcessW(
                request.Executable, commandLine, IntPtr.Zero, IntPtr.Zero, true, creationFlags, environment, request.CurrentDirectory, ref startup, out process);
            if (!created)
            {
                int error = Marshal.GetLastWin32Error();
                throw new Win32Exception(error, "CreateProcessW err=" + error + " (" + new Win32Exception(error).Message + ") exe=" + request.Executable);
            }

            report.phases.Add("create-process:" + stopwatch.ElapsedMilliseconds + "ms");
            report.processId = process.dwProcessId;
            report.suspendedStart = true;

            job = CreateJobObjectW(IntPtr.Zero, null);
            if (job == IntPtr.Zero) throw new Win32Exception(Marshal.GetLastWin32Error(), "CreateJobObject");
            ConfigureJob(job, request);
            if (!AssignProcessToJobObject(job, process.hProcess))
                throw new Win32Exception(Marshal.GetLastWin32Error(), "AssignProcessToJobObject");
            report.jobObject = true;
            report.activeProcessLimit = request.ActiveProcessLimit;

            if (ResumeThread(process.hThread) == uint.MaxValue)
                throw new Win32Exception(Marshal.GetLastWin32Error(), "ResumeThread");

            uint wait = WaitForSingleObject(process.hProcess, request.TimeoutMs > 0 ? (uint)request.TimeoutMs : 0xFFFFFFFF);
            report.phases.Add("wait:" + stopwatch.ElapsedMilliseconds + "ms");
            report.timedOut = wait == WAIT_TIMEOUT;
            if (report.timedOut)
            {
                TerminateJobObject(job, 124);
                WaitForSingleObject(process.hProcess, 10000);
            }

            uint exitCode;
            GetExitCodeProcess(process.hProcess, out exitCode);
            report.exitCode = unchecked((int)exitCode);
            report.ok = true;
            return 0;
        }
        finally
        {
            if (process.hThread != IntPtr.Zero) CloseHandle(process.hThread);
            if (process.hProcess != IntPtr.Zero) CloseHandle(process.hProcess);
            if (job != IntPtr.Zero) CloseHandle(job);
            if (attributeList != IntPtr.Zero) DeleteProcThreadAttributeList(attributeList);
            if (attributeList != IntPtr.Zero) Marshal.FreeHGlobal(attributeList);
            if (capabilitiesBuffer != IntPtr.Zero) Marshal.FreeHGlobal(capabilitiesBuffer);
            if (environment != IntPtr.Zero) Marshal.FreeHGlobal(environment);
            foreach (IntPtr handle in new[] { standardInput, standardOutput, standardError })
            {
                if (handle != IntPtr.Zero && handle != INVALID_HANDLE_VALUE) CloseHandle(handle);
            }
            report.completedAt = DateTime.UtcNow.ToString("o");
            report.durationMs = stopwatch.ElapsedMilliseconds;
            WriteReport(request, report);
        }
    }

    private static void ConfigureJob(IntPtr job, Request request)
    {
        var limits = new JOBOBJECT_EXTENDED_LIMIT_INFORMATION();
        limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE | JOB_OBJECT_LIMIT_DIE_ON_UNHANDLED_EXCEPTION;
        if (request.ActiveProcessLimit > 0)
        {
            limits.BasicLimitInformation.LimitFlags |= JOB_OBJECT_LIMIT_ACTIVE_PROCESS;
            limits.BasicLimitInformation.ActiveProcessLimit = (uint)request.ActiveProcessLimit;
        }
        if (request.MemoryLimitMb > 0)
        {
            limits.BasicLimitInformation.LimitFlags |= JOB_OBJECT_LIMIT_JOB_MEMORY | JOB_OBJECT_LIMIT_PROCESS_MEMORY;
            ulong bytes = (ulong)request.MemoryLimitMb * 1024UL * 1024UL;
            limits.JobMemoryLimit = new UIntPtr(bytes);
            limits.ProcessMemoryLimit = new UIntPtr(bytes);
        }

        IntPtr buffer = Marshal.AllocHGlobal(Marshal.SizeOf(typeof(JOBOBJECT_EXTENDED_LIMIT_INFORMATION)));
        try
        {
            Marshal.StructureToPtr(limits, buffer, false);
            if (!SetInformationJobObject(job, JobObjectExtendedLimitInformation, buffer, (uint)Marshal.SizeOf(typeof(JOBOBJECT_EXTENDED_LIMIT_INFORMATION))))
                throw new Win32Exception(Marshal.GetLastWin32Error(), "SetInformationJobObject");
        }
        finally
        {
            Marshal.FreeHGlobal(buffer);
        }
    }

    /// <summary>
    /// True when the identity already holds at least the requested rights on the
    /// object, so the (expensive) DACL write and its subtree propagation can be
    /// skipped.
    /// </summary>
    private static bool AlreadyGranted(FileSystemSecurity security, SecurityIdentifier identity, FileSystemRights rights)
    {
        try
        {
            foreach (FileSystemAccessRule rule in security.GetAccessRules(true, false, typeof(SecurityIdentifier)))
            {
                if (rule.AccessControlType != AccessControlType.Allow) continue;
                if (!rule.IdentityReference.Equals(identity)) continue;
                if ((rule.FileSystemRights & rights) == rights) return true;
            }
        }
        catch
        {
            return false;
        }
        return false;
    }
    private static IntPtr CreateInheritableFile(string path, bool isInput)
    {
        const uint GENERIC_WRITE = 0x40000000;
        const uint GENERIC_READ = 0x80000000;
        const uint FILE_SHARE_READ = 0x00000001;
        const uint FILE_SHARE_WRITE = 0x00000002;
        const uint CREATE_ALWAYS = 2;
        const uint OPEN_EXISTING = 3;
        IntPtr handle = CreateFileW(path, isInput ? GENERIC_READ : GENERIC_WRITE, FILE_SHARE_READ | FILE_SHARE_WRITE, IntPtr.Zero, isInput ? OPEN_EXISTING : CREATE_ALWAYS, 0, IntPtr.Zero);
        if (handle == INVALID_HANDLE_VALUE) throw new Win32Exception(Marshal.GetLastWin32Error(), "CreateFile err=" + Marshal.GetLastWin32Error() + " " + path);
        SetHandleInformation(handle, HANDLE_FLAG_INHERIT, HANDLE_FLAG_INHERIT);
        return handle;
    }

    private static IntPtr BuildEnvironmentBlock(IDictionary<string, string> environment)
    {
        var names = new List<string>(environment.Keys);
        names.Sort(StringComparer.OrdinalIgnoreCase);
        var builder = new StringBuilder();
        foreach (string name in names)
        {
            builder.Append(name).Append('=').Append(environment[name]).Append('\0');
        }
        builder.Append('\0');
        return Marshal.StringToHGlobalUni(builder.ToString());
    }

    private static string BuildCommandLine(string executable, IList<string> arguments)
    {
        var builder = new StringBuilder();
        builder.Append('"').Append(executable).Append('"');
        foreach (string argument in arguments)
        {
            builder.Append(' ');
            builder.Append(Quote(argument));
        }
        return builder.ToString();
    }

    /// <summary>
    /// CommandLineToArgvW-compatible quoting. In particular a backslash run that
    /// precedes a quote must be doubled, otherwise a Candidate argument can break
    /// out of its quoting.
    /// </summary>
    private static string Quote(string argument)
    {
        if (argument.Length > 0 && argument.IndexOfAny(new[] { ' ', '\t', '\n', '\v', '"' }) < 0) return argument;
        var builder = new StringBuilder("\"");
        for (int index = 0; index < argument.Length; index++)
        {
            int backslashes = 0;
            while (index < argument.Length && argument[index] == '\\') { backslashes++; index++; }
            if (index == argument.Length)
            {
                builder.Append('\\', backslashes * 2);
                break;
            }
            if (argument[index] == '"')
            {
                builder.Append('\\', backslashes * 2 + 1).Append('"');
            }
            else
            {
                builder.Append('\\', backslashes).Append(argument[index]);
            }
        }
        builder.Append('"');
        return builder.ToString();
    }

    private static void WriteReport(Request request, Report report)
    {
        if (string.IsNullOrEmpty(request.ReportFile)) return;
        try
        {
            string directory = Path.GetDirectoryName(request.ReportFile);
            if (!string.IsNullOrEmpty(directory)) Directory.CreateDirectory(directory);
            File.WriteAllText(request.ReportFile, report.ToJson(), new UTF8Encoding(false));
        }
        catch
        {
            // A report that cannot be written must not change the outcome; the
            // caller treats a missing report as a failed sandbox invocation.
        }
    }

    private sealed class Grant
    {
        public string Access { get; set; }
        public string Path { get; set; }
    }

    private sealed class ProbeReport
    {
        public bool appContainer;
        public string appContainerSid;
        public bool jobObject;

        public string ToJson()
        {
            return "{\"appContainer\":" + Json.Bool(appContainer) + ",\"appContainerSid\":" + Json.String(appContainerSid) + ",\"jobObject\":" + Json.Bool(jobObject) + "}";
        }
    }

    private sealed class Report
    {
        public string launcher;
        public string startedAt;
        public string completedAt;
        public long durationMs;
        public string container;
        public string containerSid;
        public int processId;
        public int exitCode;
        public long activeProcessLimit;
        public bool jobObject;
        public bool suspendedStart;
        public bool timedOut;
        public bool ok;
        public string failure;
        public int win32Error;
        public ProbeReport probe;
        public readonly List<string> grants = new List<string>();
        public readonly List<string> phases = new List<string>();

        public string ToJson()
        {
            var builder = new StringBuilder();
            builder.Append('{');
            bool first = true;
            Json.WriteField(builder, "launcher", Json.String(launcher), ref first);
            Json.WriteField(builder, "startedAt", Json.String(startedAt), ref first);
            Json.WriteField(builder, "completedAt", Json.String(completedAt), ref first);
            Json.WriteField(builder, "durationMs", durationMs.ToString(CultureInfo.InvariantCulture), ref first);
            Json.WriteField(builder, "container", Json.String(container), ref first);
            Json.WriteField(builder, "containerSid", Json.String(containerSid), ref first);
            Json.WriteField(builder, "processId", processId.ToString(CultureInfo.InvariantCulture), ref first);
            Json.WriteField(builder, "exitCode", exitCode.ToString(CultureInfo.InvariantCulture), ref first);
            Json.WriteField(builder, "activeProcessLimit", activeProcessLimit.ToString(CultureInfo.InvariantCulture), ref first);
            Json.WriteField(builder, "jobObject", Json.Bool(jobObject), ref first);
            Json.WriteField(builder, "suspendedStart", Json.Bool(suspendedStart), ref first);
            Json.WriteField(builder, "timedOut", Json.Bool(timedOut), ref first);
            Json.WriteField(builder, "ok", Json.Bool(ok), ref first);
            Json.WriteField(builder, "failure", Json.String(failure), ref first);
            Json.WriteField(builder, "win32Error", win32Error.ToString(CultureInfo.InvariantCulture), ref first);
            Json.WriteField(builder, "grants", Json.StringArray(grants), ref first);
            Json.WriteField(builder, "phases", Json.StringArray(phases), ref first);
            if (probe != null) Json.WriteField(builder, "probe", probe.ToJson(), ref first);
            builder.Append('}');
            return builder.ToString();
        }
    }

    private static class Json
    {
        public static string Bool(bool value) { return value ? "true" : "false"; }

        public static string String(string value)
        {
            if (value == null) return "null";
            var builder = new StringBuilder("\"");
            foreach (char character in value)
            {
                switch (character)
                {
                    case '"': builder.Append("\\\""); break;
                    case '\\': builder.Append("\\\\"); break;
                    case '\n': builder.Append("\\n"); break;
                    case '\r': builder.Append("\\r"); break;
                    case '\t': builder.Append("\\t"); break;
                    default:
                        if (character < 0x20) builder.Append("\\u").Append(((int)character).ToString("x4", CultureInfo.InvariantCulture));
                        else builder.Append(character);
                        break;
                }
            }
            return builder.Append('"').ToString();
        }

        public static string Array(IEnumerable<string> values, Func<string, string> render)
        {
            var builder = new StringBuilder("[");
            bool first = true;
            foreach (string value in values)
            {
                if (!first) builder.Append(',');
                first = false;
                builder.Append(render(value));
            }
            return builder.Append(']').ToString();
        }

        public static string StringArray(IEnumerable<string> values)
        {
            return Array(values, String);
        }

        public static void Field(StringBuilder builder, string name, string value, ref bool first)
        {
            WriteField(builder, name, String(value), ref first);
        }

        public static void WriteField(StringBuilder builder, string name, string rawValue, ref bool first)
        {
            if (!first) builder.Append(',');
            first = false;
            builder.Append(String(name)).Append(':').Append(rawValue);
        }
    }

    private sealed class Request
    {
        public string Container { get; private set; }
        public string CurrentDirectory { get; private set; }
        public string Executable { get; private set; }
        public string StdOutFile { get; private set; }
        public string StdErrFile { get; private set; }
        public string ReportFile { get; private set; }
        public string StdInFile { get; private set; }
        public int TimeoutMs { get; private set; }
        public int ActiveProcessLimit { get; private set; }
        public int MemoryLimitMb { get; private set; }
        public bool Probe { get; private set; }
        public readonly List<string> Arguments = new List<string>();
        public readonly List<Grant> Grants = new List<Grant>();
        public readonly Dictionary<string, string> Environment = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);

        public static Request Parse(string[] lines)
        {
            var request = new Request { TimeoutMs = 900000, ActiveProcessLimit = 1, MemoryLimitMb = 0 };
            foreach (string raw in lines)
            {
                string line = raw;
                if (line.Length == 0 || line[0] == '#') continue;
                int space = line.IndexOf(' ');
                string directive = space < 0 ? line : line.Substring(0, space);
                string value = space < 0 ? string.Empty : line.Substring(space + 1);
                switch (directive)
                {
                    case "container": request.Container = value; break;
                    case "cwd": request.CurrentDirectory = value; break;
                    case "exe": request.Executable = value; break;
                    case "arg": request.Arguments.Add(value); break;
                    case "stdout": request.StdOutFile = value; break;
                    case "stderr": request.StdErrFile = value; break;
                    case "stdin": request.StdInFile = value; break;
                    case "report": request.ReportFile = value; break;
                    case "timeoutMs": request.TimeoutMs = int.Parse(value, CultureInfo.InvariantCulture); break;
                    case "activeProcessLimit": request.ActiveProcessLimit = int.Parse(value, CultureInfo.InvariantCulture); break;
                    case "memoryLimitMb": request.MemoryLimitMb = int.Parse(value, CultureInfo.InvariantCulture); break;
                    case "probe": request.Probe = true; break;
                    case "env":
                    {
                        int equals = value.IndexOf('=');
                        if (equals <= 0) throw new InvalidDataException("env requires NAME=VALUE, got: " + value);
                        request.Environment[value.Substring(0, equals)] = value.Substring(equals + 1);
                        break;
                    }
                    case "grant":
                    {
                        int separator = value.IndexOf(' ');
                        if (separator <= 0) throw new InvalidDataException("grant requires '<read|write> <path>', got: " + value);
                        request.Grants.Add(new Grant { Access = value.Substring(0, separator), Path = value.Substring(separator + 1) });
                        break;
                    }
                    default:
                        throw new InvalidDataException("unknown directive: " + directive);
                }
            }

            if (!request.Probe)
            {
                if (string.IsNullOrEmpty(request.Executable)) throw new InvalidDataException("exe is required");
                if (string.IsNullOrEmpty(request.CurrentDirectory)) throw new InvalidDataException("cwd is required");
            }
            return request;
        }
    }
}
`;
