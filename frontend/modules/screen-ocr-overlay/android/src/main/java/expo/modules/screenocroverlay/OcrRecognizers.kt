package expo.modules.screenocroverlay

import com.google.mlkit.vision.text.TextRecognition
import com.google.mlkit.vision.text.TextRecognizer
import com.google.mlkit.vision.text.chinese.ChineseTextRecognizerOptions
import com.google.mlkit.vision.text.korean.KoreanTextRecognizerOptions

/**
 * Picks the ML Kit script recognizer that matches the learner's target language.
 * Each bundled recognizer reads its own script plus Latin, and no single one reads
 * both Korean and Chinese, so the choice has to follow the profile target language.
 * Anything we don't recognize (or a null) falls back to Korean, the original default.
 */
object OcrRecognizers {
  /** Canonical recognizer key ("ko" | "zh") for a raw target-language string. */
  fun normalizeLanguage(language: String?): String {
    val raw = language?.trim()?.lowercase() ?: ""
    return if (raw.startsWith("zh")) "zh" else "ko"
  }

  fun create(language: String?): TextRecognizer {
    val options = when (normalizeLanguage(language)) {
      "zh" -> ChineseTextRecognizerOptions.Builder().build()
      else -> KoreanTextRecognizerOptions.Builder().build()
    }
    return TextRecognition.getClient(options)
  }
}
