param(
 [Parameter(Mandatory=$true)][string]$PrinterName,
 [Parameter(Mandatory=$true)][string]$RawPath
)
# Windows-only Epson RAW spool bridge; queue a print job, not proof of actual hardware action.
$ErrorActionPreference = 'Stop'
if (-not (Test-Path -LiteralPath $RawPath -PathType Leaf)) { throw 'Payload file missing' }
$bytes = [System.IO.File]::ReadAllBytes($RawPath)
if ($bytes.Length -lt 3 -or $bytes.Length -gt 131072) { throw 'Invalid RAW payload size' }
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class PersenRawSpooler {
 [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)]
 public struct DOC_INFO_1 {
  [MarshalAs(UnmanagedType.LPWStr)] public string pDocName;
  [MarshalAs(UnmanagedType.LPWStr)] public string pOutputFile;
  [MarshalAs(UnmanagedType.LPWStr)] public string pDataType;
 }
 [DllImport("winspool.drv",EntryPoint="OpenPrinterW",SetLastError=true,CharSet=CharSet.Unicode)]
 public static extern bool OpenPrinter(string name,out IntPtr handle,IntPtr defaults);
 [DllImport("winspool.drv",EntryPoint="ClosePrinter",SetLastError=true)]
 public static extern bool ClosePrinter(IntPtr handle);
 [DllImport("winspool.drv",EntryPoint="StartDocPrinterW",SetLastError=true,CharSet=CharSet.Unicode)]
 public static extern int StartDocPrinter(IntPtr handle,int level,ref DOC_INFO_1 info);
 [DllImport("winspool.drv",EntryPoint="EndDocPrinter",SetLastError=true)]
 public static extern bool EndDocPrinter(IntPtr handle);
 [DllImport("winspool.drv",EntryPoint="StartPagePrinter",SetLastError=true)]
 public static extern bool StartPagePrinter(IntPtr handle);
 [DllImport("winspool.drv",EntryPoint="EndPagePrinter",SetLastError=true)]
 public static extern bool EndPagePrinter(IntPtr handle);
 [DllImport("winspool.drv",EntryPoint="WritePrinter",SetLastError=true)]
 public static extern bool WritePrinter(IntPtr handle,IntPtr data,int count,out int written);
}
'@ -ErrorAction Stop
$handle=[IntPtr]::Zero
if (-not [PersenRawSpooler]::OpenPrinter($PrinterName,[ref]$handle,[IntPtr]::Zero)) {
 throw ('Windows could not open the specified printer queue: '+[Runtime.InteropServices.Marshal]::GetLastWin32Error())
}
$started=$false; $page=$false; $pointer=[IntPtr]::Zero
try {
 $doc=New-Object PersenRawSpooler+DOC_INFO_1
 $doc.pDocName='Persen POS Staging Epson'
 $doc.pDataType='RAW'
 $id=[PersenRawSpooler]::StartDocPrinter($handle,1,[ref]$doc)
 if ($id -le 0) { throw 'Failed to start RAW spool job' }
 $started=$true
 if (-not [PersenRawSpooler]::StartPagePrinter($handle)) { throw 'Failed to start page' }
 $page=$true
 $pointer=[Runtime.InteropServices.Marshal]::AllocHGlobal($bytes.Length)
 [Runtime.InteropServices.Marshal]::Copy($bytes,0,$pointer,$bytes.Length)
 $written=0
 if (-not [PersenRawSpooler]::WritePrinter($handle,$pointer,$bytes.Length,[ref]$written) -or $written -ne $bytes.Length) {
  throw 'Incomplete RAW printer write'
 }
 if (-not [PersenRawSpooler]::EndPagePrinter($handle)) { throw 'Failed to end page' }
 $page=$false
 if (-not [PersenRawSpooler]::EndDocPrinter($handle)) { throw 'Failed to end document' }
 $started=$false
} finally {
 if ($pointer -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::FreeHGlobal($pointer) }
 if ($page) { [void][PersenRawSpooler]::EndPagePrinter($handle) }
 if ($started) { [void][PersenRawSpooler]::EndDocPrinter($handle) }
 [void][PersenRawSpooler]::ClosePrinter($handle)
}
