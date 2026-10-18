//! Lecture de texte dans une capture d'écran, via l'OCR intégré à Windows.
//!
//! Implémentation : PowerShell + l'API WinRT Windows.Media.Ocr (livrée avec Windows 10/11,
//! aucune dépendance externe).
//!
//! Aucune lecture de mémoire ni d'interception de réseau : on ne lit qu'une image déjà écrite par le jeu.
//! Le texte reconnu sert au rattrapage de quêtes.
#![cfg(windows)]

use std::path::Path;

/// Script PowerShell embarqué : lit les langues OCR du profil, décode l'image, renvoie les lignes.
const PS: &str = r#"
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Runtime.WindowsRuntime | Out-Null
$asTaskGeneric = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1' })[0]
function Await($t, $rt) { $net = $asTaskGeneric.MakeGenericMethod($rt).Invoke($null, @($t)); $net.Wait(-1) | Out-Null; $net.Result }
[Windows.Storage.StorageFile, Windows.Storage, ContentType=WindowsRuntime] | Out-Null
[Windows.Graphics.Imaging.BitmapDecoder, Windows.Graphics.Imaging, ContentType=WindowsRuntime] | Out-Null
[Windows.Media.Ocr.OcrEngine, Windows.Foundation, ContentType=WindowsRuntime] | Out-Null
[Windows.Globalization.Language, Windows.Globalization, ContentType=WindowsRuntime] | Out-Null
[Windows.Graphics.Imaging.SoftwareBitmap, Windows.Graphics.Imaging, ContentType=WindowsRuntime] | Out-Null
$path = $env:OCR_PATH
if (-not $path) { $path = $args[0] }
$f = Await ([Windows.Storage.StorageFile]::GetFileFromPathAsync($path)) ([Windows.Storage.StorageFile])
$s = Await ($f.OpenAsync([Windows.Storage.FileAccessMode]::Read)) ([Windows.Storage.Streams.IRandomAccessStream])
$d = Await ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($s)) ([Windows.Graphics.Imaging.BitmapDecoder])
$b = Await ($d.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])
# L'OCR n'accepte que BGRA8 : on convertit et on élimine un d'éventuel canal alpha.
$b = [Windows.Graphics.Imaging.SoftwareBitmap]::Convert($b, [Windows.Graphics.Imaging.BitmapPixelFormat]::Bgra8, [Windows.Graphics.Imaging.BitmapAlphaMode]::Ignore)
$tags = @([Windows.Media.Ocr.OcrEngine]::AvailableRecognizerLanguages)
if ($tags.Count -eq 0) { Write-Output '__NO_LANGUAGES__'; exit 0 }
$prefer = @('fr-FR','en-US','en-GB','de-DE','es-ES','ru-RU')
$lang = $tags[0]
foreach ($l in $prefer) { if ($tags -contains $l) { $lang = $l; break } }
$eng = $null
try { $eng = [Windows.Media.Ocr.OcrEngine]::TryCreateFromLanguage([Windows.Globalization.Language]::Create($lang)) } catch {}
if (-not $eng) { $eng = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages() }
if (-not $eng) { Write-Output '__NO_ENGINE__'; exit 0 }
$r = Await ($eng.RecognizeAsync($b)) ([Windows.Media.Ocr.OcrResult])
foreach ($ln in $r.Lines) { $ln.Text }
"#;

/// Liste les images de capture d'écran d'un dossier, du plus récent au plus ancien.
pub fn list_screenshots(dir: &Path) -> Vec<std::path::PathBuf> {
    let mut out: Vec<std::path::PathBuf> = std::fs::read_dir(dir)
        .ok()
        .into_iter()
        .flatten()
        .filter_map(|e| e.ok())
        .filter_map(|e| {
            let p = e.path();
            let ext = p.extension()?.to_ascii_lowercase();
            if (ext == "png" || ext == "jpg" || ext == "jpeg") && p.file_stem().is_some() {
                Some(p)
            } else {
                None
            }
        })
        .collect();
    out.sort_by(|a, b| {
        let ta = a.metadata().and_then(|m| m.modified()).unwrap_or(std::time::SystemTime::UNIX_EPOCH);
        let tb = b.metadata().and_then(|m| m.modified()).unwrap_or(std::time::SystemTime::UNIX_EPOCH);
        tb.cmp(&ta)
    });
    out
}

/// Lit les lignes de texte d'une image par l'OCR Windows intégré.
pub fn read_lines(path: &Path) -> Result<Vec<String>, String> {
    use std::process::Command;
    if !path.is_file() {
        return Err(format!("Fichier introuvable : {}", path.display()));
    }
    let out = Command::new("powershell")
        .args([
            "-NoProfile", "-NonInteractive", "-STA", "-ExecutionPolicy", "Bypass",
            "-Command", PS,
        ])
        .env("OCR_PATH", path)
        .output()
        .map_err(|e| format!("Impossible de lancer PowerShell : {}", e))?;
    let stderr = String::from_utf8_lossy(&out.stderr);
    let stdout = String::from_utf8_lossy(&out.stdout);
    if stdout.contains("__NO_LANGUAGES__") || stdout.contains("__NO_ENGINE__") {
        return Err(
            "OCR Windows indisponible : installe une langue puis un module d'imprétrature \
             (Paramètres > Heure & langue > Langue, ex: Français/English)."
                .to_string(),
        );
    }
    let lines: Vec<String> = stdout
        .lines()
        .map(|l| l.trim().to_string())
        .filter(|l| !l.is_empty())
        .collect();
    if lines.is_empty() {
        return Err(format!(
            "OCR n'a reconnu aucun texte dans {}\n{}",
            path.display(),
            stderr.trim()
        ));
    }
    Ok(lines)
}
