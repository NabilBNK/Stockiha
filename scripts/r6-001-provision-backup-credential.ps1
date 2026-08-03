[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$target = 'Stockiha/PostgreSQL/backup/password'

$source = @'
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;

public static class StockihaBackupCredential
{
    private const uint CRED_TYPE_GENERIC = 1;
    private const uint CRED_PERSIST_LOCAL_MACHINE = 2;
    private const int MAX_SECRET_BYTES = 2560;

    [StructLayout(LayoutKind.Sequential)]
    private struct FILETIME
    {
        public uint Low;
        public uint High;
    }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct CREDENTIAL
    {
        public uint Flags;
        public uint Type;
        public IntPtr TargetName;
        public IntPtr Comment;
        public FILETIME LastWritten;
        public uint CredentialBlobSize;
        public IntPtr CredentialBlob;
        public uint Persist;
        public uint AttributeCount;
        public IntPtr Attributes;
        public IntPtr TargetAlias;
        public IntPtr UserName;
    }

    [DllImport("Advapi32.dll", EntryPoint = "CredWriteW", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool CredWrite(ref CREDENTIAL credential, uint flags);

    [DllImport("Advapi32.dll", EntryPoint = "CredReadW", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool CredRead(string target, uint type, uint flags, out IntPtr credential);

    [DllImport("Advapi32.dll", EntryPoint = "CredFree")]
    private static extern void CredFree(IntPtr credential);

    public static void WriteUtf8(string target, byte[] secret)
    {
        if (String.IsNullOrWhiteSpace(target))
            throw new ArgumentException("Target is required.", "target");
        if (secret == null || secret.Length == 0)
            throw new ArgumentException("Secret must not be empty.", "secret");
        if (secret.Length > MAX_SECRET_BYTES)
            throw new ArgumentException("Secret is too large.", "secret");

        IntPtr targetPtr = IntPtr.Zero;
        GCHandle secretHandle = default(GCHandle);
        try
        {
            targetPtr = Marshal.StringToCoTaskMemUni(target);
            secretHandle = GCHandle.Alloc(secret, GCHandleType.Pinned);
            var credential = new CREDENTIAL
            {
                Flags = 0,
                Type = CRED_TYPE_GENERIC,
                TargetName = targetPtr,
                Comment = IntPtr.Zero,
                LastWritten = new FILETIME(),
                CredentialBlobSize = checked((uint)secret.Length),
                CredentialBlob = secretHandle.AddrOfPinnedObject(),
                Persist = CRED_PERSIST_LOCAL_MACHINE,
                AttributeCount = 0,
                Attributes = IntPtr.Zero,
                TargetAlias = IntPtr.Zero,
                UserName = IntPtr.Zero,
            };

            if (!CredWrite(ref credential, 0))
                throw new Win32Exception(Marshal.GetLastWin32Error(), "Credential Manager write failed.");
        }
        finally
        {
            if (secretHandle.IsAllocated)
                secretHandle.Free();
            if (targetPtr != IntPtr.Zero)
                Marshal.FreeCoTaskMem(targetPtr);
        }
    }

    public static byte[] ReadAndZeroNative(string target)
    {
        IntPtr credentialPtr;
        if (!CredRead(target, CRED_TYPE_GENERIC, 0, out credentialPtr))
            throw new Win32Exception(Marshal.GetLastWin32Error(), "Credential Manager read failed.");

        try
        {
            var credential = (CREDENTIAL)Marshal.PtrToStructure(credentialPtr, typeof(CREDENTIAL));
            int length = checked((int)credential.CredentialBlobSize);
            if (length <= 0 || credential.CredentialBlob == IntPtr.Zero)
                throw new InvalidOperationException("Stored credential is empty or invalid.");

            byte[] copied = new byte[length];
            Marshal.Copy(credential.CredentialBlob, copied, 0, length);

            byte[] zeros = new byte[length];
            Marshal.Copy(zeros, 0, credential.CredentialBlob, length);
            Array.Clear(zeros, 0, zeros.Length);
            return copied;
        }
        finally
        {
            CredFree(credentialPtr);
        }
    }
}
'@

if (-not ('StockihaBackupCredential' -as [type])) {
    Add-Type -TypeDefinition $source -Language CSharp
}

Write-Host 'Before continuing, set the PostgreSQL password for role stockiha_backup to the same value.'
Write-Host 'Use psql interactively: \password stockiha_backup'
$securePassword = Read-Host 'Enter the stockiha_backup password for Credential Manager' -AsSecureString
$bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($securePassword)
$utf8 = $null
$verified = $null
try {
    $plain = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
    if ([string]::IsNullOrEmpty($plain)) {
        throw 'Password must not be empty.'
    }

    $utf8 = [Text.Encoding]::UTF8.GetBytes($plain)
    [StockihaBackupCredential]::WriteUtf8($target, $utf8)
    $verified = [StockihaBackupCredential]::ReadAndZeroNative($target)

    if ($verified.Length -ne $utf8.Length) {
        throw 'Credential verification length mismatch.'
    }
    for ($index = 0; $index -lt $utf8.Length; $index++) {
        if ($verified[$index] -ne $utf8[$index]) {
            throw 'Credential verification byte mismatch.'
        }
    }
}
finally {
    if ($null -ne $utf8) {
        [Array]::Clear($utf8, 0, $utf8.Length)
    }
    if ($null -ne $verified) {
        [Array]::Clear($verified, 0, $verified.Length)
    }
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
    $plain = $null
    $securePassword.Dispose()
}

Write-Host "Backup credential provisioned and verified at fixed target: $target"
Write-Host 'No password value was printed or passed through Tauri IPC.'
