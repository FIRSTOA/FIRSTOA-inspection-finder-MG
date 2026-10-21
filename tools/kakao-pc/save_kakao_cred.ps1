$Host.UI.RawUI.WindowTitle = "FIRSTOA 카톡 봇 계정 저장"
Add-Type -TypeDefinition @"
using System; using System.Runtime.InteropServices;
public class CredStore {
  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)]
  public struct CREDENTIAL { public uint Flags; public uint Type; public string TargetName; public string Comment; public System.Runtime.InteropServices.ComTypes.FILETIME LastWritten; public uint CredentialBlobSize; public IntPtr CredentialBlob; public uint Persist; public uint AttributeCount; public IntPtr Attributes; public string TargetAlias; public string UserName; }
  [DllImport("advapi32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern bool CredWriteW(ref CREDENTIAL cred, uint flags);
  public static void Save(string target, string user, string pass) {
    var blob = System.Text.Encoding.Unicode.GetBytes(pass);
    var c = new CREDENTIAL(); c.Type = 1; c.TargetName = target; c.UserName = user; c.Persist = 2; c.Comment = "FIRSTOA kakao bot (aside)";
    c.CredentialBlobSize = (uint)blob.Length; c.CredentialBlob = Marshal.AllocHGlobal(blob.Length); Marshal.Copy(blob, 0, c.CredentialBlob, blob.Length);
    bool ok = CredWriteW(ref c, 0); Marshal.FreeHGlobal(c.CredentialBlob);
    if (!ok) throw new Exception("CredWrite failed " + Marshal.GetLastWin32Error());
  }
}
"@
Write-Host ""
Write-Host "  카톡 봇 계정을 이 노트북에만 암호화 저장합니다 (채팅·파일·로그에 남지 않음)." -ForegroundColor Cyan
Write-Host ""
$id = Read-Host "  카카오계정 이메일(또는 전화번호)"
if (-not $id) { Write-Host "`n  계정을 입력해 주세요." -ForegroundColor Red; Read-Host; exit 1 }
$p1 = Read-Host "  비밀번호 (입력해도 화면에 안 보임)" -AsSecureString
$p2 = Read-Host "  비밀번호 한 번 더" -AsSecureString
$s1 = [Runtime.InteropServices.Marshal]::PtrToStringUni([Runtime.InteropServices.Marshal]::SecureStringToGlobalAllocUnicode($p1))
$s2 = [Runtime.InteropServices.Marshal]::PtrToStringUni([Runtime.InteropServices.Marshal]::SecureStringToGlobalAllocUnicode($p2))
if ($s1 -ne $s2) { Write-Host "`n  두 비밀번호가 달라요. 창을 닫고 다시 실행해 주세요." -ForegroundColor Red; Read-Host; exit 1 }
if ($s1.Length -lt 4) { Write-Host "`n  비밀번호가 너무 짧아요." -ForegroundColor Red; Read-Host; exit 1 }
[CredStore]::Save("FIRSTOA_KAKAO", $id, $s1)
Remove-Item -ErrorAction SilentlyContinue (Join-Path $PSScriptRoot "kakao_login_state.json")  # 자동 로그인 실패 횟수 초기화(3번 실패로 멈춘 것 풀기)
Write-Host "`n  저장 완료: $id (비밀번호 $($s1.Length)자). 이 창은 닫아도 됩니다." -ForegroundColor Green
Read-Host "  Enter 를 누르면 닫힘"
